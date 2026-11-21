const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool, agent, signedIn, useDatabase, PASSWORD } = require('../helpers/api');

useDatabase();

describe('/api/users is admin-only', () => {
  const calls = [
    ['get', '/api/users'],
    ['post', '/api/users'],
    ['delete', '/api/users/1'],
  ];

  for (const [method, path] of calls) {
    test(`${method.toUpperCase()} ${path} without a session returns 401`, async () => {
      await request(app)[method](path).send({ email: 'x@example.com', password: PASSWORD }).expect(401);
    });

    test(`${method.toUpperCase()} ${path} as a regular user returns 403`, async () => {
      const user = await signedIn('user@example.com');
      const res = await user[method](path).send({ email: 'x@example.com', password: PASSWORD }).expect(403);
      assert.equal(res.body.error, 'Admin only');
    });
  }

  test('a regular user cannot create or delete accounts', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const user = await signedIn('user@example.com');
    await user.post('/api/users').send({ email: 'x@example.com', password: PASSWORD, role: 'admin' }).expect(403);
    await user.delete(`/api/users/${admin.user.id}`).expect(403);
    const { rows } = await pool.query('SELECT email FROM users ORDER BY id');
    assert.deepEqual(rows.map((r) => r.email), ['admin@example.com', 'user@example.com']);
  });
});

describe('user management as admin', () => {
  test('lists users without password hashes', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    await signedIn('user@example.com');
    const res = await admin.get('/api/users').expect(200);
    assert.deepEqual(
      res.body.map(({ id, email, role }) => ({ id, email, role })),
      [
        { id: admin.user.id, email: 'admin@example.com', role: 'admin' },
        { id: admin.user.id + 1, email: 'user@example.com', role: 'user' },
      ]
    );
    for (const row of res.body) {
      assert.deepEqual(Object.keys(row).sort(), ['created_at', 'email', 'id', 'role']);
    }
  });

  test('creates a user who can then sign in', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const res = await admin
      .post('/api/users')
      .send({ email: 'New.Hand@Example.com', password: 'another-long-password' })
      .expect(201);
    assert.equal(res.body.email, 'new.hand@example.com');
    assert.equal(res.body.role, 'user');
    assert.equal(res.body.password_hash, undefined);

    const hand = agent();
    await hand.post('/api/auth/login').send({ email: 'new.hand@example.com', password: 'another-long-password' }).expect(200);
    await hand.get('/api/users').expect(403);
  });

  test('can create another admin', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const res = await admin
      .post('/api/users')
      .send({ email: 'boss@example.com', password: PASSWORD, role: 'admin' })
      .expect(201);
    assert.equal(res.body.role, 'admin');
  });

  test('rejects a duplicate email', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const res = await admin.post('/api/users').send({ email: 'ADMIN@example.com', password: PASSWORD }).expect(409);
    assert.equal(res.body.error, 'That email is already registered');
  });

  test('rejects an invalid email, a short password and an unknown role', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const bad = await admin.post('/api/users').send({ email: 'nope', password: PASSWORD }).expect(400);
    assert.equal(bad.body.error, 'Enter a valid email');
    const short = await admin.post('/api/users').send({ email: 'x@example.com', password: 'short' }).expect(400);
    assert.equal(short.body.error, 'Password must be 10 to 128 characters');
    await admin.post('/api/users').send({ email: 'x@example.com', password: PASSWORD, role: 'owner' }).expect(400);
    const list = await admin.get('/api/users');
    assert.equal(list.body.length, 1);
  });

  test('deletes a user together with their cattle', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const user = await signedIn('user@example.com');
    await user.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201);

    const res = await admin.delete(`/api/users/${user.user.id}`).expect(200);
    assert.deepEqual(res.body, { ok: true });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM cattle');
    assert.equal(rows[0].n, 0);
    await admin.delete(`/api/users/${user.user.id}`).expect(404);
  });

  test("a deleted user's open session can no longer save cattle", async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const user = await signedIn('user@example.com');
    await admin.delete(`/api/users/${user.user.id}`).expect(200);
    const res = await user.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(401);
    assert.equal(res.body.error, 'Session expired');
  });

  test('an admin cannot delete themselves', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const res = await admin.delete(`/api/users/${admin.user.id}`).expect(400);
    assert.equal(res.body.error, "You can't delete yourself");
    const list = await admin.get('/api/users');
    assert.equal(list.body.length, 1);
  });

  test('returns 400 for an id that is not a number', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    await admin.delete('/api/users/abc').expect(400);
  });
});
