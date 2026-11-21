// Performance and health reports (feature 12): read-only summaries of the records the other
// features keep. Mounted at /api/reports.
//
//   GET /performance?from&to&today   herd size, calvings, calving interval, daily gain, conception
//   GET /health?from&to&today        treatments by type and month, animals needing attention now
//
// `from` and `to` (YYYY-MM-DD, both optional, inclusive) select the events of the period.
// `today` is the caller's local calendar date; it defaults to the server's UTC date. It decides
// what "now" is: withdrawal periods, overdue follow-ups, and the last month of the herd-size series.
//
// Every figure is computed in SQL, and each report reads one REPEATABLE READ snapshot so its
// parts always agree. Rates and averages are JSON numbers rounded in SQL (never in the browser);
// a rate whose denominator is zero is null. The definitions are in docs/api.md ("Reports") and
// are repeated on the pages themselves.
const express = require('express');
const { query } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, validate } = require('../middleware/auth');
const { TYPES, SUPERSEDED } = require('./treatments');

const router = express.Router();
router.use(requireAuth);

// A female counts as breeding age from this many months old.
const BREEDING_AGE_MONTHS = 15;
// Open follow-ups due within this many days of today are "upcoming".
const UPCOMING_DAYS = 30;
// The herd-size series never has more than this many months (the newest are kept).
const MAX_MONTHS = 120;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A calendar date written as YYYY-MM-DD that exists (no 2026-02-30).
const dateRule = (name, message) =>
  query(name).optional({ values: 'falsy' })
    .isString().withMessage(message).bail()
    .matches(DATE_RE).withMessage(message).bail()
    .isISO8601({ strict: true }).withMessage(message);

const rules = [
  dateRule('from', 'Invalid "from" date'),
  dateRule('to', 'Invalid "to" date'),
  dateRule('today', 'Invalid "today" date'),
  query('to').custom((to, { req }) => !to || !req.query.from || req.query.from <= to)
    .withMessage('"from" must be on or before "to"'),
  validate,
];

// Queries share their first parameters: $1 owner, $2 from, $3 to, and $4 today where it is needed.
function parameters(req) {
  const today = req.query.today || new Date().toISOString().slice(0, 10);
  return { today, params: [req.session.userId, req.query.from || null, req.query.to || null, today] };
}

// "<column> is inside the period".
const inPeriod = (column) => `($2::date IS NULL OR ${column} >= $2::date) AND ($3::date IS NULL OR ${column} <= $3::date)`;
// The last day of the period that has already happened: `to`, but never later than today.
const PERIOD_END = 'LEAST(COALESCE($3::date, $4::date), $4::date)';

