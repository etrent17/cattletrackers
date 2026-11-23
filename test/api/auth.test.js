const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { agent, request, app, pool, createUser, signedIn, useDatabase, PASSWORD } = require('../helpers/api');

useDatabase();

const ADMIN = { email: 'admin@example.com', password: PASSWORD };

describe('GET /api/health', () => {
  test('reports the database as up', async () => {
    const res = await request(app).get('/api/health').expect(200);
    assert.deepEqual(res.body, { status: 'healthy', database: 'up' });
  });

  test('does not start a session', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.headers['set-cookie'], undefined);
  });
});

describe('first-run setup', () => {
  test('a fresh database asks for setup', async () => {
    const res = await request(app).get('/api/auth/status').expect(200);
    assert.deepEqual(res.body, {
      setupRequired: true,
      demoEnabled: false,
      registrationEnabled: false,
      authenticated: false,
      user: null,
      farms: [],
      farmId: null,
    });
  });

  test('creates the first admin and signs them in', async () => {
    const client = agent();
    const res = await client.post('/api/auth/setup').send(ADMIN).expect(201);
    assert.equal(res.body.user.email, ADMIN.email);
    assert.equal(res.body.user.role, 'admin');
    assert.equal(res.body.user.password_hash, undefined);

    const status = await client.get('/api/auth/status').expect(200);
    assert.equal(status.body.setupRequired, false);
    assert.equal(status.body.authenticated, true);
    assert.deepEqual(status.body.user, { id: res.body.user.id, email: ADMIN.email, role: 'admin', isDemo: false });
  });

  test('is refused once a user exists', async () => {
    await request(app).post('/api/auth/setup').send(ADMIN).expect(201);
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ email: 'second@example.com', password: PASSWORD })
      .expect(403);
    assert.equal(res.body.error, 'Setup has already been completed');
    const { rows } = await pool.query('SELECT email FROM users');
    assert.deepEqual(rows, [{ email: ADMIN.email }]);
  });

  test('stores the password hashed', async () => {
    await request(app).post('/api/auth/setup').send(ADMIN).expect(201);
    const { rows } = await pool.query('SELECT password_hash FROM users');
    assert.match(rows[0].password_hash, /^\$argon2id\$/);
  });

  test('rejects an invalid email', async () => {
    const res = await request(app).post('/api/auth/setup').send({ email: 'nope', password: PASSWORD }).expect(400);
    assert.equal(res.body.error, 'Enter a valid email');
  });

  test('rejects a password shorter than 10 characters', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ email: ADMIN.email, password: 'short' })
      .expect(400);
    assert.equal(res.body.error, 'Password must be 10 to 128 characters');
    const status = await request(app).get('/api/auth/status');
    assert.equal(status.body.setupRequired, true);
  });
});

describe('login and logout', () => {
  test('signs in with the right password', async () => {
    const user = await createUser('farmer@example.com');
    const client = agent();
    const res = await client.post('/api/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
    assert.deepEqual(res.body.user, { id: user.id, email: user.email, role: 'user' });
    const status = await client.get('/api/auth/status');
    assert.equal(status.body.authenticated, true);
  });

  test('ignores case and surrounding spaces in the email', async () => {
    await createUser('farmer@example.com');
    await request(app)
      .post('/api/auth/login')
      .send({ email: '  Farmer@Example.COM ', password: PASSWORD })
      .expect(200);
  });

  test('rejects a wrong password', async () => {
    await createUser('farmer@example.com');
    const client = agent();
    const res = await client
      .post('/api/auth/login')
      .send({ email: 'farmer@example.com', password: 'wrong-password-1' })
      .expect(401);
    assert.equal(res.body.error, 'Invalid email or password');
    const status = await client.get('/api/auth/status');
    assert.equal(status.body.authenticated, false);
  });

  test('gives an unknown email the same answer as a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD })
      .expect(401);
    assert.equal(res.body.error, 'Invalid email or password');
  });

  test('rejects a missing password', async () => {
    await request(app).post('/api/auth/login').send({ email: 'farmer@example.com' }).expect(400);
  });

  test('sets an HttpOnly, SameSite=Lax session cookie', async () => {
    await createUser('farmer@example.com');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'farmer@example.com', password: PASSWORD })
      .expect(200);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('connect.sid='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });

  test('logout ends the session', async () => {
    const client = await signedIn('farmer@example.com');
    await client.get('/api/cattle').expect(200);
    const res = await client.post('/api/auth/logout').expect(200);
    assert.deepEqual(res.body, { ok: true });
    await client.get('/api/cattle').expect(401);
    const status = await client.get('/api/auth/status');
    assert.equal(status.body.authenticated, false);
  });

  test('a session for a deleted user is no longer authenticated', async () => {
    const client = await signedIn('farmer@example.com');
    await pool.query('DELETE FROM users WHERE id = $1', [client.user.id]);
    const status = await client.get('/api/auth/status').expect(200);
    assert.equal(status.body.authenticated, false);
    assert.equal(status.body.user, null);
  });
});

describe('demo mode', () => {
  test('is off by default', async (t) => {
    const res = await request(app).post('/api/auth/demo').expect(404);
    assert.equal(res.body.error, 'Demo mode is not enabled');
  });

  test('when enabled, starts a session with eight sample animals and a 25-animal cap', async (t) => {
    process.env.DEMO_MODE = 'true';
    t.after(() => delete process.env.DEMO_MODE);

    const status = await request(app).get('/api/auth/status');
    assert.equal(status.body.demoEnabled, true);
    assert.equal(status.body.setupRequired, true, 'demo users do not count as setup');

    const client = agent();
    const demo = await client.post('/api/auth/demo').expect(201);
    assert.match(demo.body.user.email, /^demo-[0-9a-f]+@demo\.invalid$/);

    const me = await client.get('/api/auth/status');
    assert.equal(me.body.user.isDemo, true);

    const herd = await client.get('/api/cattle').expect(200);
    assert.equal(herd.body.length, 8);

    for (let n = 9; n <= 25; n += 1) {
      await client.post('/api/cattle').send({ tagNumber: `EXTRA-${n}` }).expect(201);
    }
    const res = await client.post('/api/cattle').send({ tagNumber: 'EXTRA-26' }).expect(403);
    assert.equal(res.body.error, 'Demo accounts are limited to 25 animals.');
  });
});
