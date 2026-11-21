const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool, agent, signedIn, useDatabase, PASSWORD } = require('../helpers/api');

useDatabase();

// Number of stored sessions (connect-pg-simple rows) that belong to a user.
async function sessionCount(userId) {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM session WHERE sess->>'userId' = $1::text", [userId]);
  return rows[0].n;
}

async function roleOf(userId) {
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return rows[0]?.role;
}

describe('/api/users is admin-only', () => {
  const calls = [
    ['get', '/api/users'],
    ['post', '/api/users'],
    ['patch', '/api/users/1'],
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
    for (const role of ['owner', ['admin'], '']) {
      const r = await admin.post('/api/users').send({ email: 'x@example.com', password: PASSWORD, role }).expect(400);
      assert.equal(r.body.error, 'Role must be admin or user');
    }
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

  test("deleting a user ends their open sessions", async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const user = await signedIn('user@example.com');
    const otherTab = agent();
    await otherTab.post('/api/auth/login').send({ email: 'user@example.com', password: PASSWORD }).expect(200);
    assert.equal(await sessionCount(user.user.id), 2);

    await admin.delete(`/api/users/${user.user.id}`).expect(200);
    assert.equal(await sessionCount(user.user.id), 0);
    for (const client of [user, otherTab]) {
      await client.get('/api/cattle').expect(401);
      await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(401);
      const status = await client.get('/api/auth/status').expect(200);
      assert.equal(status.body.authenticated, false);
    }
    // The admin's own session is untouched
    await admin.get('/api/users').expect(200);
  });

  test("a deleted admin's open session can no longer use admin routes", async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const boss = await signedIn('boss@example.com', { role: 'admin' });
    await admin.delete(`/api/users/${boss.user.id}`).expect(200);
    await boss.get('/api/users').expect(401);
    await boss.post('/api/users').send({ email: 'x@example.com', password: PASSWORD }).expect(401);
    const { rows } = await pool.query('SELECT email FROM users ORDER BY id');
    assert.deepEqual(rows.map((r) => r.email), ['admin@example.com']);
  });

  test('a session whose user vanished some other way gets 401 on admin routes and is ended', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    await signedIn('other@example.com', { role: 'admin' });
    // Removed outside the API, so the session row is still there
    await pool.query('DELETE FROM users WHERE id = $1', [admin.user.id]);
    const res = await admin.get('/api/users').expect(401);
    assert.equal(res.body.error, 'Session expired');
    assert.equal(await sessionCount(admin.user.id), 0);
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

describe('PATCH /api/users/:id changes a role', () => {
  test('promotes a user, who gets admin access on their open session straight away', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const user = await signedIn('user@example.com');
    await user.get('/api/users').expect(403);

    const res = await admin.patch(`/api/users/${user.user.id}`).send({ role: 'admin' }).expect(200);
    assert.deepEqual(Object.keys(res.body).sort(), ['created_at', 'email', 'id', 'role']);
    assert.equal(res.body.email, 'user@example.com');
    assert.equal(res.body.role, 'admin');
    assert.equal(await roleOf(user.user.id), 'admin');

    await user.get('/api/users').expect(200);
    const status = await user.get('/api/auth/status').expect(200);
    assert.equal(status.body.user.role, 'admin');
  });

  test('demoting an admin takes effect on their open session immediately', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const boss = await signedIn('boss@example.com', { role: 'admin' });
    await boss.get('/api/users').expect(200);
    await boss.post('/api/cattle').send({ tagNumber: 'B-1' }).expect(201);

    const res = await admin.patch(`/api/users/${boss.user.id}`).send({ role: 'user' }).expect(200);
    assert.equal(res.body.role, 'user');

    // Still signed in as a regular user, but every admin route now refuses
    for (const [method, path, body] of [
      ['get', '/api/users'],
      ['post', '/api/users', { email: 'x@example.com', password: PASSWORD }],
      ['patch', `/api/users/${admin.user.id}`, { role: 'user' }],
      ['delete', `/api/users/${admin.user.id}`],
    ]) {
      const r = await boss[method](path).send(body).expect(403);
      assert.equal(r.body.error, 'Admin only');
    }
    const cattle = await boss.get('/api/cattle').expect(200);
    assert.equal(cattle.body.length, 1);
    const status = await boss.get('/api/auth/status').expect(200);
    assert.equal(status.body.user.role, 'user');

    // The role saved in the open session is updated too
    const { rows } = await pool.query("SELECT sess->>'role' AS role FROM session WHERE sess->>'userId' = $1::text", [boss.user.id]);
    assert.deepEqual(rows, [{ role: 'user' }]);
    assert.equal(await roleOf(admin.user.id), 'admin');
  });

  test('setting the role a user already has is accepted and changes nothing', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const res = await admin.patch(`/api/users/${admin.user.id}`).send({ role: 'admin' }).expect(200);
    assert.equal(res.body.role, 'admin');
    await admin.get('/api/users').expect(200);
  });

  test('validates the id and the role', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const user = await signedIn('user@example.com');
    for (const body of [{}, { role: 'owner' }, { role: '' }, { role: ['admin'] }, { role: 'ADMIN' }]) {
      const res = await admin.patch(`/api/users/${user.user.id}`).send(body).expect(400);
      assert.equal(res.body.error, 'Role must be admin or user');
    }
    await admin.patch('/api/users/abc').send({ role: 'admin' }).expect(400);
    assert.equal(await roleOf(user.user.id), 'user');
  });

  test('returns 404 for an unknown user or a demo user', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const res = await admin.patch('/api/users/9999').send({ role: 'admin' }).expect(404);
    assert.equal(res.body.error, 'User not found');
    const { rows } = await pool.query(
      "INSERT INTO users (email, password_hash, is_demo) VALUES ('demo-1@demo.invalid', 'x', true) RETURNING id"
    );
    await admin.patch(`/api/users/${rows[0].id}`).send({ role: 'admin' }).expect(404);
    assert.equal(await roleOf(rows[0].id), 'user');
  });

  test('a regular user cannot promote themselves', async () => {
    await signedIn('admin@example.com', { role: 'admin' });
    const user = await signedIn('user@example.com');
    await user.patch(`/api/users/${user.user.id}`).send({ role: 'admin' }).expect(403);
    assert.equal(await roleOf(user.user.id), 'user');
  });
});

