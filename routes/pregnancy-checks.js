// Pregnancy checks, following the calving template (see "Event records pattern" in
// docs/architecture-and-data.md). Breedings are in routes/breedings.js.
//
//   forCattle  mounted at /api/cattle/:cattleId/pregnancy-checks   GET (one animal's checks), POST
//   router     mounted at /api/pregnancy-checks                    GET (whole herd), PUT /:id, DELETE /:id
//
// How a check's result moves the cow's health status and expected calving date is in
// lib/breeding.js.
const express = require('express');
const { body, param } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, validate } = require('../middleware/auth');
const { orNull, isoDate, latestPastDate, withTransaction, httpError, ownedCattle } = require('../lib/records');
const { impliedExpected, followRecords, afterCheckSaved } = require('../lib/breeding');

const forCattle = express.Router({ mergeParams: true });
const router = express.Router();
forCattle.use(requireAuth);
router.use(requireAuth);

const toApi = (r) => ({
  id: r.id,
  cattleId: r.cattle_id,
  cattleTag: r.cattle_tag,
  cattleName: r.cattle_name ?? '',
  checkDate: r.check_date,
  result: r.result,
  method: r.method ?? '',
  breedingId: r.breeding_id ?? null,
  breedingDate: r.breeding_date ?? '',
  notes: r.notes ?? '',
  createdAt: r.created_at,
});

const SELECT = `
  SELECT e.*, c.tag_number AS cattle_tag, c.name_breed AS cattle_name, b.breeding_date
  FROM pregnancy_checks e
  JOIN cattle c ON c.id = e.cattle_id
  LEFT JOIN breeding_events b ON b.id = e.breeding_id`;
const NEWEST_FIRST = 'ORDER BY e.check_date DESC, e.created_at DESC';

const rules = [
  body('checkDate').isISO8601(isoDate).withMessage('Enter a valid check date').bail()
    .custom((v) => String(v).slice(0, 10) <= latestPastDate()).withMessage('The check date cannot be in the future'),
  body('result').isIn(['pregnant', 'open', 'unsure']).withMessage('Choose a result: pregnant, open or unsure'),
  body('method').optional({ values: 'falsy' }).isIn(['palpation', 'ultrasound', 'blood_test', 'other']).withMessage('Invalid check method'),
  body('breedingId').optional({ values: 'falsy' }).isUUID().withMessage('Unknown breeding record'),
  body('notes').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }).withMessage('Notes are too long'),
];

// The breeding a check refers to must be one of this cow's, dated on or before the check.
async function checkBreeding(db, b, cowId) {
  if (!b.breedingId) return null;
  const { rows } = await db.query('SELECT breeding_date FROM breeding_events WHERE id = $1 AND cattle_id = $2', [b.breedingId, cowId]);
  if (!rows.length) throw httpError(400, 'Unknown breeding record');
  if (rows[0].breeding_date > b.checkDate.slice(0, 10)) throw httpError(400, 'The check date cannot be before the breeding date');
  return b.breedingId;
}

const fields = (b, breedingId) => [b.checkDate.slice(0, 10), b.result, orNull(b.method), breedingId, orNull(b.notes)];

const one = async (db, id) => (await db.query(`${SELECT} WHERE e.id = $1`, [id])).rows[0];

// ----- /api/cattle/:cattleId/pregnancy-checks -------------------------------------------------

const cattleId = param('cattleId').isUUID().withMessage('Invalid cattle id');

forCattle.get('/', cattleId, validate, async (req, res) => {
  if (!(await ownedCattle(pool, req.params.cattleId, req.session.userId))) {
    return res.status(404).json({ error: 'Cattle not found' });
  }
  const { rows } = await pool.query(
    `${SELECT} WHERE e.cattle_id = $1 AND e.owner_id = $2 ${NEWEST_FIRST}`,
    [req.params.cattleId, req.session.userId]
  );
  res.json(rows.map(toApi));
});

forCattle.post('/', cattleId, rules, validate, async (req, res) => {
  const userId = req.session.userId;
  const check = await withTransaction(async (db) => {
    const cow = await ownedCattle(db, req.params.cattleId, userId, { lock: true });
    if (!cow) throw httpError(404, 'Cattle not found');
    if (cow.gender === 'male') throw httpError(400, 'Only female animals can have pregnancy checks');
    const breedingId = await checkBreeding(db, req.body, cow.id);
    const before = await impliedExpected(db, cow.id);
    const { rows } = await db.query(
      `INSERT INTO pregnancy_checks (cattle_id, owner_id, check_date, result, method, breeding_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [cow.id, userId, ...fields(req.body, breedingId)]
    );
    await afterCheckSaved(db, cow.id, rows[0].id, before);
    return one(db, rows[0].id);
  });
  res.status(201).json(toApi(check));
});

// ----- /api/pregnancy-checks ------------------------------------------------------------------

router.get('/', async (req, res) => {
  const { rows } = await pool.query(`${SELECT} WHERE e.owner_id = $1 ${NEWEST_FIRST}`, [req.session.userId]);
  res.json(rows.map(toApi));
});

const checkId = param('id').isUUID().withMessage('Invalid check id');

async function lockCheckCow(db, id, userId) {
  const found = await db.query('SELECT cattle_id FROM pregnancy_checks WHERE id=$1 AND owner_id=$2', [id, userId]);
  if (!found.rows.length) throw httpError(404, 'Pregnancy check not found');
  await ownedCattle(db, found.rows[0].cattle_id, userId, { lock: true });
  return found.rows[0].cattle_id;
}

// Replaces the check's fields. The animal it belongs to cannot change.
router.put('/:id', checkId, rules, validate, async (req, res) => {
  const userId = req.session.userId;
  const check = await withTransaction(async (db) => {
    const cowId = await lockCheckCow(db, req.params.id, userId);
    const breedingId = await checkBreeding(db, req.body, cowId);
    const before = await impliedExpected(db, cowId);
    const { rows } = await db.query(
      `UPDATE pregnancy_checks SET check_date=$3, result=$4, method=$5, breeding_id=$6, notes=$7
       WHERE id=$1 AND owner_id=$2 RETURNING id`,
      [req.params.id, userId, ...fields(req.body, breedingId)]
    );
    if (!rows.length) throw httpError(404, 'Pregnancy check not found');
    await afterCheckSaved(db, cowId, rows[0].id, before);
    return one(db, rows[0].id);
  });
  res.json(toApi(check));
});

// Deletes the check. The health status is left as it is (what it was before the check is not
// known); the expected calving date follows the records again (see lib/breeding.js).
router.delete('/:id', checkId, validate, async (req, res) => {
  const userId = req.session.userId;
  await withTransaction(async (db) => {
    const cowId = await lockCheckCow(db, req.params.id, userId);
    const before = await impliedExpected(db, cowId);
    const { rowCount } = await db.query('DELETE FROM pregnancy_checks WHERE id=$1 AND owner_id=$2', [req.params.id, userId]);
    if (!rowCount) throw httpError(404, 'Pregnancy check not found');
    await followRecords(db, cowId, before);
  });
  res.json({ ok: true });
});

module.exports = { forCattle, router };
