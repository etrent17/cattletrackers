// Owner isolation: one account can never see or change another account's cattle,
// whatever its role.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { pool, signedIn, useDatabase } = require('../helpers/api');

useDatabase();

describe('owner isolation', () => {
  let alice;
  let bob;
  let bobsCow;

  beforeEach(async () => {
    alice = await signedIn('alice@example.com');
    bob = await signedIn('bob@example.com');
    const res = await bob
      .post('/api/cattle')
      .send({ tagNumber: 'BOB-1', nameBreed: 'Bobs Angus', notes: 'private' })
      .expect(201);
    bobsCow = res.body;
  });

  const bobsRecord = async () => (await bob.get('/api/cattle').expect(200)).body;

  test("user A's list does not include user B's cattle", async () => {
    await alice.post('/api/cattle').send({ tagNumber: 'ALICE-1' }).expect(201);
    const res = await alice.get('/api/cattle').expect(200);
    assert.deepEqual(res.body.map((c) => c.tagNumber), ['ALICE-1']);
    assert.ok(!JSON.stringify(res.body).includes('BOB-1'));
  });

  test("user A cannot update user B's cattle", async () => {
    const res = await alice
      .put(`/api/cattle/${bobsCow.id}`)
      .send({ tagNumber: 'STOLEN', nameBreed: 'Alices now' })
      .expect(404);
    assert.equal(res.body.error, 'Cattle not found');
    assert.deepEqual(await bobsRecord(), [bobsCow]);
  });

  test("user A cannot delete user B's cattle", async () => {
    const res = await alice.delete(`/api/cattle/${bobsCow.id}`).expect(404);
    assert.equal(res.body.error, 'Cattle not found');
    assert.deepEqual(await bobsRecord(), [bobsCow]);
  });

  test("an admin cannot read, update or delete another user's cattle either", async () => {
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    const list = await admin.get('/api/cattle').expect(200);
    assert.deepEqual(list.body, []);
    await admin.put(`/api/cattle/${bobsCow.id}`).send({ tagNumber: 'ADMIN-1' }).expect(404);
    await admin.delete(`/api/cattle/${bobsCow.id}`).expect(404);
    assert.deepEqual(await bobsRecord(), [bobsCow]);
  });

  test('a client cannot choose the owner of a new record', async () => {
    const res = await alice
      .post('/api/cattle')
      .send({ tagNumber: 'ALICE-1', ownerId: bob.user.id, owner_id: bob.user.id })
      .expect(201);
    const { rows } = await pool.query('SELECT owner_id FROM cattle WHERE id = $1', [res.body.id]);
    assert.equal(rows[0].owner_id, alice.user.id);
    assert.equal((await bobsRecord()).length, 1);
  });

  test('two users can use the same cow number', async () => {
    await alice.post('/api/cattle').send({ tagNumber: 'bob-1' }).expect(201);
    await alice.post('/api/cattle').send({ tagNumber: 'BOB-1' }).expect(409);
    assert.equal((await bobsRecord()).length, 1);
  });

  test('after signing out, a session no longer reaches its own cattle', async () => {
    await bob.post('/api/auth/logout').expect(200);
    await bob.get('/api/cattle').expect(401);
    await bob.delete(`/api/cattle/${bobsCow.id}`).expect(401);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM cattle');
    assert.equal(rows[0].n, 1);
  });
});
