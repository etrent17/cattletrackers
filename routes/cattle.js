const express = require('express');
const { body, param } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, validate } = require('../middleware/auth');
const { withTransaction, httpError, latestPastDate } = require('../lib/records');
const { optionalWeightRule, serverToday, sameWeight, syncWeight, insertWeighing } = require('../lib/weights');

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

// strict: reject well-formed but impossible dates (2026-02-30), which PostgreSQL would refuse with a 500
const isoDate = { strict: true };

const rules = [
  body('tagNumber').isString().trim().isLength({ min: 1, max: 25 }).withMessage('Invalid cow number'),
  body('nameBreed').optional({ values: 'falsy' }).isString().isLength({ max: 100 }),
  body('gender').optional({ values: 'falsy' }).isIn(['female', 'male']),
  body('birthDate').optional({ values: 'falsy' }).isISO8601(isoDate),
  body('lastCalvingDate').optional({ values: 'falsy' }).isISO8601(isoDate),
  body('expectedCalvingDate').optional({ values: 'falsy' }).isISO8601(isoDate),
  optionalWeightRule('weight'), // '' or null means no weight; 0 is refused (lib/weights.js)
  body('weightDate').optional({ values: 'falsy' }).isISO8601(isoDate).withMessage('Enter a valid weighing date').bail()
    .custom((v) => String(v).slice(0, 10) <= latestPastDate()).withMessage('The weighing date cannot be in the future'),
  body('medications').optional({ values: 'falsy' }).isString().isLength({ max: 500 }),
  body('healthStatus').optional({ values: 'falsy' }).isIn(['healthy', 'under_treatment', 'quarantine', 'pregnant']),
  body('notes').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }),
];

const fields = (b) => [
  b.tagNumber, orNull(b.nameBreed), orNull(b.gender), orNull(b.birthDate), orNull(b.weight),
  orNull(b.lastCalvingDate), orNull(b.expectedCalvingDate), orNull(b.medications),
  b.healthStatus || 'healthy', orNull(b.notes),
];

const LAST_CALVING_FIELD = 5; // position of lastCalvingDate in fields()
const WEIGHT_FIELD = 4; // position of weight in fields()

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM cattle WHERE owner_id = $1 ORDER BY created_at DESC',
    [req.session.userId]
  );
  res.json(rows.map(toApi));
});

// Inserts an animal for the signed-in user and returns the row. Shared with routes that create
// animals as part of something else (a calf added with a calving), so the demo limit and the
// duplicate-number rule apply everywhere. Pass the transaction's client as `db`.
async function createCattle(db, session, data) {
  if (session.isDemo) {
    const { rows: c } = await db.query(
      'SELECT count(*)::int AS n FROM cattle WHERE owner_id = $1',
      [session.userId]
    );
    if (c[0].n >= 25) throw httpError(403, 'Demo accounts are limited to 25 animals.');
  }
  const { rows } = await db.query(
    `INSERT INTO cattle (owner_id, tag_number, name_breed, gender, birth_date, weight,
       last_calving_date, expected_calving_date, medications, health_status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [session.userId, ...fields(data)]
  );
  // A weight given with a new animal becomes its first weighing (dated `weightDate`, else today),
  // so cattle.weight always equals the newest weighing (see lib/weights.js).
  if (rows[0].weight != null) {
    await insertWeighing(db, {
      cattleId: rows[0].id, ownerId: session.userId, date: data.weightDate || serverToday(), weight: rows[0].weight,
    });
  }
  return rows[0];
}

// A last calving date given with a new animal becomes her first calving event, so the column
// always equals the newest event (see routes/calvings.js). Males never get one.
router.post('/', rules, validate, async (req, res) => {
  const data = { ...req.body };
  if (data.gender === 'male') data.lastCalvingDate = null;
  const row = await withTransaction(async (db) => {
    const created = await createCattle(db, req.session, data);
    if (created.last_calving_date) {
      await db.query(
        'INSERT INTO calving_events (cattle_id, owner_id, calving_date) VALUES ($1, $2, $3)',
        [created.id, req.session.userId, created.last_calving_date]
      );
    }
    return created;
  });
  res.status(201).json(toApi(row));
});

// lastCalvingDate is not updated here: it follows the animal's calving events.
// weight follows the weighings too: a weight that differs from the current one is recorded as a new
// weighing dated `weightDate` (else today); the same weight, or none, leaves the weighings alone.
router.put('/:id', param('id').isUUID(), rules, validate, async (req, res) => {
  const row = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `UPDATE cattle SET tag_number=$3, name_breed=$4, gender=$5, birth_date=$6,
         expected_calving_date=$7, medications=$8, health_status=$9,
         notes=$10, updated_at=now()
       WHERE id=$1 AND owner_id=$2 RETURNING *`,
      [req.params.id, req.session.userId, ...fields(req.body).filter((_, i) => i !== LAST_CALVING_FIELD && i !== WEIGHT_FIELD)]
    );
    if (!rows.length) throw httpError(404, 'Cattle not found');
    const weight = orNull(req.body.weight);
    if (weight == null || sameWeight(weight, rows[0].weight)) return rows[0];
    await insertWeighing(db, {
      cattleId: rows[0].id, ownerId: req.session.userId, date: req.body.weightDate || serverToday(), weight,
    });
    await syncWeight(db, rows[0].id);
    return (await db.query('SELECT * FROM cattle WHERE id = $1', [rows[0].id])).rows[0];
  });
  res.json(toApi(row));
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
module.exports.toApi = toApi;
module.exports.createCattle = createCattle;
