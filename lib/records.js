// Shared helpers for event-record routes (calvings, and the record types that follow the same
// pattern: treatments, breedings, weights). See "Event records pattern" in
// docs/architecture-and-data.md.
const { pool } = require('../db');

// Empty form values are stored as NULL.
const orNull = (v) => (v === '' || v === undefined ? null : v);

// express-validator option: reject well-formed but impossible dates (2026-02-30),
// which PostgreSQL would refuse with a 500.
const isoDate = { strict: true };

// Tomorrow by the server's (UTC) clock as 'YYYY-MM-DD'. "Not in the future" checks compare
// against this rather than today, so a user east of UTC can still record something dated today.
const latestPastDate = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

// Runs fn(client) inside one transaction: commits when it resolves, rolls back when it throws.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// An error a route can throw inside withTransaction to roll back and answer with a status.
// The error handler in app.js turns it into `{ error: message }`.
function httpError(status, message) {
  return Object.assign(new Error(message), { httpStatus: status });
}

// The cattle row when it belongs to the user, otherwise null. Every nested route
// (/api/cattle/:cattleId/...) starts here; answer 404 'Cattle not found' on null.
// `lock: true` (inside a transaction) holds the row until commit, so two writers to the same
// animal's records cannot interleave.
async function ownedCattle(db, cattleId, userId, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM cattle WHERE id = $1 AND owner_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [cattleId, userId]
  );
  return rows[0] || null;
}

module.exports = { orNull, isoDate, latestPastDate, withTransaction, httpError, ownedCattle };
