// Financial records: income and expenses, optionally linked to one of the user's animals.
//
// Money is exact end to end: amounts are stored as NUMERIC(12,2), summed in SQL, and
// returned as strings with two decimals ("1234.50"), never as JavaScript numbers.
const express = require('express');
const { body, param, query } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, validate } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const KINDS = ['income', 'expense'];
const DEMO_LIMIT = 200;
// Up to 10 digits before the point (NUMERIC(12,2)) and at most 2 after it.
const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toApi = (r) => ({
  id: r.id,
  date: r.date,
  kind: r.kind,
  category: r.category,
  amount: r.amount,
  cattleId: r.cattle_id ?? null,
  cattleTagNumber: r.tag_number ?? null,
  cattleName: r.name_breed ?? null,
  description: r.description ?? '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// A calendar date written as YYYY-MM-DD that exists (no 2026-02-30).
const dateRule = (chain, message) =>
  chain.isString().withMessage(message).bail().matches(DATE_RE).withMessage(message).bail().isISO8601({ strict: true }).withMessage(message);

const rules = [
  dateRule(body('date'), 'Enter a valid date (YYYY-MM-DD)'),
  body('kind').isIn(KINDS).withMessage('Type must be income or expense'),
  body('category').isString().withMessage('Enter a category').bail().trim()
    .isLength({ min: 1, max: 50 }).withMessage('Category must be 1 to 50 characters'),
  body('amount')
    .custom((v) => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string')
    .withMessage('Enter an amount')
    .bail()
    .customSanitizer((v) => String(v).trim())
    .custom((v) => AMOUNT_RE.test(v) && Number(v) > 0)
    .withMessage('Amount must be greater than 0, with at most 2 decimal places and 10 digits'),
  body('cattleId').optional({ values: 'falsy' }).isString().bail().isUUID().withMessage('Unknown animal'),
  body('description').optional({ values: 'falsy' }).isString().isLength({ max: 500 })
    .withMessage('Description must be at most 500 characters'),
];

const rangeRules = [
  dateRule(query('from').optional({ values: 'falsy' }), 'Invalid "from" date'),
  dateRule(query('to').optional({ values: 'falsy' }), 'Invalid "to" date'),
  query('to').custom((to, { req }) => !to || !req.query.from || req.query.from <= to)
    .withMessage('"from" must be on or before "to"'),
];

const fields = (b) => [b.date, b.kind, b.category, b.amount, b.cattleId || null, b.description || null];

// The animal must belong to the user; otherwise 400 (never reveal other users' animals).
async function ownsCattle(cattleId, userId) {
  if (!cattleId) return true;
  const { rowCount } = await pool.query('SELECT 1 FROM cattle WHERE id = $1 AND owner_id = $2', [cattleId, userId]);
  return rowCount > 0;
}

// The animal was deleted between the ownership check and the write.
const isCattleGone = (err) => err.code === '23503' && err.constraint === 'transactions_cattle_id_fkey';
const UNKNOWN_ANIMAL = { error: 'Unknown animal' };

// Builds "owner_id = $1 [AND date >= $n] [AND date <= $n] [AND cattle_id = $n]".
function filters(req, { cattle = true } = {}) {
  const params = [req.session.userId];
  const where = ['t.owner_id = $1'];
  if (req.query.from) where.push(`t.date >= $${params.push(req.query.from)}`);
  if (req.query.to) where.push(`t.date <= $${params.push(req.query.to)}`);
  if (cattle && req.query.cattleId) where.push(`t.cattle_id = $${params.push(req.query.cattleId)}`);
  return { where: where.join(' AND '), params };
}

const SELECT_WITH_CATTLE = `
  SELECT t.*, c.tag_number, c.name_breed
  FROM transactions t LEFT JOIN cattle c ON c.id = t.cattle_id`;

async function fetchOne(id, userId) {
  const { rows } = await pool.query(`${SELECT_WITH_CATTLE} WHERE t.id = $1 AND t.owner_id = $2`, [id, userId]);
  return rows[0];
}

router.get('/', rangeRules, query('cattleId').optional({ values: 'falsy' }).isString().bail().isUUID().withMessage('Invalid animal id'),
  validate, async (req, res) => {
    const { where, params } = filters(req);
    const { rows } = await pool.query(
      `${SELECT_WITH_CATTLE} WHERE ${where} ORDER BY t.date DESC, t.created_at DESC`,
      params
    );
    res.json(rows.map(toApi));
  });

// Report figures for the range. Every total is a NUMERIC sum rounded to cents, as a string.
//   income, expenses, net = income - expenses
//   byCategory: one row per (kind, category), largest first
//   byMonth: one row per calendar month that has transactions, oldest first
//   costPerHead = expenses in the range / animals on record now (null when there are none).
//     This is the current herd size, not an average over the period.
router.get('/summary', rangeRules, validate, async (req, res) => {
  const { where, params } = filters(req, { cattle: false });
  const income = "COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'income'), 0)";
  const expense = "COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'expense'), 0)";

  // One read-only snapshot, so the totals, categories and months always agree.
  const client = await pool.connect();
  let totals, byCategory, byMonth;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    ({ rows: [totals] } = await client.query(
      `WITH s AS (
         SELECT ${income} AS inc, ${expense} AS exp, count(*)::int AS n FROM transactions t WHERE ${where}
       ), h AS (
         SELECT count(*)::int AS n FROM cattle WHERE owner_id = $1
       )
       SELECT round(s.inc, 2)::text AS income, round(s.exp, 2)::text AS expenses,
              round(s.inc - s.exp, 2)::text AS net, s.n AS count, h.n AS herd_size,
              CASE WHEN h.n > 0 THEN round(s.exp / h.n, 2)::text END AS cost_per_head
       FROM s, h`,
      params
    ));
    ({ rows: byCategory } = await client.query(
      `SELECT t.kind, t.category, round(SUM(t.amount), 2)::text AS total, count(*)::int AS count
       FROM transactions t WHERE ${where}
       GROUP BY t.kind, t.category ORDER BY t.kind DESC, SUM(t.amount) DESC, t.category`,
      params
    ));
    ({ rows: byMonth } = await client.query(
      `SELECT to_char(t.date, 'YYYY-MM') AS month, round(${income}, 2)::text AS income,
              round(${expense}, 2)::text AS expenses, round(${income} - ${expense}, 2)::text AS net
       FROM transactions t WHERE ${where}
       GROUP BY 1 ORDER BY 1`,
      params
    ));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  res.json({
    from: req.query.from || null,
    to: req.query.to || null,
    count: totals.count,
    income: totals.income,
    expenses: totals.expenses,
    net: totals.net,
    herdSize: totals.herd_size,
    costPerHead: totals.cost_per_head,
    byCategory,
    byMonth,
  });
});

router.post('/', rules, validate, async (req, res) => {
  const userId = req.session.userId;
  if (req.session.isDemo) {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM transactions WHERE owner_id = $1', [userId]);
    if (rows[0].n >= DEMO_LIMIT) {
      return res.status(403).json({ error: `Demo accounts are limited to ${DEMO_LIMIT} transactions.` });
    }
  }
  if (!(await ownsCattle(req.body.cattleId, userId))) return res.status(400).json(UNKNOWN_ANIMAL);

  let id;
  try {
    const { rows } = await pool.query(
      `INSERT INTO transactions (owner_id, date, kind, category, amount, cattle_id, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [userId, ...fields(req.body)]
    );
    id = rows[0].id;
  } catch (err) {
    if (isCattleGone(err)) return res.status(400).json(UNKNOWN_ANIMAL);
    throw err;
  }
  res.status(201).json(toApi(await fetchOne(id, userId)));
});

router.put('/:id', param('id').isUUID().withMessage('Transaction not found'), rules, validate, async (req, res) => {
  const userId = req.session.userId;
  if (!(await ownsCattle(req.body.cattleId, userId))) return res.status(400).json(UNKNOWN_ANIMAL);

  let rowCount;
  try {
    ({ rowCount } = await pool.query(
      `UPDATE transactions SET date=$3, kind=$4, category=$5, amount=$6, cattle_id=$7, description=$8,
         updated_at=now()
       WHERE id=$1 AND owner_id=$2`,
      [req.params.id, userId, ...fields(req.body)]
    ));
  } catch (err) {
    if (isCattleGone(err)) return res.status(400).json(UNKNOWN_ANIMAL);
    throw err;
  }
  if (!rowCount) return res.status(404).json({ error: 'Transaction not found' });
  res.json(toApi(await fetchOne(req.params.id, userId)));
});

router.delete('/:id', param('id').isUUID().withMessage('Transaction not found'), validate, async (req, res) => {
  const result = await pool.query('DELETE FROM transactions WHERE id=$1 AND owner_id=$2', [req.params.id, req.session.userId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ ok: true });
});

module.exports = router;
