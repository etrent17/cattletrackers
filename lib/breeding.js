// Breeding rules shared by routes/breedings.js and routes/pregnancy-checks.js: how breedings and
// pregnancy checks move a cow's expected calving date and health status. Every function takes the
// transaction's client as `db`, after the cow's row has been locked (ownedCattle(..., { lock })).
//
// Rules (also in docs/api.md, "Breedings"):
//
//  - The *current breeding* is the cow's newest breeding dated after her last calving. A breeding
//    before her last calving has already ended in that calving.
//  - The *implied* expected calving date is the current breeding's date + GESTATION_DAYS, or none
//    when there is no current breeding or the newest check since it found her open.
//  - Recording a breeding that becomes the current one sets her expected date to the implied date,
//    replacing whatever was there: a new breeding is newer information.
//  - Editing or deleting a breeding, deleting a check, or recording an "unsure" check moves her
//    expected date from the old implied date to the new one, but only while it still equals the
//    old implied date (or both are empty). A date typed by hand on the cattle form is kept.
//  - Recording or editing her newest check (dated on or after the current breeding, after her
//    last calving) applies its result: "pregnant" makes a Healthy cow Pregnant and fills an empty
//    expected date; "open" clears the expected date and turns Pregnant back to Healthy. Other
//    statuses (Under Treatment, In Quarantine) are left alone: they need attention first and are
//    changed by hand.
//  - A calving recorded with clearExpected (routes/calvings.js) clears the date and Pregnant; the
//    breeding before it is then no longer current, so these rules never bring the date back.

// Days from breeding to the expected calving. The average for cattle; one constant here rather
// than a user setting. The API sends it to the app with the needs-check list.
const GESTATION_DAYS = 283;
// A cow bred more than this many days ago with no check since appears in the needs-check list.
const CHECK_AFTER_DAYS = 35;

// The current breeding as { id, breeding_date, expected }, or null.
async function currentBreeding(db, cattleId) {
  const { rows } = await db.query(
    `SELECT b.id, b.breeding_date, b.breeding_date + $2::int AS expected
     FROM breeding_events b JOIN cattle c ON c.id = b.cattle_id
     WHERE b.cattle_id = $1 AND (c.last_calving_date IS NULL OR b.breeding_date > c.last_calving_date)
     ORDER BY b.breeding_date DESC, b.created_at DESC LIMIT 1`,
    [cattleId, GESTATION_DAYS]
  );
  return rows[0] || null;
}

// The cow's newest check as { id, check_date, result }, or null.
async function newestCheck(db, cattleId) {
  const { rows } = await db.query(
    `SELECT id, check_date, result FROM pregnancy_checks WHERE cattle_id = $1
     ORDER BY check_date DESC, created_at DESC LIMIT 1`,
    [cattleId]
  );
  return rows[0] || null;
}

// The expected calving date the records imply ('YYYY-MM-DD'), or null.
async function impliedExpected(db, cattleId) {
  const current = await currentBreeding(db, cattleId);
  if (!current) return null;
  const check = await newestCheck(db, cattleId);
  if (check && check.check_date >= current.breeding_date && check.result === 'open') return null;
  return current.expected;
}

// Moves the expected date from `before` (the implied date before the change) to the implied date
// now, unless it was changed by hand in between.
async function followRecords(db, cattleId, before) {
  const after = await impliedExpected(db, cattleId);
  if (after === before) return;
  await db.query(
    `UPDATE cattle SET expected_calving_date = $2, updated_at = now()
     WHERE id = $1 AND expected_calving_date IS NOT DISTINCT FROM $3`,
    [cattleId, after, before]
  );
}

// After a breeding was inserted: sets the expected date when it is the current breeding.
async function afterBreedingRecorded(db, cattleId, breedingId, before) {
  const current = await currentBreeding(db, cattleId);
  const implied = await impliedExpected(db, cattleId);
  if (current && current.id === breedingId && implied) {
    await db.query(
      'UPDATE cattle SET expected_calving_date = $2, updated_at = now() WHERE id = $1',
      [cattleId, implied]
    );
  } else {
    await followRecords(db, cattleId, before);
  }
}

// After a check was inserted or updated: applies its result when it is the cow's current check,
// otherwise only lets the expected date follow the records.
async function afterCheckSaved(db, cattleId, checkId, before) {
  const check = await newestCheck(db, cattleId);
  const current = await currentBreeding(db, cattleId);
  const { rows } = await db.query('SELECT last_calving_date FROM cattle WHERE id = $1', [cattleId]);
  const lastCalving = rows[0].last_calving_date;
  const isCurrent =
    check && check.id === checkId &&
    (!current || check.check_date >= current.breeding_date) &&
    (!lastCalving || check.check_date > lastCalving);

  if (isCurrent && check.result === 'pregnant') {
    await db.query(
      `UPDATE cattle SET updated_at = now(),
         health_status = CASE WHEN health_status = 'healthy' THEN 'pregnant' ELSE health_status END,
         expected_calving_date = COALESCE(expected_calving_date, $2)
       WHERE id = $1`,
      [cattleId, await impliedExpected(db, cattleId)]
    );
  } else if (isCurrent && check.result === 'open') {
    await db.query(
      `UPDATE cattle SET updated_at = now(), expected_calving_date = NULL,
         health_status = CASE WHEN health_status = 'pregnant' THEN 'healthy' ELSE health_status END
       WHERE id = $1`,
      [cattleId]
    );
  } else {
    await followRecords(db, cattleId, before);
  }
}

module.exports = {
  GESTATION_DAYS,
  CHECK_AFTER_DAYS,
  currentBreeding,
  impliedExpected,
  followRecords,
  afterBreedingRecorded,
  afterCheckSaved,
};