describe('there is always at least one admin', () => {
  const LAST_ADMIN = 'This is the last admin. Make another user an admin first.';

  test('the only admin cannot demote themselves', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    await signedIn('user@example.com');
    const res = await admin.patch(`/api/users/${admin.user.id}`).send({ role: 'user' }).expect(409);
    assert.equal(res.body.error, LAST_ADMIN);
    assert.equal(await roleOf(admin.user.id), 'admin');
    await admin.get('/api/users').expect(200);
  });

  test('an admin can step down while another admin remains, and loses access at once', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const boss = await signedIn('boss@example.com', { role: 'admin' });
    await admin.patch(`/api/users/${admin.user.id}`).send({ role: 'user' }).expect(200);
    await admin.get('/api/users').expect(403);
    // Now the remaining admin is the last one
    const res = await boss.patch(`/api/users/${boss.user.id}`).send({ role: 'user' }).expect(409);
    assert.equal(res.body.error, LAST_ADMIN);
  });

  test('an admin can delete another admin while one admin remains', async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const boss = await signedIn('boss@example.com', { role: 'admin' });
    await admin.delete(`/api/users/${boss.user.id}`).expect(200);
    const { rows } = await pool.query("SELECT email FROM users WHERE role = 'admin'");
    assert.deepEqual(rows, [{ email: 'admin@example.com' }]);
  });

  // The last admin can only be targeted when two admins act at the same moment:
  // each request passed requireAdmin while the other admin still existed.
  test('two admins deleting each other at once leaves one admin', async () => {
    for (let round = 0; round < 5; round++) {
      await pool.query('TRUNCATE session, cattle, users RESTART IDENTITY CASCADE');
      const a = await signedIn('a@example.com', { role: 'admin' });
      const b = await signedIn('b@example.com', { role: 'admin' });
      const results = await Promise.all([
        a.delete(`/api/users/${b.user.id}`),
        b.delete(`/api/users/${a.user.id}`),
      ]);
      const statuses = results.map((r) => r.status).sort();
      assert.equal(statuses[0], 200, `one delete succeeds (got ${statuses})`);
      assert.ok([401, 409].includes(statuses[1]), `the other is refused (got ${statuses})`);
      if (statuses[1] === 409) assert.equal(results.find((r) => r.status === 409).body.error, LAST_ADMIN);
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin'");
      assert.equal(rows[0].n, 1);
    }
  });

  test('two admins demoting each other at once leaves one admin', async () => {
    for (let round = 0; round < 5; round++) {
      await pool.query('TRUNCATE session, cattle, users RESTART IDENTITY CASCADE');
      const a = await signedIn('a@example.com', { role: 'admin' });
      const b = await signedIn('b@example.com', { role: 'admin' });
      const results = await Promise.all([
        a.patch(`/api/users/${b.user.id}`).send({ role: 'user' }),
        b.patch(`/api/users/${a.user.id}`).send({ role: 'user' }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      assert.equal(statuses[0], 200, `one demotion succeeds (got ${statuses})`);
      assert.ok([403, 409].includes(statuses[1]), `the other is refused (got ${statuses})`);
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin'");
      assert.equal(rows[0].n, 1);
    }
  });
});
