const express = require('express');
const { body, param, query } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, validate } = require('../middleware/auth');
const { withTransaction, httpError, latestPastDate, ownedCattle } = require('../lib/records');
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
  withdrawalUntil: r.withdrawal_until ?? '', // read-only: follows the animal's treatments (routes/treatments.js)
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

// Offline editing (feature 14). All three are optional; a request without them behaves as before.
// - `id` on POST: the UUID the browser gave an animal it created offline, so replaying the same
//   request cannot create it twice.
// - `expectedUpdatedAt` on PUT (body) and DELETE (query string or body): the record's `updatedAt`
//   as the client last saw it. If the row has changed since, the request is refused with 409 and
//   the current row, and nothing is written (the server's version wins).
const clientIdRule = body('id').optional({ values: 'null' }).isUUID().withMessage('Invalid id');
const expectedRule = (where) => where('expectedUpdatedAt').optional({ values: 'falsy' })
  .isISO8601().withMessage('Invalid expectedUpdatedAt');

// PostgreSQL keeps microseconds, JSON carries milliseconds; node-postgres already drops the rest
// when it builds the Date, so comparing milliseconds compares what the client was sent.
const isStale = (row, expected) => Boolean(expected) && new Date(row.updated_at).getTime() !== new Date(expected).getTime();

const conflict = (res, row) => res.status(409).json({
  error: 'This record was changed after you last loaded it. Your change was not saved.',
  code: 'stale',
  current: toApi(row),
});

// The same wording whether the id belongs to someone else or lost a race, so it says nothing
// about other users' records.
const ID_UNAVAILABLE = 'This record could not be saved with that id. Add it again.';

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
// duplicate-number rule apply everywhere. Pass the transaction's client as `db`. `data.id`
// (optional, a UUID) is used as the new row's id; only POST /api/cattle passes one.
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
       last_calving_date, expected_calving_date, medications, health_status, notes, id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12::uuid, gen_random_uuid()))
     ON CONFLICT (id) DO NOTHING RETURNING *`,
    [session.userId, ...fields(data), data.id || null]
  );
  // Only possible with a client-chosen id that another request took a moment ago.
  if (!rows.length) throw httpError(409, ID_UNAVAILABLE);
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
//
// With a client `id` the request can be repeated safely: when the signed-in user already has an
// animal with that id (an earlier attempt got through but its answer was lost), that animal is
// returned with 200 and nothing is written. An id that belongs to another user is refused.
router.post('/', clientIdRule, rules, validate, async (req, res) => {
  const data = { ...req.body };
  // Answers a request whose id is already taken; false when the id is free.
  const answerExisting = async () => {
    const { rows } = await pool.query('SELECT * FROM cattle WHERE id = $1', [data.id]);
    if (!rows.length) return false;
    if (rows[0].owner_id !== req.session.userId) res.status(409).json({ error: ID_UNAVAILABLE });
    else res.json(toApi(rows[0]));
    return true;
  };
  if (data.id && await answerExisting()) return;
  if (data.gender === 'male') data.lastCalvingDate = null;
  let row;
  try {
    row = await withTransaction(async (db) => {
      const created = await createCattle(db, req.session, data);
      if (created.last_calving_date) {
        await db.query(
          'INSERT INTO calving_events (cattle_id, owner_id, calving_date) VALUES ($1, $2, $3)',
          [created.id, req.session.userId, created.last_calving_date]
        );
      }
      return created;
    });
  } catch (err) {
    // Two copies of the same create arrived together: the loser answers like any other replay.
    if (data.id && err.message === ID_UNAVAILABLE && await answerExisting()) return;
    throw err;
  }
  res.status(201).json(toApi(row));
});

// lastCalvingDate is not updated here: it follows the animal's calving events.
// weight follows the weighings too: a weight that differs from the current one is recorded as a new
// weighing dated `weightDate` (else today); the same weight, or none, leaves the weighings alone.
router.put('/:id', param('id').isUUID(), expectedRule(body), rules, validate, async (req, res) => {
  let stale = null;
  const row = await withTransaction(async (db) => {
    if (req.body.expectedUpdatedAt) {
      const current = await ownedCattle(db, req.params.id, req.session.userId, { lock: true });
      if (!current) throw httpError(404, 'Cattle not found');
      if (isStale(current, req.body.expectedUpdatedAt)) {
        stale = current;
        return null;
      }
    }
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
  if (stale) return conflict(res, stale);
  res.json(toApi(row));
});

router.delete('/:id', param('id').isUUID(), expectedRule(query), expectedRule(body), validate, async (req, res) => {
  const expected = req.query.expectedUpdatedAt || req.body?.expectedUpdatedAt;
  let stale = null;
  const deleted = await withTransaction(async (db) => {
    if (expected) {
      const current = await ownedCattle(db, req.params.id, req.session.userId, { lock: true });
      if (current && isStale(current, expected)) {
        stale = current;
        return false;
      }
    }
    const result = await db.query(
      'DELETE FROM cattle WHERE id=$1 AND owner_id=$2',
      [req.params.id, req.session.userId]
    );
    return result.rowCount > 0;
  });
  if (stale) return conflict(res, stale);
  if (!deleted) return res.status(404).json({ error: 'Cattle not found' });
  res.json({ ok: true });
});

module.exports = router;
module.exports.toApi = toApi;
module.exports.createCattle = createCattle;
