// Breeding events, following the calving template (see "Event records pattern" in
// docs/architecture-and-data.md). Pregnancy checks are in routes/pregnancy-checks.js.
//
//   forCattle  mounted at /api/cattle/:cattleId/breedings   GET (one animal's history), POST
//   router     mounted at /api/breedings                    GET (whole herd), GET /needs-check,
//                                                           PUT /:id, DELETE /:id
//
// How breedings move the cow's expected calving date is in lib/breeding.js.
const express = require('express');
const { body, param, query } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, validate } = require('../middleware/auth');
const { orNull, isoDate, latestPastDate, withTransaction, httpError, ownedCattle } = require('../lib/records');
const { GESTATION_DAYS, CHECK_AFTER_DAYS, impliedExpected, followRecords, afterBreedingRecorded } = require('../lib/breeding');

const forCattle = express.Router({ mergeParams: true });
const router = express.Router();
forCattle.use(requireAuth);
router.use(requireAuth);

const toApi = (r) => ({
  id: r.id,
  cattleId: r.cattle_id,
  cattleTag: r.cattle_tag,
  cattleName: r.cattle_name ?? '',
  breedingDate: r.breeding_date,
  method: r.method ?? '',
  sire: r.sire ?? '',
  sireCattleId: r.sire_cattle_id ?? null,
  sireTag: r.sire_tag ?? '',
  sireName: r.sire_name ?? '',
  technician: r.technician ?? '',
  notes: r.notes ?? '',
  expectedCalvingDate: r.expected_calving_date,
  checkResult: r.check_result ?? '',
  checkDate: r.check_date ?? '',
  createdAt: r.created_at,
});

// Events are read with the cow's number and name, the linked bull's current number and name,
// the calving date this breeding implies, and the newest check linked to it.
const SELECT = `
  SELECT e.*, c.tag_number AS cattle_tag, c.name_breed AS cattle_name,
    s.tag_number AS sire_tag, s.name_breed AS sire_name,
    e.breeding_date + ${GESTATION_DAYS} AS expected_calving_date,
    pc.result AS check_result, pc.check_date
  FROM breeding_events e
  JOIN cattle c ON c.id = e.cattle_id
  LEFT JOIN cattle s ON s.id = e.sire_cattle_id
  LEFT JOIN LATERAL (
    SELECT result, check_date FROM pregnancy_checks p WHERE p.breeding_id = e.id
    ORDER BY p.check_date DESC, p.created_at DESC LIMIT 1
  ) pc ON true`;
const NEWEST_FIRST = 'ORDER BY e.breeding_date DESC, e.created_at DESC';

const rules = [
  body('breedingDate').isISO8601(isoDate).withMessage('Enter a valid breeding date').bail()
    .custom((v) => String(v).slice(0, 10) <= latestPastDate()).withMessage('The breeding date cannot be in the future'),
  body('method').optional({ values: 'falsy' }).isIn(['ai', 'natural']).withMessage('Invalid breeding method'),
  body('sire').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }).withMessage('The sire must be 100 characters or fewer'),
  body('sireCattleId').optional({ values: 'falsy' }).isUUID().withMessage('Choose a bull from your herd'),
  body('technician').optional({ values: 'falsy' }).isString().trim().isLength({ max: 100 }).withMessage('The technician must be 100 characters or fewer'),
  body('notes').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }).withMessage('Notes are too long'),
];

// A bull from the herd as the sire: it must be one of the user's animals recorded as male. Its
// number and name are kept in `sire` too, so the breeding still names it if the bull is deleted.
// FOR KEY SHARE stops the bull being deleted before the breeding is saved.
async function resolveSire(db, b, userId) {
  if (!b.sireCattleId) return { sire: orNull(b.sire), sireCattleId: null };
  const { rows } = await db.query(
    `SELECT id, tag_number, name_breed FROM cattle
     WHERE id = $1 AND owner_id = $2 AND gender = 'male' FOR KEY SHARE`,
    [b.sireCattleId, userId]
  );
  if (!rows.length) throw httpError(400, 'Choose a bull from your herd');
  return { sire: `${rows[0].tag_number} ${rows[0].name_breed || ''}`.trim(), sireCattleId: rows[0].id };
}

const fields = (b, sire) => [
  b.breedingDate.slice(0, 10), orNull(b.method), sire.sire, sire.sireCattleId, orNull(b.technician), orNull(b.notes),
];

const one = async (db, id) => (await db.query(`${SELECT} WHERE e.id = $1`, [id])).rows[0];

