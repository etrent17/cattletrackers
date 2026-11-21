const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool, signedIn, useDatabase } = require('../helpers/api');

useDatabase();

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const FULL = { checkDate: '2026-02-20', result: 'pregnant', method: 'ultrasound', notes: 'Single calf.' };

const addCow = async (client, fields = {}) =>
  (await client.post('/api/cattle').send({ tagNumber: 'COW-1', gender: 'female', ...fields }).expect(201)).body;
const breed = async (client, cowId, fields = {}) =>
  (await client.post(`/api/cattle/${cowId}/breedings`).send({ breedingDate: '2026-01-10', ...fields }).expect(201)).body;
const check = async (client, cowId, fields = {}) =>
  (await client.post(`/api/cattle/${cowId}/pregnancy-checks`).send({ ...FULL, ...fields }).expect(201)).body;
const herd = async (client) => (await client.get('/api/cattle').expect(200)).body;
const cowById = async (client, id) => (await herd(client)).find((c) => c.id === id);
const setCow = (client, cow, fields) =>
  client.put(`/api/cattle/${cow.id}`).send({ tagNumber: cow.tagNumber, gender: 'female', ...fields }).expect(200);
const checkCount = async () => (await pool.query('SELECT count(*)::int AS n FROM pregnancy_checks')).rows[0].n;

describe('authentication', () => {
  for (const [method, path] of [
    ['get', '/api/pregnancy-checks'],
    ['get', `/api/cattle/${UNKNOWN_ID}/pregnancy-checks`],
    ['post', `/api/cattle/${UNKNOWN_ID}/pregnancy-checks`],
    ['put', `/api/pregnancy-checks/${UNKNOWN_ID}`],
    ['delete', `/api/pregnancy-checks/${UNKNOWN_ID}`],
  ]) {
    test(`${method.toUpperCase()} ${path} needs a session`, async () => {
      const res = await request(app)[method](path).send(FULL).expect(401);
      assert.equal(res.body.error, 'Authentication required');
    });
  }
});

describe('create and read', () => {
  test('records a check with every field, linked to a breeding', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { nameBreed: 'Daisy' });
    const b = await breed(client, cow.id);
    const res = await client.post(`/api/cattle/${cow.id}/pregnancy-checks`).send({ ...FULL, breedingId: b.id }).expect(201);
    const { id, createdAt, ...rest } = res.body;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.ok(createdAt);
    assert.deepEqual(rest, {
      ...FULL,
      cattleId: cow.id,
      cattleTag: 'COW-1',
      cattleName: 'Daisy',
      breedingId: b.id,
      breedingDate: '2026-01-10',
    });
    assert.deepEqual((await client.get(`/api/cattle/${cow.id}/pregnancy-checks`).expect(200)).body, [res.body]);
    assert.deepEqual((await client.get('/api/pregnancy-checks').expect(200)).body, [res.body]);
  });

  test('needs only a date and a result', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const c = await check(client, cow.id, { method: '', notes: '', result: 'unsure' });
    assert.equal(c.method, '');
    assert.equal(c.notes, '');
    assert.equal(c.breedingId, null);
    assert.equal(c.breedingDate, '');
  });

  test('lists newest check first, per cow and for the whole herd', async () => {
    const client = await signedIn('a@example.com');
    const a = await addCow(client, { tagNumber: 'A' });
    const b = await addCow(client, { tagNumber: 'B' });
    await check(client, a.id, { checkDate: '2026-01-01' });
    await check(client, b.id, { checkDate: '2026-03-01' });
    await check(client, a.id, { checkDate: '2026-02-01' });
    assert.deepEqual((await client.get('/api/pregnancy-checks')).body.map((c) => `${c.cattleTag} ${c.checkDate}`), ['B 2026-03-01', 'A 2026-02-01', 'A 2026-01-01']);
    assert.deepEqual((await client.get(`/api/cattle/${a.id}/pregnancy-checks`)).body.map((c) => c.checkDate), ['2026-02-01', '2026-01-01']);
  });

  test('404 for an unknown cow, 400 for a malformed id, 400 for a male', async () => {
    const client = await signedIn('a@example.com');
    assert.equal((await client.get(`/api/cattle/${UNKNOWN_ID}/pregnancy-checks`).expect(404)).body.error, 'Cattle not found');
    assert.equal((await client.post(`/api/cattle/${UNKNOWN_ID}/pregnancy-checks`).send(FULL).expect(404)).body.error, 'Cattle not found');
    assert.equal((await client.get('/api/cattle/x/pregnancy-checks').expect(400)).body.error, 'Invalid cattle id');
    const bull = await addCow(client, { tagNumber: 'BULL', gender: 'male' });
    const res = await client.post(`/api/cattle/${bull.id}/pregnancy-checks`).send(FULL).expect(400);
    assert.equal(res.body.error, 'Only female animals can have pregnancy checks');
  });
});

