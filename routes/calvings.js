// Calving events. This file is the template for the other event records (treatments, breedings,
// weights): see "Event records pattern" in docs/architecture-and-data.md.
//
//   forCattle  mounted at /api/cattle/:cattleId/calvings   GET (one animal's history), POST
//   router     mounted at /api/calvings                    GET (whole herd), PUT /:id, DELETE /:id
//
// Ownership: nested routes look the animal up with owner_id = session user (ownedCattle) and
// answer 404 when it is not theirs; routes by event id filter on the event's own owner_id, which
// is always copied from the session when the event is created.
const express = require('express');
const { body, param } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, validate } = require('../middleware/auth');
const { orNull, isoDate, latestPastDate, withTransaction, httpError, ownedCattle } = require('../lib/records');
const { toApi: cattleToApi, createCattle } = require('./cattle');

const forCattle = express.Router({ mergeParams: true });
const router = express.Router();
forCattle.use(requireAuth);
router.use(requireAuth);

const toApi = (r) => ({
  id: r.id,
  cattleId: r.cattle_id,
  cattleTag: r.cattle_tag,
  cattleName: r.cattle_name ?? '',
  calvingDate: r.calving_date,
  calfSex: r.calf_sex ?? '',
  calfTag: r.calf_tag ?? '',
  birthWeight: r.birth_weight == null ? null : Number(r.birth_weight),
  ease: r.ease ?? '',
  outcome: r.outcome ?? '',
  notes: r.notes ?? '',
  createdAt: r.created_at,
});

// Events are always read with the animal's number and name, so lists need no second request.
const SELECT = `
  SELECT e.*, c.tag_number AS cattle_tag, c.name_breed AS cattle_name
  FROM calving_events e JOIN cattle c ON c.id = e.cattle_id`;
const NEWEST_FIRST = 'ORDER BY e.calving_date DESC, e.created_at DESC';

const rules = [
  body('calvingDate').isISO8601(isoDate).withMessage('Enter a valid calving date').bail()
    .custom((v) => String(v).slice(0, 10) <= latestPastDate()).withMessage('The calving date cannot be in the future'),
  body('calfSex').optional({ values: 'falsy' }).isIn(['female', 'male']).withMessage('Invalid calf sex'),
  body('calfTag').optional({ values: 'falsy' }).isString().trim().isLength({ max: 25 }).withMessage('Invalid calf number'),
  body('birthWeight').optional({ values: 'falsy' }).isFloat({ gt: 0, max: 500 }).withMessage('Invalid birth weight'),
  body('ease').optional({ values: 'falsy' }).isIn(['unassisted', 'assisted', 'caesarean']).withMessage('Invalid calving ease'),
  body('outcome').optional({ values: 'falsy' }).isIn(['alive', 'stillborn']).withMessage('Invalid outcome'),
  body('notes').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }).withMessage('Notes are too long'),
];

const createRules = [
  body('addCalf').optional().isBoolean({ strict: true }).withMessage('addCalf must be true or false'),
  body('clearExpected').optional().isBoolean({ strict: true }).withMessage('clearExpected must be true or false'),
];

const fields = (b) => [
  b.calvingDate.slice(0, 10), orNull(b.calfSex), orNull(b.calfTag), orNull(b.birthWeight),
  orNull(b.ease), orNull(b.outcome), orNull(b.notes),
];

// Keeps cattle.last_calving_date equal to the animal's newest event (NULL when none are left).
// Call it in the same transaction as every insert, update or delete of an event.
async function syncLastCalving(db, cattleId) {
  await db.query(
    `UPDATE cattle SET updated_at = now(),
       last_calving_date = (SELECT max(calving_date) FROM calving_events WHERE cattle_id = $1)
     WHERE id = $1`,
    [cattleId]
  );
}

const one = async (db, id) => (await db.query(`${SELECT} WHERE e.id = $1`, [id])).rows[0];

// ----- /api/cattle/:cattleId/calvings ---------------------------------------------------------

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

