const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { agent, request, app, pool, signedIn, useDatabase, PASSWORD } = require('../helpers/api');

useDatabase();

const NEW_PASSWORD = 'a-brand-new-password';
const EMAIL = 'farmer@example.com';

const login = (password) => request(app).post('/api/auth/login').send({ email: EMAIL, password });
const sessionCount = async (userId) => {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM session WHERE sess->>'userId' = $1", [String(userId)]);
  return rows[0].n;
};
const sessionCookie = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('connect.sid='));

describe('POST /api/auth/password', () => {
  test('requires sign-in', async () => {
    const res = await request(app)
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);
    assert.equal(res.body.error, 'Authentication required');
  });

  test('changes the password: the old one stops working and the new one works', async () => {
    const client = await signedIn(EMAIL);
    const res = await client
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
    assert.deepEqual(res.body, { ok: true });

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [client.user.id]);
    assert.match(rows[0].password_hash, /^\$argon2id\$/);

    const old = await login(PASSWORD).expect(401);
    assert.equal(old.body.error, 'Invalid email or password');
    await login(NEW_PASSWORD).expect(200);
  });

  test('refuses a wrong current password and leaves the password unchanged', async () => {
    const client = await signedIn(EMAIL);
    const res = await client
      .post('/api/auth/password')
      .send({ currentPassword: 'not-my-password', newPassword: NEW_PASSWORD })
      .expect(400);
    assert.equal(res.body.error, 'Current password is incorrect');

    await login(PASSWORD).expect(200);
    await login(NEW_PASSWORD).expect(401);
    // The failed attempt does not sign the user out.
    await client.get('/api/cattle').expect(200);
  });

  test('refuses a new password shorter than 10 characters', async () => {
    const client = await signedIn(EMAIL);
    const res = await client
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: 'short-pw1' })
      .expect(400);
    assert.equal(res.body.error, 'New password must be 10 to 128 characters');
    await login(PASSWORD).expect(200);
  });

  test('refuses a new password longer than 128 characters', async () => {
    const client = await signedIn(EMAIL);
    const res = await client
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: 'x'.repeat(129) })
      .expect(400);
    assert.equal(res.body.error, 'New password must be 10 to 128 characters');
  });

  test('accepts a new password of exactly 10 and 128 characters', async () => {
    const client = await signedIn(EMAIL);
    await client.post('/api/auth/password').send({ currentPassword: PASSWORD, newPassword: 'y'.repeat(10) }).expect(200);
    await client.post('/api/auth/password').send({ currentPassword: 'y'.repeat(10), newPassword: 'z'.repeat(128) }).expect(200);
    await login('z'.repeat(128)).expect(200);
  });

  test('refuses a missing current password or non-string values', async () => {
    const client = await signedIn(EMAIL);
    let res = await client.post('/api/auth/password').send({ newPassword: NEW_PASSWORD }).expect(400);
    assert.equal(res.body.error, 'Enter your current password');
    res = await client.post('/api/auth/password').send({ currentPassword: '', newPassword: NEW_PASSWORD }).expect(400);
    assert.equal(res.body.error, 'Enter your current password');
    res = await client.post('/api/auth/password').send({ currentPassword: PASSWORD, newPassword: 12345678901 }).expect(400);
    assert.equal(res.body.error, 'New password must be 10 to 128 characters');
  });

  test('refuses a new password equal to the current one', async () => {
    const client = await signedIn(EMAIL);
    const res = await client
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD })
      .expect(400);
    assert.equal(res.body.error, 'New password must be different from the current one');
  });

  test('signs out other sessions of the user and gives this session a new ID', async () => {
    const client = await signedIn(EMAIL);
    const otherDevice = agent();
    await otherDevice.post('/api/auth/login').send({ email: EMAIL, password: PASSWORD }).expect(200);
    const someoneElse = await signedIn('neighbour@example.com');
    assert.equal(await sessionCount(client.user.id), 2);

    const res = await client
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
    assert.ok(sessionCookie(res), 'sets a new session cookie');

    await client.get('/api/cattle').expect(200);
    const status = await client.get('/api/auth/status');
    assert.equal(status.body.authenticated, true);
    assert.equal(status.body.user.email, EMAIL);

    await otherDevice.get('/api/cattle').expect(401);
    await someoneElse.get('/api/cattle').expect(200);
    assert.equal(await sessionCount(client.user.id), 1);
  });

  test('the old session ID no longer works after the change', async () => {
    await signedIn(EMAIL);
    const loginRes = await login(PASSWORD).expect(200);
    const oldCookie = sessionCookie(loginRes).split(';')[0];

    const res = await request(app)
      .post('/api/auth/password')
      .set('Cookie', oldCookie)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
    const newCookie = sessionCookie(res).split(';')[0];
    assert.notEqual(newCookie, oldCookie);

    await request(app).get('/api/cattle').set('Cookie', oldCookie).expect(401);
    await request(app).get('/api/cattle').set('Cookie', newCookie).expect(200);
  });

  test('is refused for demo accounts', async (t) => {
    process.env.DEMO_MODE = 'true';
    t.after(() => delete process.env.DEMO_MODE);
    const client = agent();
    await client.post('/api/auth/demo').expect(201);
    const { rows: before } = await pool.query('SELECT password_hash FROM users WHERE is_demo');

    const res = await client
      .post('/api/auth/password')
      .send({ currentPassword: 'anything-at-all', newPassword: NEW_PASSWORD })
      .expect(403);
    assert.equal(res.body.error, "Demo accounts can't change their password");

    const { rows: after } = await pool.query('SELECT password_hash FROM users WHERE is_demo');
    assert.equal(after[0].password_hash, before[0].password_hash);
    await client.get('/api/cattle').expect(200);
  });

  test('a session whose user was deleted gets 401', async () => {
    const client = await signedIn(EMAIL);
    await pool.query('DELETE FROM users WHERE id = $1', [client.user.id]);
    // requireAuth only checks the session, so the route itself must notice the missing user.
    const res = await client
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401);
    assert.equal(res.body.error, 'Session expired');
  });
});