describe('validation', () => {
  const cases = [
    ['a missing date', { checkDate: '' }, 'Enter a valid check date'],
    ['an impossible date', { checkDate: '2026-02-30' }, 'Enter a valid check date'],
    ['a future date', { checkDate: '2999-01-01' }, 'The check date cannot be in the future'],
    ['a missing result', { result: '' }, 'Choose a result: pregnant, open or unsure'],
    ['an unknown result', { result: 'maybe' }, 'Choose a result: pregnant, open or unsure'],
    ['an unknown method', { method: 'guess' }, 'Invalid check method'],
    ['a malformed breeding id', { breedingId: 'b' }, 'Unknown breeding record'],
    ['notes over 2000 characters', { notes: 'x'.repeat(2001) }, 'Notes are too long'],
  ];
  for (const [name, fields, message] of cases) {
    test(`rejects ${name} on create and on update`, async () => {
      const client = await signedIn('a@example.com');
      const cow = await addCow(client);
      assert.equal((await client.post(`/api/cattle/${cow.id}/pregnancy-checks`).send({ ...FULL, ...fields }).expect(400)).body.error, message);
      const c = await check(client, cow.id);
      assert.equal((await client.put(`/api/pregnancy-checks/${c.id}`).send({ ...FULL, ...fields }).expect(400)).body.error, message);
      assert.deepEqual((await client.get('/api/pregnancy-checks')).body, [c]);
    });
  }

  test("the breeding must be this cow's and dated on or before the check", async () => {
    const alice = await signedIn('alice@example.com');
    const bob = await signedIn('bob@example.com');
    const cow = await addCow(alice);
    const other = await addCow(alice, { tagNumber: 'COW-2' });
    const othersBreeding = await breed(alice, other.id);
    const bobsCow = await addCow(bob);
    const bobsBreeding = await breed(bob, bobsCow.id);
    for (const breedingId of [othersBreeding.id, bobsBreeding.id, UNKNOWN_ID]) {
      const res = await alice.post(`/api/cattle/${cow.id}/pregnancy-checks`).send({ ...FULL, breedingId }).expect(400);
      assert.equal(res.body.error, 'Unknown breeding record');
    }
    const mine = await breed(alice, cow.id, { breedingDate: '2026-02-21' });
    const res = await alice.post(`/api/cattle/${cow.id}/pregnancy-checks`).send({ ...FULL, breedingId: mine.id }).expect(400);
    assert.equal(res.body.error, 'The check date cannot be before the breeding date');
    await check(alice, cow.id, { checkDate: '2026-02-21', breedingId: mine.id });
    assert.equal(await checkCount(), 1);
  });

  test('rejects a malformed check id', async () => {
    const client = await signedIn('a@example.com');
    assert.equal((await client.put('/api/pregnancy-checks/x').send(FULL).expect(400)).body.error, 'Invalid check id');
    assert.equal((await client.delete('/api/pregnancy-checks/x').expect(400)).body.error, 'Invalid check id');
  });
});

describe('update and delete', () => {
  test('update replaces the fields and keeps the cow', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const b = await breed(client, cow.id);
    const c = await check(client, cow.id, { breedingId: b.id });
    const res = await client.put(`/api/pregnancy-checks/${c.id}`).send({ checkDate: '2026-03-01', result: 'unsure', cattleId: UNKNOWN_ID }).expect(200);
    assert.equal(res.body.cattleId, cow.id);
    assert.equal(res.body.checkDate, '2026-03-01');
    assert.equal(res.body.result, 'unsure');
    assert.equal(res.body.method, '');
    assert.equal(res.body.notes, '');
    assert.equal(res.body.breedingId, null);
  });

  test('delete removes the check', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const c = await check(client, cow.id);
    assert.deepEqual((await client.delete(`/api/pregnancy-checks/${c.id}`).expect(200)).body, { ok: true });
    assert.equal(await checkCount(), 0);
  });

  test('unknown ids return 404', async () => {
    const client = await signedIn('a@example.com');
    assert.equal((await client.put(`/api/pregnancy-checks/${UNKNOWN_ID}`).send(FULL).expect(404)).body.error, 'Pregnancy check not found');
    assert.equal((await client.delete(`/api/pregnancy-checks/${UNKNOWN_ID}`).expect(404)).body.error, 'Pregnancy check not found');
  });
});