// ----- /api/cattle/:cattleId/breedings --------------------------------------------------------

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
  const event = await withTransaction(async (db) => {
    const cow = await ownedCattle(db, req.params.cattleId, userId, { lock: true });
    if (!cow) throw httpError(404, 'Cattle not found');
    if (cow.gender === 'male') throw httpError(400, 'Only female animals can have breeding records');
    const sire = await resolveSire(db, req.body, userId);
    const before = await impliedExpected(db, cow.id);
    const { rows } = await db.query(
      `INSERT INTO breeding_events (cattle_id, owner_id, breeding_date, method, sire, sire_cattle_id, technician, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [cow.id, userId, ...fields(req.body, sire)]
    );
    await afterBreedingRecorded(db, cow.id, rows[0].id, before);
    return one(db, rows[0].id);
  });
  res.status(201).json(toApi(event));
});

// ----- /api/breedings -------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const { rows } = await pool.query(`${SELECT} WHERE e.owner_id = $1 ${NEWEST_FIRST}`, [req.session.userId]);
  res.json(rows.map(toApi));
});

// Cows whose current breeding (the newest one after their last calving) is more than
// CHECK_AFTER_DAYS days before `today` and has no pregnancy check dated on or after it.
// `today` is the caller's local date (YYYY-MM-DD); it defaults to the server's UTC date.
router.get(
  '/needs-check',
  query('today').optional().isISO8601(isoDate).withMessage('Invalid date'),
  validate,
  async (req, res) => {
    const today = req.query.today ? String(req.query.today).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `WITH cur AS (
         SELECT DISTINCT ON (b.cattle_id) b.id
         FROM breeding_events b JOIN cattle c ON c.id = b.cattle_id
         WHERE b.owner_id = $1 AND (c.last_calving_date IS NULL OR b.breeding_date > c.last_calving_date)
         ORDER BY b.cattle_id, b.breeding_date DESC, b.created_at DESC
       )
       SELECT x.*, $2::date - x.breeding_date AS days_since FROM (${SELECT}) x
       WHERE x.id IN (SELECT id FROM cur)
         AND x.breeding_date < $2::date - $3::int
         AND NOT EXISTS (
           SELECT 1 FROM pregnancy_checks p WHERE p.cattle_id = x.cattle_id AND p.check_date >= x.breeding_date
         )
       ORDER BY x.breeding_date, x.cattle_tag`,
      [req.session.userId, today, CHECK_AFTER_DAYS]
    );
    res.json({
      today,
      checkAfterDays: CHECK_AFTER_DAYS,
      gestationDays: GESTATION_DAYS,
      cows: rows.map((r) => ({ ...toApi(r), daysSinceBreeding: r.days_since })),
    });
  }
);

const eventId = param('id').isUUID().withMessage('Invalid breeding id');

// Finds the event's animal and locks it (same order as POST), or answers 404.
async function lockEventCow(db, id, userId) {
  const found = await db.query('SELECT cattle_id FROM breeding_events WHERE id=$1 AND owner_id=$2', [id, userId]);
  if (!found.rows.length) throw httpError(404, 'Breeding record not found');
  await ownedCattle(db, found.rows[0].cattle_id, userId, { lock: true });
  return found.rows[0].cattle_id;
}

// Replaces the event's fields. The animal it belongs to cannot change.
router.put('/:id', eventId, rules, validate, async (req, res) => {
  const userId = req.session.userId;
  const event = await withTransaction(async (db) => {
    const cowId = await lockEventCow(db, req.params.id, userId);
    const sire = await resolveSire(db, req.body, userId);
    const before = await impliedExpected(db, cowId);
    const { rows } = await db.query(
      `UPDATE breeding_events SET breeding_date=$3, method=$4, sire=$5, sire_cattle_id=$6, technician=$7, notes=$8
       WHERE id=$1 AND owner_id=$2 RETURNING id`,
      [req.params.id, userId, ...fields(req.body, sire)]
    );
    if (!rows.length) throw httpError(404, 'Breeding record not found');
    // A check now dated before its breeding would make no sense; refuse rather than unlink it.
    const early = await db.query(
      'SELECT 1 FROM pregnancy_checks WHERE breeding_id = $1 AND check_date < $2 LIMIT 1',
      [req.params.id, req.body.breedingDate.slice(0, 10)]
    );
    if (early.rows.length) throw httpError(400, 'A pregnancy check for this breeding is dated before the new breeding date');
    await followRecords(db, cowId, before);
    return one(db, rows[0].id);
  });
  res.json(toApi(event));
});

// Deletes the breeding; its pregnancy checks are kept and no longer linked to it.
router.delete('/:id', eventId, validate, async (req, res) => {
  const userId = req.session.userId;
  await withTransaction(async (db) => {
    const cowId = await lockEventCow(db, req.params.id, userId);
    const before = await impliedExpected(db, cowId);
    const { rowCount } = await db.query('DELETE FROM breeding_events WHERE id=$1 AND owner_id=$2', [req.params.id, userId]);
    if (!rowCount) throw httpError(404, 'Breeding record not found');
    await followRecords(db, cowId, before);
  });
  res.json({ ok: true });
});

module.exports = { forCattle, router };
