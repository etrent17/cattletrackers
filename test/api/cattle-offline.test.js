// Offline editing (feature 14): what the server adds so a browser can replay changes made
// without a connection. Client-chosen ids on create, and `expectedUpdatedAt` on update and delete.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { signedIn, useDatabase, pool } = require('../helpers/api');

useDatabase();

const CLIENT_ID = '3f2b8c1e-7a4d-4e9b-9c55-0a1b2c3d4e5f';
const OTHER_ID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';

const count = async (table = 'cattle') => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
const weighingsOf = async (id) =>
  (await pool.query('SELECT date::text, weight::float AS weight FROM weighings WHERE cattle_id = $1 ORDER BY date', [id])).rows;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

describe('create with a client id', () => {
  test('uses the id the client chose', async () => {
    const client = await signedIn('a@example.com');
    const res = await client.post('/api/cattle').send({ id: CLIENT_ID, tagNumber: 'CT-1', nameBreed: 'Daisy' }).expect(201);
    assert.equal(res.body.id, CLIENT_ID);
    const list = await client.get('/api/cattle').expect(200);
    assert.deepEqual(list.body.map((c) => c.id), [CLIENT_ID]);
  });

  test('without an id the server still chooses one', async () => {
    const client = await signedIn('a@example.com');
    const res = await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201);
    assert.match(res.body.id, /^[0-9a-f-]{36}$/);
    const withNull = await client.post('/api/cattle').send({ id: null, tagNumber: 'CT-2' }).expect(201);
    assert.match(withNull.body.id, /^[0-9a-f-]{36}$/);
  });

  test('replaying the same create returns the existing animal and writes nothing', async () => {
    const client = await signedIn('a@example.com');
    const body = { id: CLIENT_ID, tagNumber: 'CT-1', nameBreed: 'Daisy', weight: 900, weightDate: daysAgo(3), lastCalvingDate: '2025-01-10' };
    const first = await client.post('/api/cattle').send(body).expect(201);
    const second = await client.post('/api/cattle').send(body).expect(200);
    assert.deepEqual(second.body, first.body);
    assert.equal(await count(), 1);
    assert.equal(await count('weighings'), 1);
    assert.equal(await count('calving_events'), 1);
  });

  test('a replay returns the animal as it is now, not as it was sent', async () => {
    const client = await signedIn('a@example.com');
    await client.post('/api/cattle').send({ id: CLIENT_ID, tagNumber: 'CT-1', nameBreed: 'Daisy' }).expect(201);
    await client.put(`/api/cattle/${CLIENT_ID}`).send({ tagNumber: 'CT-1', nameBreed: 'Daisy II' }).expect(200);
    const replay = await client.post('/api/cattle').send({ id: CLIENT_ID, tagNumber: 'CT-1', nameBreed: 'Daisy' }).expect(200);
    assert.equal(replay.body.nameBreed, 'Daisy II');
  });

  test('two copies of one create arriving together make one animal', async () => {
    const client = await signedIn('a@example.com');
    const body = { id: CLIENT_ID, tagNumber: 'CT-1' };
    const results = await Promise.all([client.post('/api/cattle').send(body), client.post('/api/cattle').send(body)]);
    for (const r of results) {
      assert.ok(r.status === 200 || r.status === 201, `unexpected status ${r.status}`);
      assert.equal(r.body.id, CLIENT_ID);
    }
    assert.equal(await count(), 1);
  });

  test("another user's id is refused with a generic error and their animal is untouched", async () => {
    const owner = await signedIn('owner@example.com');
    await owner.post('/api/cattle').send({ id: CLIENT_ID, tagNumber: 'CT-1', nameBreed: 'Private name' }).expect(201);
    const other = await signedIn('other@example.com');
    const res = await other.post('/api/cattle').send({ id: CLIENT_ID, tagNumber: 'X-1', nameBreed: 'Intruder' }).expect(409);
    assert.deepEqual(res.body, { error: 'This record could not be saved with that id. Add it again.' });
    assert.deepEqual((await other.get('/api/cattle')).body, []);
    const mine = (await owner.get('/api/cattle')).body;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].nameBreed, 'Private name');
    assert.equal(mine[0].tagNumber, 'CT-1');
  });

  test('an admin cannot take over an id either', async () => {
    const owner = await signedIn('owner@example.com');
    await owner.post('/api/cattle').send({ id: CLIENT_ID, tagNumber: 'CT-1' }).expect(201);
    const admin = await signedIn('admin@example.com', { role: 'admin' });
    await admin.post('/api/cattle').send({ id: CLIENT_ID, tagNumber: 'CT-1' }).expect(409);
    assert.deepEqual((await admin.get('/api/cattle')).body, []);
  });

  test('a malformed id is refused', async () => {
    const client = await signedIn('a@example.com');
    const res = await client.post('/api/cattle').send({ id: 'not-a-uuid', tagNumber: 'CT-1' }).expect(400);
    assert.equal(res.body.error, 'Invalid id');
    assert.equal(await count(), 0);
  });

  test('a new id with a cow number already in use is still a duplicate', async () => {
    const client = await signedIn('a@example.com');
    await client.post('/api/cattle').send({ id: CLIENT_ID, tagNumber: 'CT-1' }).expect(201);
    const res = await client.post('/api/cattle').send({ id: OTHER_ID, tagNumber: 'ct-1' }).expect(409);
    assert.equal(res.body.error, 'Duplicate cow number');
    assert.equal(await count(), 1);
  });
});

