// Treatments: medical records (treatments, vaccinations, vet visits). Follows the calving
// template; see "Event records pattern" in docs/architecture-and-data.md.
//
//   forCattle  mounted at /api/cattle/:cattleId/treatments   GET (one animal's history), POST
//   router     mounted at /api/treatments                    GET (whole herd), GET /due,
//                                                            PUT /:id, DELETE /:id
//
// Ownership: nested routes look the animal up with owner_id = session user (ownedCattle) and
// answer 404 when it is not theirs; routes by treatment id filter on the treatment's own owner_id,
// which is always copied from the session when the treatment is created.
//
// Follow-ups: a treatment with a next due date is "open" until a later treatment of the same
// animal, type and product (product compared ignoring case and surrounding spaces) is recorded.
// GET /due lists the open ones. Recording the follow-up therefore closes the schedule without
// changing the earlier record; clearing the next due date dismisses it.
//
// Withdrawal: cattle.withdrawal_until is kept equal to the latest withdrawal date of the animal's
// treatments, in the same transaction as every insert, update and delete.
const express = require('express');
const { body, param, query } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, validate } = require('../middleware/auth');
const { orNull, isoDate, latestPastDate, withTransaction, httpError, ownedCattle } = require('../lib/records');

const forCattle = express.Router({ mergeParams: true });
const router = express.Router();
forCattle.use(requireAuth);
router.use(requireAuth);

const TYPES = ['treatment', 'vaccination', 'vet_visit', 'other'];

const toApi = (r) => ({
  id: r.id,
  cattleId: r.cattle_id,
  cattleTag: r.cattle_tag,
  cattleName: r.cattle_name ?? '',
  dateGiven: r.date_given,
  type: r.type,
  product: r.product ?? '',
  dose: r.dose ?? '',
  route: r.route ?? '',
  givenBy: r.given_by ?? '',
  nextDueDate: r.next_due_date ?? '',
  withdrawalUntil: r.withdrawal_until ?? '',
  notes: r.notes ?? '',
  createdAt: r.created_at,
});

// Treatments are always read with the animal's number and name, so lists need no second request.
const SELECT = `
  SELECT e.*, c.tag_number AS cattle_tag, c.name_breed AS cattle_name
  FROM treatments e JOIN cattle c ON c.id = e.cattle_id`;
const NEWEST_FIRST = 'ORDER BY e.date_given DESC, e.created_at DESC';

// True for a treatment that a later one of the same series (animal, type, product) replaces.
// Ties on the date are broken by creation time, then id, so exactly one per series is newest.
const SUPERSEDED = `EXISTS (
  SELECT 1 FROM treatments n
  WHERE n.cattle_id = e.cattle_id AND n.type = e.type
    AND lower(btrim(coalesce(n.product, ''))) = lower(btrim(coalesce(e.product, '')))
    AND (n.date_given, n.created_at, n.id) > (e.date_given, e.created_at, e.id))`;

const dateOf = (v) => String(v).slice(0, 10);
// Optional text, trimmed before it is stored ("   " is stored as NULL).
const text = (name, max, label) =>
  body(name).optional({ values: 'falsy' })
    .isString().withMessage(`Invalid ${label.toLowerCase()}`).bail()
    .trim().isLength({ max }).withMessage(`${label} must be at most ${max} characters`);

const rules = [
  body('dateGiven').isISO8601(isoDate).withMessage('Enter a valid treatment date').bail()
    .custom((v) => dateOf(v) <= latestPastDate()).withMessage('The treatment date cannot be in the future'),
  body('type').isIn(TYPES).withMessage('Choose a treatment type'),
  text('product', 100, 'Product'),
  text('dose', 50, 'Dose'),
  text('route', 50, 'Route'),
  text('givenBy', 100, 'Given by'),
  body('nextDueDate').optional({ values: 'falsy' }).isISO8601(isoDate).withMessage('Enter a valid next due date').bail()
    .custom((v, { req }) => dateOf(v) > dateOf(req.body.dateGiven)).withMessage('The next due date must be after the date given'),
  body('withdrawalUntil').optional({ values: 'falsy' }).isISO8601(isoDate).withMessage('Enter a valid withdrawal date').bail()
    .custom((v, { req }) => dateOf(v) >= dateOf(req.body.dateGiven)).withMessage('The withdrawal date cannot be before the date given'),
  body('notes').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }).withMessage('Notes are too long'),
];

