const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, validate } = require('../middleware/auth');

// A user is an account; a farm is created or joined afterwards. Roles here are per farm
// (farm_members.role), not the global users.role.
const router = express.Router();
router.use(requireAuth);

const INVITE_DAYS = 7;

// Test-only switch, same as routes/auth.js. Never set it on a real deployment.
const skipLimit = process.env.RATE_LIMIT_DISABLED === 'true' ? () => true : () => false;
const perUser = (req) => `user:${req.session.userId}`;
const limiterFor = (windowMs, limit, error) => rateLimit({
  windowMs,
  limit,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipLimit,
  keyGenerator: perUser,
  message: { error },
});
const createLimiter = limiterFor(60 * 60 * 1000, 10, 'Too many farms created. Please try again later.');
const joinLimiter = limiterFor(15 * 60 * 1000, 10, 'Too many attempts. Please try again later.');
const inviteLimiter = limiterFor(60 * 60 * 1000, 30, 'Too many invites created. Please try again later.');

// Demo accounts are throwaway users with their own sample herd; they do not join real farms.
// A session whose user no longer exists is ended.
async function rejectDemo(req, res, next) {
  const { rows } = await pool.query('SELECT is_demo FROM users WHERE id = $1', [req.session.userId]);
  if (!rows.length) {
    await new Promise((resolve) => req.session.destroy(() => resolve()));
    return res.status(401).json({ error: 'Session expired' });
  }
  if (rows[0].is_demo) return res.status(403).json({ error: "Demo accounts can't create or join farms" });
  next();
}
router.use(rejectDemo);

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
}

// work(client) returns [status, payload]. Anything thrown rolls back.
async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function farmsFor(userId) {
  const { rows } = await pool.query(
    `SELECT f.id, f.name, m.role
     FROM farm_members m JOIN farms f ON f.id = m.farm_id
     WHERE m.user_id = $1
     ORDER BY m.created_at, f.id`,
    [userId]
  );
  return rows;
}

const nameRule = body('name').isString().trim().isLength({ min: 1, max: 80 })
  .withMessage('Farm name must be 1 to 80 characters');
const inviteRoleRule = body('role').optional()
  .custom((v) => v === 'admin' || v === 'user').withMessage('Role must be admin or user');

router.get('/', async (req, res) => {
  const farms = await farmsFor(req.session.userId);
  const active = farms.find((f) => f.id === req.session.farmId);
  res.json({ farms, farmId: active ? active.id : null });
});

// Creates a farm and makes the signed-in user its admin.
router.post('/', createLimiter, nameRule, validate, async (req, res) => {
  const { name } = req.body;
  const userId = req.session.userId;
  const farm = await inTransaction(async (client) => {
    const created = await client.query('INSERT INTO farms (name) VALUES ($1) RETURNING id, name', [name]);
    await client.query(
      "INSERT INTO farm_members (farm_id, user_id, role) VALUES ($1, $2, 'admin')",
      [created.rows[0].id, userId]
    );
    return created.rows[0];
  });
  req.session.farmId = farm.id;
  await saveSession(req);
  res.status(201).json({ farm: { id: farm.id, name: farm.name, role: 'admin' }, farmId: farm.id });
});

// Joins a farm with an invite code. The code is checked and used in one transaction, with the
// invite row locked, so two people cannot use the same code at once. A bad, used or expired
// code gets the same answer, so the response does not say which.
router.post('/join', joinLimiter,
  body('code').isString().trim().isLength({ min: 8, max: 128 }).withMessage('Enter the invite code'),
  validate,
  async (req, res) => {
    const { code } = req.body;
    const userId = req.session.userId;
    const [status, payload] = await inTransaction(async (client) => {
      const found = await client.query(
        `SELECT i.id, i.farm_id, i.role, f.name
         FROM farm_invites i JOIN farms f ON f.id = i.farm_id
         WHERE i.code = $1 AND i.used_at IS NULL AND i.expires_at > now()
         FOR UPDATE OF i`,
        [code]
      );
      if (!found.rows.length) return [400, { error: 'That invite code is not valid or has expired' }];
      const invite = found.rows[0];
      const existing = await client.query(
        'SELECT 1 FROM farm_members WHERE farm_id = $1 AND user_id = $2',
        [invite.farm_id, userId]
      );
      if (existing.rows.length) return [409, { error: 'You are already a member of that farm' }];
      await client.query(
        'INSERT INTO farm_members (farm_id, user_id, role) VALUES ($1, $2, $3)',
        [invite.farm_id, userId, invite.role]
      );
      await client.query('UPDATE farm_invites SET used_by = $2, used_at = now() WHERE id = $1', [invite.id, userId]);
      return [200, { farm: { id: invite.farm_id, name: invite.name, role: invite.role }, farmId: invite.farm_id }];
    });
    if (status === 200) {
      req.session.farmId = payload.farmId;
      await saveSession(req);
    }
    res.status(status).json(payload);
  }
);

// Switches the active farm. Only farms the user belongs to.
router.post('/current', body('farmId').isInt({ min: 1 }).toInt().withMessage('Choose a farm'), validate, async (req, res) => {
  const farms = await farmsFor(req.session.userId);
  const farm = farms.find((f) => f.id === req.body.farmId);
  if (!farm) return res.status(404).json({ error: 'Farm not found' });
  req.session.farmId = farm.id;
  await saveSession(req);
  res.json({ farm, farmId: farm.id });
});

// A farm admin creates a single-use invite code. Someone who is not a member sees 404, so the
// route does not reveal which farm ids exist.
router.post('/:id/invites', inviteLimiter,
  param('id').isInt({ min: 1 }).toInt().withMessage('Invalid farm'),
  inviteRoleRule,
  validate,
  async (req, res) => {
    const farmId = req.params.id;
    const role = req.body.role || 'user';
    const { rows } = await pool.query(
      'SELECT role FROM farm_members WHERE farm_id = $1 AND user_id = $2',
      [farmId, req.session.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Farm not found' });
    if (rows[0].role !== 'admin') return res.status(403).json({ error: 'Farm admin only' });
    const code = crypto.randomBytes(16).toString('base64url');
    const created = await pool.query(
      `INSERT INTO farm_invites (farm_id, code, role, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))
       RETURNING code, role, expires_at`,
      [farmId, code, role, req.session.userId, INVITE_DAYS]
    );
    const invite = created.rows[0];
    res.status(201).json({ code: invite.code, role: invite.role, expiresAt: invite.expires_at });
  }
);

module.exports = router;
