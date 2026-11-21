// Weighings (feature 10), following the event records pattern of routes/calvings.js
// (see "Event records pattern" in docs/architecture-and-data.md).
//
//   forCattle  mounted at /api/cattle/:cattleId/weighings   GET (one animal's history), POST
//   router     mounted at /api/weighings                    GET (whole herd), POST /batch,
//                                                            PUT /:id, DELETE /:id
//
// cattle.weight always equals the animal's newest weighing: syncWeight() (lib/weights.js) runs in
// the same transaction as every insert, update and delete, after the animal's row is locked.
// Weights are in lbs.
const express = require('express');
const { body, param } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, validate } = require('../middleware/auth');
const { orNull, isoDate, withTransaction, httpError, ownedCattle } = require('../lib/records');
const { isWeight, weightRule, notFuture, syncWeight, insertWeighing } = require('../lib/weights');

const forCattle = express.Router({ mergeParams: true });
const router = express.Router();
forCattle.use(requireAuth);
router.use(requireAuth);

const toApi = (r) => ({
  id: r.id,
  cattleId: r.cattle_id,
  cattleTag: r.cattle_tag,
  cattleName: r.cattle_name ?? '',
  date: r.date,
  weight: Number(r.weight),
  notes: r.notes ?? '',
  createdAt: r.created_at,
});

const SELECT = `
  SELECT w.*, c.tag_number AS cattle_tag, c.name_breed AS cattle_name
  FROM weighings w JOIN cattle c ON c.id = w.cattle_id`;
const NEWEST_FIRST = 'ORDER BY w.date DESC, w.created_at DESC, w.id DESC';

const MAX_NOTES = 2000;
const MAX_BATCH_ROWS = 500;

const dateRule = body('date').isISO8601(isoDate).withMessage('Enter a valid weighing date').bail()
  .custom(notFuture).withMessage('The weighing date cannot be in the future');

const rules = [
  dateRule,
  weightRule('weight'),
  body('notes').optional({ values: 'falsy' }).isString().isLength({ max: MAX_NOTES }).withMessage('Notes are too long'),
];

const one = async (db, id) => (await db.query(`${SELECT} WHERE w.id = $1`, [id])).rows[0];

// ----- /api/cattle/:cattleId/weighings --------------------------------------------------------

const cattleId = param('cattleId').isUUID().withMessage('Invalid cattle id');

forCattle.get('/', cattleId, validate, async (req, res) => {
  if (!(await ownedCattle(pool, req.params.cattleId, req.session.userId))) {
    return res.status(404).json({ error: 'Cattle not found' });
  }
  const { rows } = await pool.query(
    `${SELECT} WHERE w.cattle_id = $1 AND w.owner_id = $2 ${NEWEST_FIRST}`,
    [req.params.cattleId, req.session.userId]
  );
  res.json(rows.map(toApi));
});

forCattle.post('/', cattleId, rules, validate, async (req, res) => {
  const weighing = await withTransaction(async (db) => {
    const cow = await ownedCattle(db, req.params.cattleId, req.session.userId, { lock: true });
    if (!cow) throw httpError(404, 'Cattle not found');
    const id = await insertWeighing(db, {
      cattleId: cow.id, ownerId: req.session.userId, date: req.body.date, weight: req.body.weight, notes: orNull(req.body.notes),
    });
    await syncWeight(db, cow.id);
    return one(db, id);
  });
  res.status(201).json(toApi(weighing));
});

// ----- /api/weighings -------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const { rows } = await pool.query(`${SELECT} WHERE w.owner_id = $1 ${NEWEST_FIRST}`, [req.session.userId]);
  res.json(rows.map(toApi));
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Checks one batch row on its own; returns the error message, or null when it can be saved.
function rowProblem(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'Invalid row';
  if (typeof row.cattleId !== 'string' || !UUID.test(row.cattleId)) return 'Choose an animal';
  if (!isWeight(row.weight)) return 'Invalid weight';
  if (row.notes != null && row.notes !== '' && (typeof row.notes !== 'string' || row.notes.length > MAX_NOTES)) {
    return 'Notes are too long';
  }
  return null;
}

