const express = require('express');
const { body, param } = require('express-validator');
const { pool } = require('../db');
const { hashPassword } = require('../lib/password');
const { requireAuth, requireAdmin, validate } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT id, email, role, created_at FROM users WHERE NOT is_demo ORDER BY id');
  res.json(rows);
});

router.post('/',
  body('email').isString().trim().toLowerCase().isEmail().withMessage('Enter a valid email'),
  body('password').isString().isLength({ min: 10, max: 128 }).withMessage('Password must be 10 to 128 characters'),
  body('role').optional().isIn(['admin', 'user']),
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

router.delete('/:id', param('id').isInt().toInt(), validate, async (req, res) => {
  if (req.params.id === req.session.userId) return res.status(400).json({ error: "You can't delete yourself" });
  const result = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

module.exports = router;