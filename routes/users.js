const express = require('express');
const { body, param } = require('express-validator');
const { pool } = require('../db');
const { hashPassword } = require('../lib/password');
const { requireAuth, requireAdmin, validate } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// A custom check rather than isIn(): isIn() would accept ['admin'], which PostgreSQL then rejects.
const roleRule = () => body('role')
  .custom((v) => v === 'admin' || v === 'user')
  .withMessage('Role must be admin or user');

// cattle_count lets the screen say how many animals a deletion would remove.
router.get('/', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.email, u.role, u.created_at,
           (SELECT count(*) FROM cattle c WHERE c.owner_id = u.id)::int AS cattle_count
    FROM users u WHERE NOT u.is_demo ORDER BY u.id
  `);
  res.json(rows);
});

router.post('/',
  body('email').isString().trim().toLowerCase().isEmail().withMessage('Enter a valid email'),
  body('password').isString().isLength({ min: 10, max: 128 }).withMessage('Password must be 10 to 128 characters'),
  roleRule().optional(),
  validate,
  async (req, res) => {
    const hash = await hashPassword(req.body.password);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at',
      [req.body.email, hash, req.body.role || 'user']
    );
    res.status(201).json(rows[0]);
  }
);

// Role changes and deletions run one at a time (advisory lock), so two admins acting at once can
// never leave the app without an admin, for example by each removing the other.
const ADMIN_CHANGE_LOCK = 727002;
const LAST_ADMIN = 'This is the last admin. Make another user an admin first.';

async function inAdminChange(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_CHANGE_LOCK]);
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

async function otherAdminExists(client, id) {
  const { rows } = await client.query("SELECT 1 FROM users WHERE role = 'admin' AND id <> $1 LIMIT 1", [id]);
  return rows.length > 0;
}

// connect-pg-simple stores each session as JSON in the `session` table, with the user's id in `userId`.
const USER_SESSIONS = "sess->>'userId' = $1::text";

router.patch('/:id',
  param('id').isInt().toInt(),
  roleRule(),
  validate,
  async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    const [status, payload] = await inAdminChange(async (client) => {
      const { rows } = await client.query('SELECT role FROM users WHERE id = $1 AND NOT is_demo', [id]);
      if (!rows.length) return [404, { error: 'User not found' }];
      if (rows[0].role === 'admin' && role !== 'admin' && !(await otherAdminExists(client, id))) {
        return [409, { error: LAST_ADMIN }];
      }
      const updated = await client.query(
        'UPDATE users SET role = $2 WHERE id = $1 RETURNING id, email, role, created_at',
        [id, role]
      );
      // requireAdmin reads the role from the users table; this keeps the copy in open sessions in step.
      await client.query(
        `UPDATE session SET sess = jsonb_set(sess::jsonb, '{role}', to_jsonb($2::text))::json WHERE ${USER_SESSIONS}`,
        [id, role]
      );
      return [200, updated.rows[0]];
    });
    res.status(status).json(payload);
  }
);

router.delete('/:id', param('id').isInt().toInt(), validate, async (req, res) => {
  const { id } = req.params;
  if (id === req.session.userId) return res.status(400).json({ error: "You can't delete yourself" });
  const [status, payload] = await inAdminChange(async (client) => {
    const { rows } = await client.query('SELECT role FROM users WHERE id = $1', [id]);
    if (!rows.length) return [404, { error: 'User not found' }];
    if (rows[0].role === 'admin' && !(await otherAdminExists(client, id))) return [409, { error: LAST_ADMIN }];
    await client.query('DELETE FROM users WHERE id = $1', [id]); // cascades to their cattle
    await client.query(`DELETE FROM session WHERE ${USER_SESSIONS}`, [id]); // signs them out everywhere
    return [200, { ok: true }];
  });
  res.status(status).json(payload);
});

module.exports = router;