// Records many weighings on one date: { date, rows: [{ cattleId, weight, notes? }] }.
// Rows are judged one by one: every valid row is saved, and each invalid one is reported by its
// position in `rows` with the reason, so one typo does not lose the rest of a weigh day. The saved
// rows are written in one transaction, so a server error saves none of them. A bad date or an empty
// or oversized `rows` is a 400 for the whole request.
// Answers 200 { date, saved: [{ index, weighing }], failed: [{ index, cattleId, error }] }.
router.post(
  '/batch',
  dateRule,
  body('rows').isArray({ min: 1, max: MAX_BATCH_ROWS }).withMessage(`Send 1 to ${MAX_BATCH_ROWS} rows`),
  validate,
  async (req, res) => {
    const userId = req.session.userId;
    const date = String(req.body.date).slice(0, 10);
    const failed = [];
    const valid = [];
    const seen = new Set();
    req.body.rows.forEach((row, index) => {
      let error = rowProblem(row);
      const id = error ? null : row.cattleId.toLowerCase();
      if (!error && seen.has(id)) error = 'This animal is already in the batch';
      if (error) {
        failed.push({ index, cattleId: typeof row?.cattleId === 'string' ? row.cattleId : null, error });
        return;
      }
      seen.add(id);
      valid.push({ index, row, id });
    });

    const saved = await withTransaction(async (db) => {
      // Lock every animal involved, in id order, so concurrent writers cannot deadlock.
      const { rows: owned } = await db.query(
        'SELECT id FROM cattle WHERE id = ANY($1::uuid[]) AND owner_id = $2 ORDER BY id FOR UPDATE',
        [valid.map((v) => v.id), userId]
      );
      const mine = new Set(owned.map((r) => r.id));
      const inserted = [];
      for (const { index, row, id } of valid) {
        if (!mine.has(id)) {
          failed.push({ index, cattleId: row.cattleId, error: 'Animal not found' });
          continue;
        }
        const weighingId = await insertWeighing(db, {
          cattleId: id, ownerId: userId, date, weight: row.weight, notes: orNull(row.notes),
        });
        inserted.push({ index, weighingId });
      }
      for (const id of mine) await syncWeight(db, id);
      const result = [];
      for (const { index, weighingId } of inserted) result.push({ index, weighing: toApi(await one(db, weighingId)) });
      return result;
    });

    failed.sort((a, b) => a.index - b.index);
    res.json({ date, saved, failed });
  }
);

const weighingId = param('id').isUUID().withMessage('Invalid weighing id');

// Finds the weighing (404 when it is not the user's), then locks its animal, in the same order as
// POST takes its locks.
async function lockWeighing(db, id, userId) {
  const found = await db.query('SELECT cattle_id FROM weighings WHERE id=$1 AND owner_id=$2', [id, userId]);
  if (!found.rows.length) throw httpError(404, 'Weighing not found');
  await ownedCattle(db, found.rows[0].cattle_id, userId, { lock: true });
  return found.rows[0].cattle_id;
}

// Replaces the weighing's fields (like PUT /api/cattle/:id). The animal cannot change.
router.put('/:id', weighingId, rules, validate, async (req, res) => {
  const weighing = await withTransaction(async (db) => {
    const cowId = await lockWeighing(db, req.params.id, req.session.userId);
    const { rowCount } = await db.query(
      'UPDATE weighings SET date=$3, weight=$4, notes=$5 WHERE id=$1 AND owner_id=$2',
      [req.params.id, req.session.userId, String(req.body.date).slice(0, 10), req.body.weight, orNull(req.body.notes)]
    );
    if (!rowCount) throw httpError(404, 'Weighing not found');
    await syncWeight(db, cowId);
    return one(db, req.params.id);
  });
  res.json(toApi(weighing));
});

router.delete('/:id', weighingId, validate, async (req, res) => {
  await withTransaction(async (db) => {
    const cowId = await lockWeighing(db, req.params.id, req.session.userId);
    const { rowCount } = await db.query('DELETE FROM weighings WHERE id=$1 AND owner_id=$2', [req.params.id, req.session.userId]);
    if (!rowCount) throw httpError(404, 'Weighing not found');
    await syncWeight(db, cowId);
  });
  res.json({ ok: true });
});

module.exports = { forCattle, router };
