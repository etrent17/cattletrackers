// Shared setup for API tests. Require this before anything else in a test file:
// it points the app at the test database and builds the Express app without listening.
//
// Tests empty the users, cattle and session tables, so the database must be named
// explicitly with TEST_DATABASE_URL; DATABASE_URL and .env are deliberately ignored.
const { before, beforeEach, after } = require('node:test');

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Point it at a disposable PostgreSQL database, e.g.\n' +
    '  TEST_DATABASE_URL=postgres://postgres@localhost:5432/cattle_test npm test\n' +
    'The tests delete every row in it.'
  );
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.SESSION_SECRET ??= 'test-session-secret';
process.env.RATE_LIMIT_DISABLED ??= 'true'; // test/api/rate-limit.test.js sets it to 'false' first
process.env.COOKIE_SECURE = 'false';
delete process.env.DEMO_MODE;

const request = require('supertest');
const { pool, initSchema } = require('../../db');
const { hashPassword } = require('../../lib/password');
const app = require('../../app');

const PASSWORD = 'correct-horse-battery';

async function prepareDatabase() {
  await initSchema();
  // connect-pg-simple creates this table on first use; create it up front so resets can clear it.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session (expire);
  `);
}

async function resetDatabase() {
  await pool.query('TRUNCATE session, cattle, users RESTART IDENTITY CASCADE');
}

// Inserts a user directly (the API only lets an admin do that) and returns the row.
async function createUser(email, { role = 'user', password = PASSWORD } = {}) {
  const { rows } = await pool.query(
    'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
    [email, await hashPassword(password), role]
  );
  return rows[0];
}

// A supertest agent keeps cookies, so it behaves like one browser session.
const agent = () => request.agent(app);

// Creates a user and returns an agent that is signed in as them (the row is on `agent.user`).
async function signedIn(email, options = {}) {
  const user = await createUser(email, options);
  const client = agent();
  await client.post('/api/auth/login').send({ email, password: options.password || PASSWORD }).expect(200);
  client.user = user;
  return client;
}

// Call once at the top of a test file: schema ready, tables emptied before each test, pool closed at the end.
function useDatabase() {
  before(prepareDatabase);
  beforeEach(resetDatabase);
  after(() => pool.end());
}

module.exports = { app, pool, request, agent, createUser, signedIn, useDatabase, prepareDatabase, resetDatabase, PASSWORD };
