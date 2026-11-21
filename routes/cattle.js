const express = require('express');
const { body, param } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, validate } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const orNull = (v) => (v === '' || v === undefined ? null : v);

const toApi = (r) => ({
  id: r.id,
  tagNumber: r.tag_number,
  nameBreed: r.name_breed ?? '',
  gender: r.gender ?? '',
  birthDate: r.birth_date ?? '',
  weight: r.weight == null ? null : Number(r.weight),
  lastCalvingDate: r.last_calving_date ?? '',
  expectedCalvingDate: r.expected_calving_date ?? '',
  medications: r.medications ?? '',
  healthStatus: r.health_status,
  notes: r.notes ?? '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const rules = [
  body('tagNumber').isString().trim().isLength({ min: 1, max: 25 }).withMessage('Invalid cow number'),
  body('nameBreed').optional({ values: 'falsy' }).isString().isLength({ max: 100 }),
  body('gender').optional({ values: 'falsy' }).isIn(['female', 'male']),
  body('birthDate').optional({ values: 'falsy' }).isISO8601(),
  body('lastCalvingDate').optional({ values: 'falsy' }).isISO8601(),
  body('expectedCalvingDate').optional({ values: 'falsy' }).isISO8601(),
  body('weight').optional({ values: 'falsy' }).isFloat({ gt: 0, max: 5000 }).withMessage('Invalid weight'),
  body('medications').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  body('healthStatus').optional({ values: 'falsy' }).isIn(['healthy', 'under_treatment', 'quarantine', 'pregnant']),
  body('notes').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }),
];

const fields = (b) => [
  b.tagNumber, orNull(b.nameBreed), orNull(b.gender), orNull(b.birthDate), orNull(b.weight),
  orNull(b.lastCalvingDate), orNull(b.expectedCalvingDate), orNull(b.medications),
  b.healthStatus || 'healthy', orNull(b.notes),
];

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM cattle WHERE owner_id = $1 ORDER BY created_at DESC',
    [req.session.userId]
  );
  res.json(rows.map(toApi));
});

router.post('/', rules, validate, async (req, res) => {
  if (req.session.isDemo) {
    const { rows: c } = await pool.query(
      'SELECT count(*)::int AS n FROM cattle WHERE owner_id = $1',
      [req.session.userId]
    );
    if (c[0].n >= 25) {
      return res.status(403).json({ error: 'Demo accounts are limited to 25 animals.' });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO cattle (owner_id, tag_number, name_breed, gender, birth_date, weight,
       last_calving_date, expected_calving_date, medications, health_status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [req.session.userId, ...fields(req.body)]
  );
  res.status(201).json(toApi(rows[0]));
});

router.put('/:id', param('id').isUUID(), rules, validate, async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE cattle SET tag_number=$3, name_breed=$4, gender=$5, birth_date=$6, weight=$7,
       last_calving_date=$8, expected_calving_date=$9, medications=$10, health_status=$11,
       notes=$12, updated_at=now()
     WHERE id=$1 AND owner_id=$2 RETURNING *`,
    [req.params.id, req.session.userId, ...fields(req.body)]
  );
  if (!rows.length) return res.status(404).json({ error: 'Cattle not found' });
  res.json(toApi(rows[0]));
});

router.delete('/:id', param('id').isUUID(), validate, async (req, res) => {
  const result = await pool.query(
    'DELETE FROM cattle WHERE id=$1 AND owner_id=$2',
    [req.params.id, req.session.userId]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Cattle not found' });
  res.json({ ok: true });
});

module.exports = router;