// Runs fn(run) in one read-only snapshot; run(sql, params) resolves to the rows.
async function snapshot(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await fn(async (sql, params) => (await client.query(sql, params)).rows);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const animal = (r) => ({ cattleId: r.cattle_id, cattleTag: r.cattle_tag, cattleName: r.cattle_name ?? '' });

// ----- Performance ------------------------------------------------------------------------------

// Per animal: the first and the last weighing inside the period (ties on the date go by creation
// time, then id), kept only when they are on different dates.
const GAIN_CTE = `
  w AS (
    SELECT w.cattle_id, w.date, w.weight,
           row_number() OVER (PARTITION BY w.cattle_id ORDER BY w.date, w.created_at, w.id) AS first_rank,
           row_number() OVER (PARTITION BY w.cattle_id ORDER BY w.date DESC, w.created_at DESC, w.id DESC) AS last_rank,
           count(*) OVER (PARTITION BY w.cattle_id) AS weighings
    FROM weighings w WHERE w.owner_id = $1 AND ${inPeriod('w.date')}
  ), g AS (
    SELECT c.id AS cattle_id, c.tag_number AS cattle_tag, c.name_breed AS cattle_name,
           CASE WHEN c.gender IN ('female', 'male') THEN c.gender ELSE 'unknown' END AS grp,
           f.date AS first_date, f.weight AS first_weight, l.date AS last_date, l.weight AS last_weight,
           f.weighings::int AS weighings, l.date - f.date AS days, l.weight - f.weight AS gain,
           (l.weight - f.weight) / (l.date - f.date) AS adg
    FROM w f
    JOIN w l ON l.cattle_id = f.cattle_id AND l.last_rank = 1
    JOIN cattle c ON c.id = f.cattle_id
    WHERE f.first_rank = 1 AND l.date > f.date
  )`;

router.get('/performance', rules, async (req, res) => {
  const { today, params } = parameters(req);
  const period = params.slice(0, 3); // for queries that do not need today

  const data = await snapshot(async (run) => {
    const [herd] = await run(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE gender = 'female')::int AS females,
              count(*) FILTER (WHERE gender = 'male')::int AS males
       FROM cattle WHERE owner_id = $1`,
      [params[0]]
    );

    // One row per calendar month from the start of the period (or the first animal, when there is
    // no `from`) to its end (never later than today). `size` is the number of animals whose record
    // was created on or before the last day counted in that month. created_at is read as a UTC date,
    // but never later than the caller's today: an animal added in the evening west of UTC is on
    // record today, not tomorrow.
    const herdByMonth = await run(
      `WITH j AS (
         SELECT LEAST((created_at AT TIME ZONE 'UTC')::date, $4::date) AS d FROM cattle WHERE owner_id = $1
       ), r AS (
         SELECT COALESCE($2::date, (SELECT min(d) FROM j)) AS s, ${PERIOD_END} AS e
       ), m AS (
         SELECT gs::date AS month_start, r.e
         FROM r, generate_series(
           GREATEST(date_trunc('month', r.s::timestamp), date_trunc('month', r.e::timestamp) - make_interval(months => $5::int - 1)),
           date_trunc('month', r.e::timestamp), interval '1 month') gs
         WHERE r.s IS NOT NULL AND r.s <= r.e
       ), a AS (
         SELECT month_start, LEAST((month_start + interval '1 month - 1 day')::date, e) AS as_of FROM m
       )
       SELECT to_char(a.month_start, 'YYYY-MM') AS month, a.as_of AS "asOf",
              (SELECT count(*) FROM j WHERE j.d BETWEEN a.month_start AND a.as_of)::int AS added,
              (SELECT count(*) FROM j WHERE j.d <= a.as_of)::int AS size
       FROM a ORDER BY a.month_start`,
      [...params, MAX_MONTHS]
    );

    const [calvings] = await run(
      `SELECT count(*)::int AS count, count(DISTINCT e.cattle_id)::int AS cows,
              count(*) FILTER (WHERE e.outcome = 'alive')::int AS alive,
              count(*) FILTER (WHERE e.outcome = 'stillborn')::int AS stillborn,
              count(*) FILTER (WHERE e.outcome IS NULL)::int AS outcome_unknown,
              count(*) FILTER (WHERE e.ease = 'unassisted')::int AS unassisted,
              count(*) FILTER (WHERE e.ease = 'assisted')::int AS assisted,
              count(*) FILTER (WHERE e.ease = 'caesarean')::int AS caesarean,
              count(*) FILTER (WHERE e.ease IS NULL)::int AS ease_unknown,
              count(e.birth_weight)::int AS birth_weights,
              round(avg(e.birth_weight), 1)::float8 AS avg_birth_weight
       FROM calving_events e WHERE e.owner_id = $1 AND ${inPeriod('e.calving_date')}`,
      period
    );

    // Breeding-age females: animals on record now that are not male and either have calved on or
    // before the end of the period, or are female and were at least BREEDING_AGE_MONTHS old then
    // (a female with no birth date counts). The rate is the share of them that calved in the period.
    const [rate] = await run(
      `WITH bf AS (
         SELECT c.id FROM cattle c
         WHERE c.owner_id = $1 AND c.gender IS DISTINCT FROM 'male' AND (
           EXISTS (SELECT 1 FROM calving_events e WHERE e.cattle_id = c.id AND e.calving_date <= ${PERIOD_END})
           OR (c.gender = 'female' AND (c.birth_date IS NULL
               OR c.birth_date <= (${PERIOD_END} - make_interval(months => $5::int))::date)))
       ), n AS (
         SELECT count(*)::int AS females,
                count(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM calving_events e WHERE e.cattle_id = bf.id AND ${inPeriod('e.calving_date')}))::int AS calved
         FROM bf
       )
       SELECT females, calved,
              CASE WHEN females > 0 THEN round(100.0 * calved / females, 1)::float8 END AS rate
       FROM n`,
      [...params, BREEDING_AGE_MONTHS]
    );

    // Days from each calving to the same cow's previous one (two calves born on one day are one
    // calving). An interval belongs to the period when the later calving is inside it.
    const [interval] = await run(
      `WITH d AS (
         SELECT DISTINCT cattle_id, calving_date FROM calving_events WHERE owner_id = $1
       ), i AS (
         SELECT cattle_id, calving_date,
                calving_date - lag(calving_date) OVER (PARTITION BY cattle_id ORDER BY calving_date) AS days
         FROM d
       )
       SELECT count(*)::int AS intervals, count(DISTINCT cattle_id)::int AS cows,
              round(avg(days), 1)::float8 AS avg_days, min(days)::int AS min_days, max(days)::int AS max_days
       FROM i WHERE days IS NOT NULL AND ${inPeriod('calving_date')}`,
      period
    );

    const gainByAnimal = await run(
      `WITH ${GAIN_CTE}
       SELECT cattle_id, cattle_tag, cattle_name, grp, first_date, first_weight::float8, last_date,
              last_weight::float8, weighings, days, round(gain, 2)::float8 AS gain, round(adg, 2)::float8 AS adg
       FROM g ORDER BY g.adg DESC, cattle_tag`,
      period
    );
    // grp is NULL on the grand-total row. The averages are of the animals' unrounded figures.
    const gainGroups = await run(
      `WITH ${GAIN_CTE}
       SELECT grp, count(*)::int AS animals, round(avg(adg), 2)::float8 AS adg
       FROM g GROUP BY GROUPING SETS ((), (grp)) ORDER BY grp NULLS FIRST`,
      period
    );

    // A breeding's result is the cow's newest decisive check (pregnant or open) dated on or after
    // the breeding and before her next breeding. "Unsure" checks decide nothing.
    const [breeding] = await run(
      `WITH b AS (
         SELECT b.cattle_id, b.breeding_date,
                lead(b.breeding_date) OVER (PARTITION BY b.cattle_id ORDER BY b.breeding_date, b.created_at, b.id) AS next_date
         FROM breeding_events b WHERE b.owner_id = $1
       ), n AS (
         SELECT count(*)::int AS breedings,
                count(r.result)::int AS checked,
                count(*) FILTER (WHERE r.result = 'pregnant')::int AS pregnant,
                count(*) FILTER (WHERE r.result = 'open')::int AS open
         FROM b LEFT JOIN LATERAL (
           SELECT p.result FROM pregnancy_checks p
           WHERE p.cattle_id = b.cattle_id AND p.result IN ('pregnant', 'open')
             AND p.check_date >= b.breeding_date AND (b.next_date IS NULL OR p.check_date < b.next_date)
           ORDER BY p.check_date DESC, p.created_at DESC, p.id DESC LIMIT 1
         ) r ON true
         WHERE ${inPeriod('b.breeding_date')}
       )
       SELECT *, CASE WHEN checked > 0 THEN round(100.0 * pregnant / checked, 1)::float8 END AS rate FROM n`,
      period
    );

    return { herd, herdByMonth, calvings, rate, interval, gainByAnimal, gainGroups, breeding };
  });

  const herdGain = data.gainGroups.find((g) => g.grp === null);
  res.json({
    from: req.query.from || null,
    to: req.query.to || null,
    today,
    herd: {
      size: data.herd.total,
      females: data.herd.females,
      males: data.herd.males,
      byMonth: data.herdByMonth,
    },
    calvings: {
      count: data.calvings.count,
      cows: data.calvings.cows,
      byOutcome: { alive: data.calvings.alive, stillborn: data.calvings.stillborn, unknown: data.calvings.outcome_unknown },
      byEase: {
        unassisted: data.calvings.unassisted,
        assisted: data.calvings.assisted,
        caesarean: data.calvings.caesarean,
        unknown: data.calvings.ease_unknown,
      },
      birthWeights: data.calvings.birth_weights,
      averageBirthWeight: data.calvings.avg_birth_weight,
      breedingAgeMonths: BREEDING_AGE_MONTHS,
      breedingFemales: data.rate.females,
      cowsCalved: data.rate.calved,
      calvingRate: data.rate.rate,
    },
    calvingInterval: {
      intervals: data.interval.intervals,
      cows: data.interval.cows,
      averageDays: data.interval.avg_days,
      minDays: data.interval.min_days,
      maxDays: data.interval.max_days,
    },
    dailyGain: {
      animals: herdGain ? herdGain.animals : 0,
      herdAverage: herdGain ? herdGain.adg : null,
      byGroup: data.gainGroups.filter((g) => g.grp !== null).map((g) => ({ group: g.grp, animals: g.animals, average: g.adg })),
      byAnimal: data.gainByAnimal.map((r) => ({
        ...animal(r),
        group: r.grp,
        firstDate: r.first_date,
        firstWeight: r.first_weight,
        lastDate: r.last_date,
        lastWeight: r.last_weight,
        weighings: r.weighings,
        days: r.days,
        gain: r.gain,
        dailyGain: r.adg,
      })),
    },
    breeding: {
      breedings: data.breeding.breedings,
      checked: data.breeding.checked,
      pregnant: data.breeding.pregnant,
      open: data.breeding.open,
      conceptionRate: data.breeding.rate,
    },
  });
});

// ----- Health -----------------------------------------------------------------------------------

const typeCounts = TYPES.map((t) => `count(*) FILTER (WHERE e.type = '${t}')::int AS "${t}"`).join(', ');

router.get('/health', rules, async (req, res) => {
  const { today, params } = parameters(req);
  const period = params.slice(0, 3); // for queries that do not need today
  const owner = [params[0]];
  const ownerToday = [params[0], today];

  const data = await snapshot(async (run) => {
    const [totals] = await run(
      `SELECT count(*)::int AS count, count(DISTINCT e.cattle_id)::int AS animals
       FROM treatments e WHERE e.owner_id = $1 AND ${inPeriod('e.date_given')}`,
      period
    );
    // Every type is listed, with 0 when it has none.
    const byType = await run(
      `SELECT t.type, count(e.id)::int AS count, count(DISTINCT e.cattle_id)::int AS animals
       FROM unnest($4::text[]) WITH ORDINALITY AS t(type, ord)
       LEFT JOIN treatments e ON e.type = t.type AND e.owner_id = $1 AND ${inPeriod('e.date_given')}
       GROUP BY t.type, t.ord ORDER BY t.ord`,
      [...period, TYPES]
    );
    // Only months that have treatments, oldest first.
    const byMonth = await run(
      `SELECT to_char(e.date_given, 'YYYY-MM') AS month, ${typeCounts}, count(*)::int AS total
       FROM treatments e WHERE e.owner_id = $1 AND ${inPeriod('e.date_given')}
       GROUP BY 1 ORDER BY 1`,
      period
    );

    const [herd] = await run(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE health_status = 'healthy')::int AS healthy,
              count(*) FILTER (WHERE health_status = 'pregnant')::int AS pregnant,
              count(*) FILTER (WHERE health_status = 'under_treatment')::int AS under_treatment,
              count(*) FILTER (WHERE health_status = 'quarantine')::int AS quarantine
       FROM cattle WHERE owner_id = $1`,
      owner
    );
    // Animals whose status is Under Treatment or In Quarantine now, with their newest treatment.
    const attention = await run(
      `SELECT c.id AS cattle_id, c.tag_number AS cattle_tag, c.name_breed AS cattle_name, c.health_status,
              c.medications, l.date_given, l.type, l.product
       FROM cattle c LEFT JOIN LATERAL (
         SELECT e.date_given, e.type, e.product FROM treatments e WHERE e.cattle_id = c.id
         ORDER BY e.date_given DESC, e.created_at DESC, e.id DESC LIMIT 1
       ) l ON true
       WHERE c.owner_id = $1 AND c.health_status IN ('under_treatment', 'quarantine')
       ORDER BY c.health_status DESC, c.tag_number`,
      owner
    );
    // cattle.withdrawal_until is the latest withdrawal date of the animal's treatments; the period
    // includes that day. The product is that of the newest treatment that set the date.
    const withdrawal = await run(
      `SELECT c.id AS cattle_id, c.tag_number AS cattle_tag, c.name_breed AS cattle_name,
              c.withdrawal_until, c.withdrawal_until - $2::date AS days_left, l.product, l.date_given
       FROM cattle c LEFT JOIN LATERAL (
         SELECT e.product, e.date_given FROM treatments e
         WHERE e.cattle_id = c.id AND e.withdrawal_until = c.withdrawal_until
         ORDER BY e.date_given DESC, e.created_at DESC, e.id DESC LIMIT 1
       ) l ON true
       WHERE c.owner_id = $1 AND c.withdrawal_until >= $2::date
       ORDER BY c.withdrawal_until, c.tag_number`,
      ownerToday
    );
    // Open follow-ups, as GET /api/treatments/due defines them (routes/treatments.js): every
    // overdue one, and those due from today to UPCOMING_DAYS days ahead.
    const followUps = await run(
      `SELECT e.id, e.cattle_id, c.tag_number AS cattle_tag, c.name_breed AS cattle_name, e.type, e.product,
              e.date_given, e.next_due_date, e.next_due_date - $2::date AS days_until
       FROM treatments e JOIN cattle c ON c.id = e.cattle_id
       WHERE e.owner_id = $1 AND e.next_due_date IS NOT NULL AND e.next_due_date <= $2::date + $3::int
         AND NOT ${SUPERSEDED}
       ORDER BY e.next_due_date, c.tag_number, e.date_given`,
      [...ownerToday, UPCOMING_DAYS]
    );
    return { totals, byType, byMonth, herd, attention, withdrawal, followUps };
  });

  const status = (name) =>
    data.attention.filter((r) => r.health_status === name).map((r) => ({
      ...animal(r),
      medications: r.medications ?? '',
      lastTreatmentDate: r.date_given ?? null,
      lastTreatmentType: r.type ?? null,
      lastTreatmentProduct: r.product ?? '',
    }));
  const followUp = (r) => ({
    id: r.id,
    ...animal(r),
    type: r.type,
    product: r.product ?? '',
    dateGiven: r.date_given,
    nextDueDate: r.next_due_date,
    daysUntil: r.days_until,
  });

  res.json({
    from: req.query.from || null,
    to: req.query.to || null,
    today,
    treatments: { count: data.totals.count, animals: data.totals.animals, byType: data.byType, byMonth: data.byMonth },
    herd: {
      size: data.herd.total,
      healthy: data.herd.healthy,
      pregnant: data.herd.pregnant,
      underTreatment: data.herd.under_treatment,
      quarantine: data.herd.quarantine,
    },
    underTreatment: status('under_treatment'),
    quarantine: status('quarantine'),
    withdrawal: data.withdrawal.map((r) => ({
      ...animal(r),
      withdrawalUntil: r.withdrawal_until,
      daysLeft: r.days_left,
      product: r.product ?? '',
      dateGiven: r.date_given ?? null,
    })),
    followUps: {
      upcomingDays: UPCOMING_DAYS,
      overdue: data.followUps.filter((r) => r.days_until < 0).map(followUp),
      upcoming: data.followUps.filter((r) => r.days_until >= 0).map(followUp),
    },
  });
});

module.exports = router;