// Records a calving. With `addCalf: true` the calf also becomes an animal of its own (calfTag is
// its cow number); with `clearExpected: true` the mother's expected calving date is cleared and a
// 'pregnant' status goes back to 'healthy'. Everything happens in one transaction, so a refused
// calf (duplicate number, demo limit) leaves no calving behind.
forCattle.post('/', cattleId, rules, createRules, validate, async (req, res) => {
  const b = req.body;
  const userId = req.session.userId;
  if (b.addCalf) {
    if (!b.calfTag) return res.status(400).json({ error: 'Enter a calf number to add the calf as a new animal' });
    if (b.outcome === 'stillborn') return res.status(400).json({ error: 'A stillborn calf cannot be added as a new animal' });
  }

  const result = await withTransaction(async (db) => {
    const cow = await ownedCattle(db, req.params.cattleId, userId, { lock: true });
    if (!cow) throw httpError(404, 'Cattle not found');
    if (cow.gender === 'male') throw httpError(400, 'Only female animals can have calving records');

    const { rows } = await db.query(
      `INSERT INTO calving_events (cattle_id, owner_id, calving_date, calf_sex, calf_tag,
         birth_weight, ease, outcome, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [cow.id, userId, ...fields(b)]
    );
    await syncLastCalving(db, cow.id);
    if (b.clearExpected) {
      await db.query(
        `UPDATE cattle SET expected_calving_date = NULL,
           health_status = CASE WHEN health_status = 'pregnant' THEN 'healthy' ELSE health_status END
         WHERE id = $1`,
        [cow.id]
      );
    }

    let calf = null;
    if (b.addCalf) {
      calf = await createCattle(db, req.session, {
        tagNumber: b.calfTag,
        gender: b.calfSex,
        birthDate: b.calvingDate.slice(0, 10),
        weight: b.birthWeight,
        notes: `Calf of ${cow.tag_number}.`,
      });
    }
    return { event: await one(db, rows[0].id), calf };
  });

  res.status(201).json({ ...toApi(result.event), calf: result.calf && cattleToApi(result.calf) });
});

// ----- /api/calvings --------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const { rows } = await pool.query(`${SELECT} WHERE e.owner_id = $1 ${NEWEST_FIRST}`, [req.session.userId]);
  res.json(rows.map(toApi));
});

const eventId = param('id').isUUID().withMessage('Invalid calving id');

// Replaces the event's fields (like PUT /api/cattle/:id). The animal it belongs to cannot change.
router.put('/:id', eventId, rules, validate, async (req, res) => {
  const event = await withTransaction(async (db) => {
    // Find the animal first and lock it, in the same order as POST, then change the event.
    const found = await db.query(
      'SELECT cattle_id FROM calving_events WHERE id=$1 AND owner_id=$2',
      [req.params.id, req.session.userId]
    );
    if (!found.rows.length) throw httpError(404, 'Calving record not found');
    await ownedCattle(db, found.rows[0].cattle_id, req.session.userId, { lock: true });
    const { rows } = await db.query(
      `UPDATE calving_events SET calving_date=$3, calf_sex=$4, calf_tag=$5, birth_weight=$6,
         ease=$7, outcome=$8, notes=$9
       WHERE id=$1 AND owner_id=$2 RETURNING id, cattle_id`,
      [req.params.id, req.session.userId, ...fields(req.body)]
    );
    if (!rows.length) throw httpError(404, 'Calving record not found');
    await syncLastCalving(db, rows[0].cattle_id);
    return one(db, rows[0].id);
  });
  res.json(toApi(event));
});

// Deletes the event only; a calf that was added as an animal stays in the herd.
router.delete('/:id', eventId, validate, async (req, res) => {
  await withTransaction(async (db) => {
    const found = await db.query(
      'SELECT cattle_id FROM calving_events WHERE id=$1 AND owner_id=$2',
      [req.params.id, req.session.userId]
    );
    if (!found.rows.length) throw httpError(404, 'Calving record not found');
    await ownedCattle(db, found.rows[0].cattle_id, req.session.userId, { lock: true });
    const { rowCount } = await db.query(
      'DELETE FROM calving_events WHERE id=$1 AND owner_id=$2',
      [req.params.id, req.session.userId]
    );
    if (!rowCount) throw httpError(404, 'Calving record not found');
    await syncLastCalving(db, found.rows[0].cattle_id);
  });
  res.json({ ok: true });
});

module.exports = { forCattle, router };
