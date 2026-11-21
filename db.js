const { Pool, types } = require('pg');

types.setTypeParser(1082, (v) => v); // keep DATE columns as 'YYYY-MM-DD' strings

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// An idle client losing its connection (e.g. PostgreSQL restarting) emits 'error' on the pool;
// without a listener that would crash the process. The pool replaces the client on the next query.
pool.on('error', (err) => console.error('PostgreSQL idle client error:', err.message));

// Each feature keeps its tables in its own function below and is listed here once.
// Every step must be safe to run on every start (IF NOT EXISTS, guarded data migrations).
async function initSchema() {
  await coreSchema();
  await calvingSchema();
  await breedingSchema();
  await initTransactionsSchema();
  await weighingSchema();
}

async function coreSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS cattle (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tag_number TEXT NOT NULL,
      name_breed TEXT,
      gender TEXT,
      birth_date DATE,
      weight NUMERIC(7,2),
      last_calving_date DATE,
      expected_calving_date DATE,
      medications TEXT,
      health_status TEXT NOT NULL DEFAULT 'healthy',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cattle_owner_tag_key
      ON cattle (owner_id, lower(tag_number));
  `);
}

// --- Calving records (feature 07) -----------------------------------------------------------
// cattle.last_calving_date is kept equal to the newest event's date (NULL when there are none);
// routes/calvings.js updates it in the same transaction as every event change.
async function calvingSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calving_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cattle_id UUID NOT NULL REFERENCES cattle(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      calving_date DATE NOT NULL,
      calf_sex TEXT CHECK (calf_sex IN ('female','male')),
      calf_tag TEXT,
      birth_weight NUMERIC(6,2),
      ease TEXT CHECK (ease IN ('unassisted','assisted','caesarean')),
      outcome TEXT CHECK (outcome IN ('alive','stillborn')),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS calving_events_cattle_idx ON calving_events (cattle_id, calving_date DESC);
    CREATE INDEX IF NOT EXISTS calving_events_owner_idx ON calving_events (owner_id, calving_date DESC);
  `);
  // One-time migration: an animal that has a last calving date but no events gets one event for
  // that date. It cannot repeat: once an animal has events the guard is false, and when its last
  // event is deleted the route clears last_calving_date too.
  await pool.query(`
    INSERT INTO calving_events (cattle_id, owner_id, calving_date, notes)
    SELECT c.id, c.owner_id, c.last_calving_date, 'Imported from the last calving date on the animal record.'
    FROM cattle c
    WHERE c.last_calving_date IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM calving_events e WHERE e.cattle_id = c.id)
  `);
}
// --- end calving records --------------------------------------------------------------------

// --- Breeding records (feature 09) ----------------------------------------------------------
// Breedings and pregnancy checks are two tables: a cow may have several checks for one breeding
// (early scan, then a confirmation), or a check with no breeding on record (a bought-in cow).
// sire_cattle_id links a bull of the same herd (checked by routes/breedings.js); deleting the bull
// keeps the breeding and its `sire` text. Deleting a breeding keeps its checks and clears the link.
// cattle.expected_calving_date and health_status are updated by the routes (see lib/breeding.js).
async function breedingSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS breeding_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cattle_id UUID NOT NULL REFERENCES cattle(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      breeding_date DATE NOT NULL,
      method TEXT CHECK (method IN ('ai','natural')),
      sire TEXT,
      sire_cattle_id UUID REFERENCES cattle(id) ON DELETE SET NULL,
      technician TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS breeding_events_cattle_idx ON breeding_events (cattle_id, breeding_date DESC);
    CREATE INDEX IF NOT EXISTS breeding_events_owner_idx ON breeding_events (owner_id, breeding_date DESC);
    CREATE INDEX IF NOT EXISTS breeding_events_sire_idx ON breeding_events (sire_cattle_id);
    CREATE TABLE IF NOT EXISTS pregnancy_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cattle_id UUID NOT NULL REFERENCES cattle(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      check_date DATE NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('pregnant','open','unsure')),
      method TEXT CHECK (method IN ('palpation','ultrasound','blood_test','other')),
      breeding_id UUID REFERENCES breeding_events(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pregnancy_checks_cattle_idx ON pregnancy_checks (cattle_id, check_date DESC);
    CREATE INDEX IF NOT EXISTS pregnancy_checks_owner_idx ON pregnancy_checks (owner_id, check_date DESC);
    CREATE INDEX IF NOT EXISTS pregnancy_checks_breeding_idx ON pregnancy_checks (breeding_id);
  `);
}
// --- end breeding records -------------------------------------------------------------------

// --- Financial records (feature 11) ---------------------------------------
// Income and expenses. `amount` is always positive; `kind` decides the sign.
// A transaction may name one of the owner's animals; deleting the animal keeps the
// transaction and clears the link. routes/transactions.js checks the animal's owner.
async function initTransactionsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
      category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 50),
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      cattle_id UUID REFERENCES cattle(id) ON DELETE SET NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS transactions_owner_date_idx ON transactions (owner_id, date);
    CREATE INDEX IF NOT EXISTS transactions_cattle_idx ON transactions (cattle_id);
  `);
}
// --- end financial records --------------------------------------------------

// --- Weight tracking (feature 10) -----------------------------------------------------------
// cattle.weight is kept equal to the newest weighing (latest date, then latest created_at; NULL
// when there are none); lib/weights.js syncWeight() runs in the same transaction as every change.
// Weights are in lbs. The API allows 0.01 to 5000; the CHECK only refuses what can never be a
// weight, so a legacy value above 5000 is carried over instead of stopping the server.
async function weighingSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weighings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cattle_id UUID NOT NULL REFERENCES cattle(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      weight NUMERIC(7,2) NOT NULL CHECK (weight > 0),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS weighings_cattle_idx ON weighings (cattle_id, date DESC);
    CREATE INDEX IF NOT EXISTS weighings_owner_idx ON weighings (owner_id, date DESC);
  `);
  // A weight of 0 (or less) was never a real weight: the API used to accept 0 by mistake. It means
  // "no weight", so it is cleared rather than imported. Repeating this changes nothing.
  await pool.query('UPDATE cattle SET weight = NULL WHERE weight <= 0');
  // One-time migration: an animal that has a weight but no weighings gets one weighing for it,
  // dated at the record's last update. It cannot repeat: once an animal has weighings the guard
  // is false, and when its last weighing is deleted syncWeight() clears the weight too.
  await pool.query(`
    INSERT INTO weighings (cattle_id, owner_id, date, weight, notes)
    SELECT c.id, c.owner_id, c.updated_at::date, c.weight, 'Imported from the weight on the animal record.'
    FROM cattle c
    WHERE c.weight IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM weighings w WHERE w.cattle_id = c.id)
  `);
}
// --- end weight tracking --------------------------------------------------------------------

async function cleanupDemoUsers(hours = 4) {
  const result = await pool.query(
    'DELETE FROM users WHERE is_demo AND created_at < now() - make_interval(hours => $1)',
    [hours]
  );
  return result.rowCount;
}
module.exports = { pool, initSchema, cleanupDemoUsers };