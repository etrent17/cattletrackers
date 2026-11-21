const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { pool } = require('../db');
const { hashPassword, verifyPassword, dummyHash } = require('../lib/password');
const { createDemoUser } = require('../lib/demo');
const { requireAuth, validate } = require('../middleware/auth');

const router = express.Router();

const DEMO_SESSION_MS = 4 * 60 * 60 * 1000;
const demoEnabled = () => process.env.DEMO_MODE === 'true';

// Test-only switch, read once at startup: RATE_LIMIT_DISABLED=true turns both limiters off so the
// test suite can sign in more than 20 times. Never set it on a real deployment.
const skipLimit = process.env.RATE_LIMIT_DISABLED === 'true' ? () => true : () => false;

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, skip: skipLimit });
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipLimit,
  message: { error: 'Too many demo sessions from your network. Please try again later.' },
});

// Password changes are limited per signed-in user (requireAuth runs first), so a stolen
// session cannot be used to guess the current password quickly.
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipLimit,
  keyGenerator: (req) => `user:${req.session.userId}`,
  message: { error: 'Too many password change attempts. Please try again later.' },
});

const emailRule = body('email').isString().trim().toLowerCase().isEmail().withMessage('Enter a valid email');
const newPasswordRule = body('password').isString().isLength({ min: 10, max: 128 })
  .withMessage('Password must be 10 to 128 characters');

function startSession(req, user, { isDemo = false } = {}) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      Object.assign(req.session, { userId: user.id, email: user.email, role: user.role, isDemo });
      if (isDemo) req.session.cookie.maxAge = DEMO_SESSION_MS;
      req.session.save((err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

router.get('/status', async (req, res) => {
  const setup = await pool.query('SELECT EXISTS (SELECT 1 FROM users WHERE NOT is_demo) AS has_users');
  let user = null;
  if (req.session.userId) {
    const { rows } = await pool.query('SELECT id, email, role, is_demo FROM users WHERE id = $1', [req.session.userId]);
    user = rows[0] || null;
    if (!user) req.session.destroy(() => {});
  }
  res.json({
    setupRequired: !setup.rows[0].has_users,
    demoEnabled: demoEnabled(),
    authenticated: Boolean(user),
    user: user && { id: user.id, email: user.email, role: user.role, isDemo: user.is_demo },
  });
});

router.post('/setup', limiter, emailRule, newPasswordRule, validate, async (req, res) => {
  const { email, password } = req.body;
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727001)');
    const existing = await client.query('SELECT 1 FROM users WHERE NOT is_demo LIMIT 1');
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Setup has already been completed' });
    }
    const { rows } = await client.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin') RETURNING id, email, role",
      [email, hash]
    );
    await client.query('COMMIT');
    await startSession(req, rows[0]);
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

router.post('/login', limiter, emailRule, body('password').isString().notEmpty(), validate, async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query('SELECT id, email, role, password_hash FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = await verifyPassword(user ? user.password_hash : await dummyHash, password);
  if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password' });
  await startSession(req, user);
  res.json({ user: { id: user.id, email: user.email, role: user.role } });
});

router.post('/demo', demoLimiter, async (req, res) => {
  if (!demoEnabled()) return res.status(404).json({ error: 'Demo mode is not enabled' });
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE is_demo');
  if (rows[0].n >= 200) {
    return res.status(503).json({ error: 'The demo is busy right now. Please try again in a few minutes.' });
  }
  const user = await createDemoUser();
  await startSession(req, user, { isDemo: true });
  res.status(201).json({ user });
});

const CURRENT_PASSWORD_MSG = 'Enter your current password';
const NEW_PASSWORD_MSG = 'New password must be 10 to 128 characters';

// Changes the signed-in user's password. The current password is checked with argon2.
// On success every other session of the user is deleted (other browsers and devices are
// signed out) and the current session is regenerated with a new ID, so a session ID that
// leaked before the change is no longer valid.
router.post('/password',
  requireAuth,
  passwordLimiter,
  body('currentPassword').isString().withMessage(CURRENT_PASSWORD_MSG).bail().notEmpty().withMessage(CURRENT_PASSWORD_MSG),
  body('newPassword').isString().withMessage(NEW_PASSWORD_MSG).bail()
    .isLength({ min: 10, max: 128 }).withMessage(NEW_PASSWORD_MSG),
  validate,
  async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const { rows } = await pool.query(
      'SELECT id, email, role, password_hash, is_demo FROM users WHERE id = $1',
      [req.session.userId]
    );
    const user = rows[0];
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Session expired' });
    }
    if (user.is_demo) return res.status(403).json({ error: "Demo accounts can't change their password" });
    if (!(await verifyPassword(user.password_hash, currentPassword))) {
      // 400, not 401: the browser treats 401 as "signed out" and would leave the page.
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'New password must be different from the current one' });
    }

    const hash = await hashPassword(newPassword);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
      await client.query("DELETE FROM session WHERE sid <> $1 AND sess->>'userId' = $2", [req.sessionID, String(user.id)]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    await startSession(req, user);
    res.json({ ok: true });
  }
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

module.exports = router;