// Weighings (feature 10): helpers shared by routes/weighings.js and routes/cattle.js, which both
// write weighings. Kept apart from routes/ so the two route files do not require each other.
//
// cattle.weight is kept, not derived: it always equals the animal's newest weighing (latest date,
// then latest created_at), or NULL when it has none. Every insert, update and delete of a weighing
// calls syncWeight() in the same transaction, after taking the animal's row lock.
const { body } = require('express-validator');
const { latestPastDate } = require('./records');

// Weights are in lbs, stored as NUMERIC(7,2). The smallest weight that survives rounding to two
// decimals is 0.01, so "greater than 0" is checked as at least 0.01.
const MIN_WEIGHT = 0.01;
const MAX_WEIGHT = 5000;

// Whether a value from a request is a usable weight: a JSON number or a numeric string, from
// 0.01 to 5000. Booleans, blank strings, 0 and negatives are not.
function isWeight(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  const n = Number(v);
  return Number.isFinite(n) && n >= MIN_WEIGHT && n <= MAX_WEIGHT;
}

// "No weight" in a request: left out, null, or an empty string (what a blank form field sends).
const isBlank = (v) => v === undefined || v === null || v === '';

// Validation rule for a weight that may be left blank (the cattle form). 0 is not blank: it is
// checked, and refused, like any other number. (optional({ values: 'falsy' }) used to skip it.)
const optionalWeightRule = (field) =>
  body(field).custom((v) => isBlank(v) || isWeight(v)).withMessage('Invalid weight');

// Validation rule for a required weight (a weighing).
const weightRule = (field) => body(field).custom(isWeight).withMessage('Invalid weight');

// A 'YYYY-MM-DD' (or ISO 8601 date-time) that is not in the future.
const notFuture = (v) => String(v).slice(0, 10) <= latestPastDate();

// Today by the server's (UTC) clock. Used only when a client gives no date; the app always sends
// the user's local date.
const serverToday = () => new Date().toISOString().slice(0, 10);

// Two weights are the same when they round to the same cents (what NUMERIC(7,2) stores).
const sameWeight = (a, b) => a != null && b != null && Math.round(Number(a) * 100) === Math.round(Number(b) * 100);

// Sets cattle.weight to the animal's newest weighing (NULL when none are left).
async function syncWeight(db, cattleId) {
  await db.query(
    `UPDATE cattle SET updated_at = now(),
       weight = (SELECT w.weight FROM weighings w WHERE w.cattle_id = $1
                 ORDER BY w.date DESC, w.created_at DESC, w.id DESC LIMIT 1)
     WHERE id = $1`,
    [cattleId]
  );
}

// Inserts one weighing and returns its id. The caller holds the animal's lock and calls
// syncWeight() afterwards.
async function insertWeighing(db, { cattleId, ownerId, date, weight, notes = null }) {
  const { rows } = await db.query(
    `INSERT INTO weighings (cattle_id, owner_id, date, weight, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [cattleId, ownerId, String(date).slice(0, 10), weight, notes === '' ? null : notes]
  );
  return rows[0].id;
}

module.exports = {
  MIN_WEIGHT, MAX_WEIGHT, isWeight, isBlank, optionalWeightRule, weightRule, notFuture, serverToday,
  sameWeight, syncWeight, insertWeighing,
};