describe('update with expectedUpdatedAt', () => {
  test('is applied when the record has not changed since', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1', nameBreed: 'Daisy' }).expect(201)).body;
    const res = await client.put(`/api/cattle/${cow.id}`)
      .send({ tagNumber: 'CT-1', nameBreed: 'Daisy II', expectedUpdatedAt: cow.updatedAt }).expect(200);
    assert.equal(res.body.nameBreed, 'Daisy II');
    assert.notEqual(res.body.updatedAt, cow.updatedAt);
  });

  test('is refused with 409 and the current record when it changed since', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1', nameBreed: 'Daisy' }).expect(201)).body;
    const online = (await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', nameBreed: 'Changed online' }).expect(200)).body;

    const res = await client.put(`/api/cattle/${cow.id}`)
      .send({ tagNumber: 'CT-1', nameBreed: 'Changed offline', weight: 950, expectedUpdatedAt: cow.updatedAt }).expect(409);
    assert.equal(res.body.code, 'stale');
    assert.match(res.body.error, /changed after you last loaded it/);
    assert.deepEqual(res.body.current, online);

    const after = (await client.get('/api/cattle')).body[0];
    assert.deepEqual(after, online);
    assert.equal(await count('weighings'), 0);
  });

  test('a record whose weighings changed counts as changed', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1', gender: 'female' }).expect(201)).body;
    await client.post(`/api/cattle/${cow.id}/weighings`).send({ date: daysAgo(1), weight: 800 }).expect(201);
    const res = await client.put(`/api/cattle/${cow.id}`)
      .send({ tagNumber: 'CT-1', notes: 'offline note', expectedUpdatedAt: cow.updatedAt }).expect(409);
    assert.equal(res.body.current.weight, 800);
  });

  test('without it the update is applied as before, even over a newer change', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1', nameBreed: 'Daisy' }).expect(201)).body;
    await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', nameBreed: 'First' }).expect(200);
    const res = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', nameBreed: 'Second' }).expect(200);
    assert.equal(res.body.nameBreed, 'Second');
    const blank = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', nameBreed: 'Third', expectedUpdatedAt: '' }).expect(200);
    assert.equal(blank.body.nameBreed, 'Third');
  });

  test('a malformed value is refused and nothing changes', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1', nameBreed: 'Daisy' }).expect(201)).body;
    const res = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', nameBreed: 'X', expectedUpdatedAt: 'yesterday' }).expect(400);
    assert.equal(res.body.error, 'Invalid expectedUpdatedAt');
    assert.equal((await client.get('/api/cattle')).body[0].nameBreed, 'Daisy');
  });

  test('a record deleted elsewhere is a 404', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201)).body;
    await client.delete(`/api/cattle/${cow.id}`).expect(200);
    const res = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', expectedUpdatedAt: cow.updatedAt }).expect(404);
    assert.equal(res.body.error, 'Cattle not found');
  });

  test("another user's record is a 404 and never returned as `current`", async () => {
    const owner = await signedIn('owner@example.com');
    const cow = (await owner.post('/api/cattle').send({ tagNumber: 'CT-1', nameBreed: 'Private name' }).expect(201)).body;
    const other = await signedIn('other@example.com');
    for (const expectedUpdatedAt of [cow.updatedAt, '2020-01-01T00:00:00.000Z']) {
      const res = await other.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'X', expectedUpdatedAt }).expect(404);
      assert.deepEqual(res.body, { error: 'Cattle not found' });
    }
    assert.equal((await owner.get('/api/cattle')).body[0].nameBreed, 'Private name');
  });

  test('a duplicate cow number is still a 409 without `current`', async () => {
    const client = await signedIn('a@example.com');
    await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201);
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-2' }).expect(201)).body;
    const res = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', expectedUpdatedAt: cow.updatedAt }).expect(409);
    assert.deepEqual(res.body, { error: 'Duplicate cow number' });
  });
});