describe('health status and expected calving date', () => {
  let client;
  let cow;
  beforeEach(async () => {
    client = await signedIn('a@example.com');
    cow = await addCow(client);
  });
  const state = async () => {
    const c = await cowById(client, cow.id);
    return [c.healthStatus, c.expectedCalvingDate];
  };

  test('a positive check marks a healthy cow Pregnant and keeps her expected date', async () => {
    await breed(client, cow.id);
    await check(client, cow.id, { result: 'pregnant' });
    assert.deepEqual(await state(), ['pregnant', '2026-10-20']);
  });

  test('a positive check fills an empty expected date from her current breeding', async () => {
    await breed(client, cow.id);
    await setCow(client, cow, { expectedCalvingDate: '' });
    await check(client, cow.id, { result: 'pregnant' });
    assert.deepEqual(await state(), ['pregnant', '2026-10-20']);
  });

  test('a positive check keeps an expected date typed by hand', async () => {
    await breed(client, cow.id);
    await setCow(client, cow, { expectedCalvingDate: '2026-10-25' });
    await check(client, cow.id);
    assert.deepEqual(await state(), ['pregnant', '2026-10-25']);
  });

  test('a positive check with no breeding on record marks her Pregnant without a date', async () => {
    await check(client, cow.id);
    assert.deepEqual(await state(), ['pregnant', '']);
  });

  test('a positive check leaves Under Treatment and In Quarantine alone', async () => {
    await breed(client, cow.id);
    for (const status of ['under_treatment', 'quarantine']) {
      await setCow(client, cow, { healthStatus: status, expectedCalvingDate: '2026-10-20' });
      await check(client, cow.id);
      assert.deepEqual(await state(), [status, '2026-10-20']);
    }
  });

  test('an open check clears the expected date and Pregnant', async () => {
    await breed(client, cow.id);
    await check(client, cow.id, { checkDate: '2026-02-01', result: 'pregnant' });
    await check(client, cow.id, { checkDate: '2026-03-01', result: 'open' });
    assert.deepEqual(await state(), ['healthy', '']);
  });

  test('an open check clears a typed date too, and leaves other statuses alone', async () => {
    await breed(client, cow.id);
    await setCow(client, cow, { healthStatus: 'quarantine', expectedCalvingDate: '2026-10-25' });
    await check(client, cow.id, { result: 'open' });
    assert.deepEqual(await state(), ['quarantine', '']);
  });

  test('an unsure check changes nothing', async () => {
    await breed(client, cow.id);
    await check(client, cow.id, { result: 'unsure' });
    assert.deepEqual(await state(), ['healthy', '2026-10-20']);
  });

  test('an older check does not override the newest one', async () => {
    await breed(client, cow.id);
    await check(client, cow.id, { checkDate: '2026-03-01', result: 'pregnant' });
    await check(client, cow.id, { checkDate: '2026-02-15', result: 'open' });
    assert.deepEqual(await state(), ['pregnant', '2026-10-20']);
  });

  test('a check from before her current breeding changes nothing', async () => {
    await breed(client, cow.id, { breedingDate: '2026-03-01' });
    await check(client, cow.id, { checkDate: '2026-02-01', result: 'open' });
    assert.deepEqual(await state(), ['healthy', '2026-12-09']);
  });

  test('a check from before her last calving changes nothing', async () => {
    await client.post(`/api/cattle/${cow.id}/calvings`).send({ calvingDate: '2026-03-01' }).expect(201);
    await check(client, cow.id, { checkDate: '2025-08-01', result: 'pregnant' });
    assert.deepEqual(await state(), ['healthy', '']);
  });

  test('editing the newest check to open applies the new result', async () => {
    await breed(client, cow.id);
    const c = await check(client, cow.id);
    await client.put(`/api/pregnancy-checks/${c.id}`).send({ ...FULL, result: 'open' }).expect(200);
    assert.deepEqual(await state(), ['healthy', '']);
    await client.put(`/api/pregnancy-checks/${c.id}`).send({ ...FULL, result: 'pregnant' }).expect(200);
    assert.deepEqual(await state(), ['pregnant', '2026-10-20']);
  });

  test('deleting an open check brings back the date from her breeding, but not the status', async () => {
    await breed(client, cow.id);
    await check(client, cow.id, { checkDate: '2026-02-01' });
    const open = await check(client, cow.id, { checkDate: '2026-03-01', result: 'open' });
    await client.delete(`/api/pregnancy-checks/${open.id}`).expect(200);
    assert.deepEqual(await state(), ['healthy', '2026-10-20']);
  });

  test('deleting a positive check leaves the status as it is', async () => {
    await breed(client, cow.id);
    const c = await check(client, cow.id);
    await client.delete(`/api/pregnancy-checks/${c.id}`).expect(200);
    assert.deepEqual(await state(), ['pregnant', '2026-10-20']);
  });

  test('after an open check, deleting or editing the breeding keeps the date empty', async () => {
    const b = await breed(client, cow.id);
    await check(client, cow.id, { result: 'open' });
    await client.put(`/api/breedings/${b.id}`).send({ breedingDate: '2026-01-05' }).expect(200);
    assert.deepEqual(await state(), ['healthy', '']);
    await client.delete(`/api/breedings/${b.id}`).expect(200);
    assert.deepEqual(await state(), ['healthy', '']);
  });

  test('a new breeding after an open check sets the date again', async () => {
    await breed(client, cow.id);
    await check(client, cow.id, { result: 'open' });
    await breed(client, cow.id, { breedingDate: '2026-03-01' });
    assert.deepEqual(await state(), ['healthy', '2026-12-09']);
  });

  test("only that cow's record changes", async () => {
    const other = await addCow(client, { tagNumber: 'COW-2', healthStatus: 'healthy', expectedCalvingDate: '2026-12-01' });
    await breed(client, cow.id);
    await check(client, cow.id);
    const after = await cowById(client, other.id);
    assert.deepEqual([after.healthStatus, after.expectedCalvingDate], ['healthy', '2026-12-01']);
  });
});

