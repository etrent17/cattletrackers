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
  await treatmentSchema();
  await require('./lib/treatment-details').initTreatmentDetails(pool);
  await breedingSchema();
  await initTransactionsSchema();
  await weighingSchema();
  await farmSchema();
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

// --- Farms (multi-tenant) -------------------------------------------------------------------
// A user is an account. A farm is the tenant. Membership is separate, so signup does not create
// a farm. cattle.farm_id is the herd boundary; owner_id is who recorded the row. Deleting a user
// must not delete the herd. Deleting a farm does.
// The per-owner tag index stays until inserts set farm_id. Dropping it now would let the current
// API save two animals with the same tag.
const OWNER_TABLES = [
  'cattle',
  'calving_events',
  'breeding_events',
  'pregnancy_checks',
  'treatments',
  'transactions',
  'weighings',
];

async function farmSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS farms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS farm_members (
      farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('admin','user')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (farm_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS farm_members_user_idx ON farm_members (user_id);
    CREATE TABLE IF NOT EXISTS farm_invites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      used_at TIMESTAMPTZ
    );
    ALTER TABLE cattle ADD COLUMN IF NOT EXISTS farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS cattle_farm_idx ON cattle (farm_id);
    CREATE UNIQUE INDEX IF NOT EXISTS cattle_farm_tag_key
      ON cattle (farm_id, lower(tag_number));
  `);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727003)');
    const { rows } = await client.query(`
      SELECT id, email, role FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM farm_members m WHERE m.user_id = u.id)
    `);
    for (const user of rows) {
      const name = user.email.split('@')[0].trim().slice(0, 80) || 'Farm';
      const farm = await client.query('INSERT INTO farms (name) VALUES ($1) RETURNING id', [name]);
      await client.query(
        'INSERT INTO farm_members (farm_id, user_id, role) VALUES ($1, $2, $3)',
        [farm.rows[0].id, user.id, user.role === 'admin' ? 'admin' : 'user']
      );
      await client.query(
        'UPDATE cattle SET farm_id = $1 WHERE owner_id = $2 AND farm_id IS NULL',
        [farm.rows[0].id, user.id]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // owner_id used to cascade, which deleted the herd with the user. Set null instead.
  // Guarded by confdeltype = 'c' (ON DELETE CASCADE), so a second start changes nothing.
  await pool.query(
    `
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT c.conname, c.conrelid::regclass AS tbl
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f'
          AND c.confrelid = 'users'::regclass
          AND a.attname = 'owner_id'
          AND c.confdeltype = 'c'
          AND c.conrelid::regclass::text = ANY ($1)
      LOOP
        EXECUTE format('ALTER TABLE %s ALTER COLUMN owner_id DROP NOT NULL', r.tbl);
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
        EXECUTE format(
          'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL',
          r.tbl, r.conname
        );
      END LOOP;
    END $$;
    `,
    [OWNER_TABLES]
  );
}
// --- end farms ------------------------------------------------------------------------------

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

// --- Medical records (feature 08) -----------------------------------------------------------
// Treatments, vaccinations and vet visits. cattle.withdrawal_until is kept equal to the latest
// withdrawal_until of the animal's treatments (NULL when none has one); routes/treatments.js
// updates it in the same transaction as every treatment change.
async function treatmentSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS treatments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cattle_id UUID NOT NULL REFERENCES cattle(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date_given DATE NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('treatment','vaccination','vet_visit','other')),
      product TEXT,
      dose TEXT,
      route TEXT,
      given_by TEXT,
      next_due_date DATE CHECK (next_due_date > date_given),
      withdrawal_until DATE CHECK (withdrawal_until >= date_given),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS treatments_cattle_idx ON treatments (cattle_id, date_given DESC);
    CREATE INDEX IF NOT EXISTS treatments_owner_idx ON treatments (owner_id, date_given DESC);
    ALTER TABLE cattle ADD COLUMN IF NOT EXISTS withdrawal_until DATE;
  `);
}
// --- end medical records --------------------------------------------------------------------

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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expired = await client.query(
      'SELECT id FROM users WHERE is_demo AND created_at < now() - make_interval(hours => $1)',
      [hours]
    );
    const ids = expired.rows.map((row) => row.id);
    if (!ids.length) {
      await client.query('COMMIT');
      return 0;
    }
    // The farm cascade removes the herd. owner_id no longer does.
    await client.query(
      `DELETE FROM farms f
       WHERE f.id IN (SELECT farm_id FROM farm_members WHERE user_id = ANY($1::int[]))
         AND NOT EXISTS (
           SELECT 1 FROM farm_members m
           JOIN users u ON u.id = m.user_id
           WHERE m.farm_id = f.id AND NOT u.is_demo
         )`,
      [ids]
    );
    await client.query('DELETE FROM cattle WHERE owner_id = ANY($1::int[])', [ids]);
    await client.query('DELETE FROM transactions WHERE owner_id = ANY($1::int[])', [ids]);
    const result = await client.query('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
    await client.query('COMMIT');
    return result.rowCount;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
module.exports = { pool, initSchema, cleanupDemoUsers };