describe('weightDate on a replayed change', () => {
  test('a replayed edit dates the weighing when the change was made, not when it synced', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1', weight: 800, weightDate: daysAgo(30) }).expect(201)).body;
    const madeOn = daysAgo(4);
    const res = await client.put(`/api/cattle/${cow.id}`)
      .send({ tagNumber: 'CT-1', weight: 865.5, weightDate: madeOn, expectedUpdatedAt: cow.updatedAt }).expect(200);
    assert.equal(res.body.weight, 865.5);
    assert.deepEqual(await weighingsOf(cow.id), [
      { date: daysAgo(30), weight: 800 },
      { date: madeOn, weight: 865.5 },
    ]);
  });

  test('a replayed create dates the first weighing when the animal was added', async () => {
    const client = await signedIn('a@example.com');
    const madeOn = daysAgo(2);
    await client.post('/api/cattle').send({ id: CLIENT_ID, tagNumber: 'CT-1', weight: 640, weightDate: madeOn }).expect(201);
    assert.deepEqual(await weighingsOf(CLIENT_ID), [{ date: madeOn, weight: 640 }]);
  });

  test('a refused edit records no weighing', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1', weight: 800, weightDate: daysAgo(30) }).expect(201)).body;
    await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', notes: 'online' }).expect(200);
    await client.put(`/api/cattle/${cow.id}`)
      .send({ tagNumber: 'CT-1', weight: 900, weightDate: daysAgo(1), expectedUpdatedAt: cow.updatedAt }).expect(409);
    assert.deepEqual(await weighingsOf(cow.id), [{ date: daysAgo(30), weight: 800 }]);
  });
});

describe('delete with expectedUpdatedAt', () => {
  test('deletes when the record has not changed since (query string or body)', async () => {
    const client = await signedIn('a@example.com');
    const a = (await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201)).body;
    const b = (await client.post('/api/cattle').send({ tagNumber: 'CT-2' }).expect(201)).body;
    await client.delete(`/api/cattle/${a.id}`).query({ expectedUpdatedAt: a.updatedAt }).expect(200);
    await client.delete(`/api/cattle/${b.id}`).send({ expectedUpdatedAt: b.updatedAt }).expect(200);
    assert.equal(await count(), 0);
  });

  test('is refused with 409 and the current record when it changed since', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1', nameBreed: 'Daisy' }).expect(201)).body;
    const online = (await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', nameBreed: 'Changed online' }).expect(200)).body;
    for (const send of [
      () => client.delete(`/api/cattle/${cow.id}`).query({ expectedUpdatedAt: cow.updatedAt }),
      () => client.delete(`/api/cattle/${cow.id}`).send({ expectedUpdatedAt: cow.updatedAt }),
    ]) {
      const res = await send().expect(409);
      assert.equal(res.body.code, 'stale');
      assert.deepEqual(res.body.current, online);
    }
    assert.deepEqual((await client.get('/api/cattle')).body, [online]);
  });

  test('without it the record is deleted as before', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201)).body;
    await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', notes: 'newer' }).expect(200);
    await client.delete(`/api/cattle/${cow.id}`).expect(200);
    assert.equal(await count(), 0);
  });

  test('an already deleted record is a 404', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201)).body;
    await client.delete(`/api/cattle/${cow.id}`).expect(200);
    await client.delete(`/api/cattle/${cow.id}`).query({ expectedUpdatedAt: cow.updatedAt }).expect(404);
  });

  test("another user's record is a 404, whatever expectedUpdatedAt says", async () => {
    const owner = await signedIn('owner@example.com');
    const cow = (await owner.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201)).body;
    const other = await signedIn('other@example.com');
    for (const expectedUpdatedAt of [cow.updatedAt, '2020-01-01T00:00:00.000Z']) {
      const res = await other.delete(`/api/cattle/${cow.id}`).query({ expectedUpdatedAt }).expect(404);
      assert.deepEqual(res.body, { error: 'Cattle not found' });
    }
    assert.equal(await count(), 1);
  });

  test('a malformed value is refused and nothing is deleted', async () => {
    const client = await signedIn('a@example.com');
    const cow = (await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201)).body;
    const res = await client.delete(`/api/cattle/${cow.id}`).query({ expectedUpdatedAt: 'nope' }).expect(400);
    assert.equal(res.body.error, 'Invalid expectedUpdatedAt');
    assert.equal(await count(), 1);
  });
});
