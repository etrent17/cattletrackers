const { validationResult } = require('express-validator');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function validate(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) return res.status(400).json({ error: result.array()[0].msg });
  next();
}

module.exports = { requireAuth, requireAdmin, validate };