const optionalDate = (v) => (v ? dateOf(v) : null);
const fields = (b) => [
  dateOf(b.dateGiven), b.type, orNull(b.product), orNull(b.dose), orNull(b.route), orNull(b.givenBy),
  optionalDate(b.nextDueDate), optionalDate(b.withdrawalUntil), orNull(b.notes),
];

// Keeps cattle.withdrawal_until equal to the latest withdrawal date of the animal's treatments
// (NULL when none has one). Call it in the same transaction as every insert, update or delete.
async function syncWithdrawal(db, cattleId) {
  await db.query(
    `UPDATE cattle SET withdrawal_until = w.until, updated_at = now()
     FROM (SELECT max(withdrawal_until) AS until FROM treatments WHERE cattle_id = $1) w
     WHERE id = $1 AND withdrawal_until IS DISTINCT FROM w.until`,
    [cattleId]
  );
}

const one = async (db, id) => (await db.query(`${SELECT} WHERE e.id = $1`, [id])).rows[0];

// Finds the user's treatment and locks its animal (in the same order as POST: animal first, then
// the treatment). Throws 404 when the treatment is not theirs. Returns the animal's id.
async function lockTreatment(db, id, userId) {
  const found = await db.query('SELECT cattle_id FROM treatments WHERE id=$1 AND owner_id=$2', [id, userId]);
  if (!found.rows.length) throw httpError(404, 'Treatment not found');
  await ownedCattle(db, found.rows[0].cattle_id, userId, { lock: true });
  return found.rows[0].cattle_id;
}

// ----- /api/cattle/:cattleId/treatments -------------------------------------------------------

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
    const { rows } = await db.query(
      `INSERT INTO treatments (cattle_id, owner_id, date_given, type, product, dose, route, given_by,
         next_due_date, withdrawal_until, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [cow.id, userId, ...fields(req.body)]
    );
    await syncWithdrawal(db, cow.id);
    return one(db, rows[0].id);
  });
  res.status(201).json(toApi(event));
});

// ----- /api/treatments ------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const { rows } = await pool.query(`${SELECT} WHERE e.owner_id = $1 ${NEWEST_FIRST}`, [req.session.userId]);
  res.json(rows.map(toApi));
});

// Open follow-ups (see the top of this file), soonest next due date first. Overdue ones are
// included; `until=YYYY-MM-DD` keeps only those due on or before that date. The server does not
// decide what "today" is: the browser compares the dates with the user's own calendar date.
router.get(
  '/due',
  query('until').optional().isISO8601(isoDate).withMessage('Enter a valid date'),
  validate,
  async (req, res) => {
    const params = [req.session.userId];
    let until = '';
    if (req.query.until) {
      params.push(dateOf(req.query.until));
      until = 'AND e.next_due_date <= $2';
    }
    const { rows } = await pool.query(
      `${SELECT} WHERE e.owner_id = $1 AND e.next_due_date IS NOT NULL ${until} AND NOT ${SUPERSEDED}
       ORDER BY e.next_due_date, c.tag_number, e.date_given`,
      params
    );
    res.json(rows.map(toApi));
  }
);

const treatmentId = param('id').isUUID().withMessage('Invalid treatment id');

// Replaces the treatment's fields (like PUT /api/cattle/:id). The animal cannot change.
router.put('/:id', treatmentId, rules, validate, async (req, res) => {
  const event = await withTransaction(async (db) => {
    const cowId = await lockTreatment(db, req.params.id, req.session.userId);
    const { rows } = await db.query(
      `UPDATE treatments SET date_given=$3, type=$4, product=$5, dose=$6, route=$7, given_by=$8,
         next_due_date=$9, withdrawal_until=$10, notes=$11
       WHERE id=$1 AND owner_id=$2 RETURNING id`,
      [req.params.id, req.session.userId, ...fields(req.body)]
    );
    if (!rows.length) throw httpError(404, 'Treatment not found');
    await syncWithdrawal(db, cowId);
    return one(db, rows[0].id);
  });
  res.json(toApi(event));
});

router.delete('/:id', treatmentId, validate, async (req, res) => {
  await withTransaction(async (db) => {
    const cowId = await lockTreatment(db, req.params.id, req.session.userId);
    const { rowCount } = await db.query('DELETE FROM treatments WHERE id=$1 AND owner_id=$2', [req.params.id, req.session.userId]);
    if (!rowCount) throw httpError(404, 'Treatment not found');
    await syncWithdrawal(db, cowId);
  });
  res.json({ ok: true });
});

module.exports = { forCattle, router, TYPES };
