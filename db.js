const { Pool, types } = require('pg');

types.setTypeParser(1082, (v) => v); // keep DATE columns as 'YYYY-MM-DD' strings

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// An idle client losing its connection (e.g. PostgreSQL restarting) emits 'error' on the pool;
// without a listener that would crash the process. The pool replaces the client on the next query.
pool.on('error', (err) => console.error('PostgreSQL idle client error:', err.message));

async function initSchema() {
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
async function cleanupDemoUsers(hours = 4) {
  const result = await pool.query(
    'DELETE FROM users WHERE is_demo AND created_at < now() - make_interval(hours => $1)',
    [hours]
  );
  return result.rowCount;
}
module.exports = { pool, initSchema, cleanupDemoUsers };