describe('owner isolation', () => {
  let alice;
  let bob;
  let bobsCow;
  let bobsBreeding;
  let bobsCheck;

  beforeEach(async () => {
    alice = await signedIn('alice@example.com');
    bob = await signedIn('bob@example.com');
    bobsCow = await addCow(bob, { tagNumber: 'BOB-1' });
    bobsBreeding = await breed(bob, bobsCow.id);
    bobsCheck = await check(bob, bobsCow.id, { breedingId: bobsBreeding.id });
  });

  const bobsData = async () => ({
    checks: (await bob.get('/api/pregnancy-checks').expect(200)).body,
    breedings: (await bob.get('/api/breedings').expect(200)).body,
    herd: await herd(bob),
  });

  for (const [who, options] of [['another user', {}], ['an admin', { role: 'admin' }]]) {
    test(`${who} cannot list, read, add, change or delete someone else's checks`, async () => {
      const other = who === 'an admin' ? await signedIn('admin@example.com', options) : alice;
      const before = await bobsData();

      assert.deepEqual((await other.get('/api/pregnancy-checks').expect(200)).body, []);
      assert.equal((await other.get(`/api/cattle/${bobsCow.id}/pregnancy-checks`).expect(404)).body.error, 'Cattle not found');
      const post = await other.post(`/api/cattle/${bobsCow.id}/pregnancy-checks`).send({ ...FULL, result: 'open' }).expect(404);
      assert.equal(post.body.error, 'Cattle not found');
      const put = await other.put(`/api/pregnancy-checks/${bobsCheck.id}`).send({ ...FULL, result: 'open' }).expect(404);
      assert.equal(put.body.error, 'Pregnancy check not found');
      assert.equal((await other.delete(`/api/pregnancy-checks/${bobsCheck.id}`).expect(404)).body.error, 'Pregnancy check not found');

      // Nor can they link their own check to his breeding.
      const own = await addCow(other, { tagNumber: 'OWN' });
      const link = await other.post(`/api/cattle/${own.id}/pregnancy-checks`).send({ ...FULL, breedingId: bobsBreeding.id }).expect(400);
      assert.equal(link.body.error, 'Unknown breeding record');

      assert.deepEqual(await bobsData(), before);
      assert.deepEqual(before.checks, [bobsCheck]);
      assert.equal(before.herd[0].healthStatus, 'pregnant');
      assert.equal(await checkCount(), 1);
    });
  }

  test('a client cannot choose the owner or move a check to another cow', async () => {
    const alicesCow = await addCow(alice, { tagNumber: 'ALICE-1' });
    const created = await alice
      .post(`/api/cattle/${alicesCow.id}/pregnancy-checks`)
      .send({ ...FULL, ownerId: bob.user.id, owner_id: bob.user.id, cattleId: bobsCow.id, cattle_id: bobsCow.id })
      .expect(201);
    const { rows } = await pool.query('SELECT owner_id, cattle_id FROM pregnancy_checks WHERE id = $1', [created.body.id]);
    assert.deepEqual(rows, [{ owner_id: alice.user.id, cattle_id: alicesCow.id }]);
    await alice.put(`/api/pregnancy-checks/${created.body.id}`).send({ ...FULL, cattleId: bobsCow.id }).expect(200);
    assert.deepEqual((await bob.get('/api/pregnancy-checks')).body, [bobsCheck]);
  });

  test('after signing out, a session no longer reaches its own checks', async () => {
    await bob.post('/api/auth/logout').expect(200);
    await bob.get('/api/pregnancy-checks').expect(401);
    await bob.get(`/api/cattle/${bobsCow.id}/pregnancy-checks`).expect(401);
    await bob.delete(`/api/pregnancy-checks/${bobsCheck.id}`).expect(401);
    assert.equal(await checkCount(), 1);
  });
});
