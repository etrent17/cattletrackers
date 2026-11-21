const { validationResult } = require('express-validator');
const { pool } = require('../db');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Authentication required' });
  next();
}

// Reads the role from the database on every admin request rather than trusting the copy saved in
// the session at sign-in, so a demotion takes effect on the demoted user's very next request.
// A session whose user no longer exists is ended. Use after requireAuth.
async function requireAdmin(req, res, next) {
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.session.userId]);
  if (!rows.length) {
    await new Promise((resolve) => req.session.destroy(() => resolve()));
    return res.status(401).json({ error: 'Session expired' });
  }
  if (rows[0].role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function validate(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) return res.status(400).json({ error: result.array()[0].msg });
  next();
}

module.exports = { requireAuth, requireAdmin, validate };