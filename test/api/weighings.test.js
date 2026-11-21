const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool, agent, signedIn, useDatabase, prepareDatabase } = require('../helpers/api');

useDatabase();

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const addCow = async (client, fields = {}) =>
  (await client.post('/api/cattle').send({ tagNumber: 'COW-1', ...fields }).expect(201)).body;
const weigh = async (client, cowId, fields = {}) =>
  (await client.post(`/api/cattle/${cowId}/weighings`).send({ date: '2026-03-10', weight: 1000, ...fields }).expect(201)).body;
const herd = async (client) => (await client.get('/api/cattle').expect(200)).body;
const cowById = async (client, id) => (await herd(client)).find((c) => c.id === id);
const weighingCount = async () => (await pool.query('SELECT count(*)::int AS n FROM weighings')).rows[0].n;
const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

describe('authentication', () => {
  for (const [method, path] of [
    ['get', '/api/weighings'],
    ['post', '/api/weighings/batch'],
    ['get', `/api/cattle/${UNKNOWN_ID}/weighings`],
    ['post', `/api/cattle/${UNKNOWN_ID}/weighings`],
    ['put', `/api/weighings/${UNKNOWN_ID}`],
    ['delete', `/api/weighings/${UNKNOWN_ID}`],
  ]) {
    test(`${method.toUpperCase()} ${path} needs a session`, async () => {
      const res = await request(app)[method](path).send({ date: '2026-03-10', weight: 900, rows: [] }).expect(401);
      assert.equal(res.body.error, 'Authentication required');
    });
  }
});

describe('create and read', () => {
  test('records a weighing and returns it with the animal it belongs to', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { nameBreed: 'Daisy Holstein' });
    const res = await client
      .post(`/api/cattle/${cow.id}/weighings`)
      .send({ date: '2026-03-10', weight: 1234.5, notes: 'Spring weigh-in' })
      .expect(201);
    const { id, createdAt, ...rest } = res.body;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.ok(createdAt);
    assert.deepEqual(rest, {
      cattleId: cow.id, cattleTag: 'COW-1', cattleName: 'Daisy Holstein', date: '2026-03-10', weight: 1234.5, notes: 'Spring weigh-in',
    });
    const list = await client.get(`/api/cattle/${cow.id}/weighings`).expect(200);
    assert.deepEqual(list.body, [res.body]);
  });

  test('notes are optional and come back as ""; a numeric string weight is accepted', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const w = await weigh(client, cow.id, { weight: '987.25', notes: '' });
    assert.equal(w.weight, 987.25);
    assert.equal(w.notes, '');
  });

  test('a new account has no weighings', async () => {
    const client = await signedIn('a@example.com');
    assert.deepEqual((await client.get('/api/weighings').expect(200)).body, []);
  });

  test('lists newest first, per animal and for the whole herd; same date by time recorded', async () => {
    const client = await signedIn('a@example.com');
    const a = await addCow(client, { tagNumber: 'A' });
    const b = await addCow(client, { tagNumber: 'B' });
    await weigh(client, a.id, { date: '2026-01-10', weight: 800 });
    await weigh(client, b.id, { date: '2026-03-01', weight: 900 });
    await weigh(client, a.id, { date: '2026-02-10', weight: 850 });
    await weigh(client, a.id, { date: '2026-02-10', weight: 855 });
    const all = (await client.get('/api/weighings')).body;
    assert.deepEqual(all.map((w) => [w.cattleTag, w.date, w.weight]), [
      ['B', '2026-03-01', 900], ['A', '2026-02-10', 855], ['A', '2026-02-10', 850], ['A', '2026-01-10', 800],
    ]);
    const mine = (await client.get(`/api/cattle/${a.id}/weighings`)).body;
    assert.deepEqual(mine.map((w) => w.weight), [855, 850, 800]);
  });

  test('returns 404 for an animal that does not exist and 400 for a malformed id', async () => {
    const client = await signedIn('a@example.com');
    const get = await client.get(`/api/cattle/${UNKNOWN_ID}/weighings`).expect(404);
    assert.equal(get.body.error, 'Cattle not found');
    const post = await client.post(`/api/cattle/${UNKNOWN_ID}/weighings`).send({ date: '2026-03-10', weight: 900 }).expect(404);
    assert.equal(post.body.error, 'Cattle not found');
    const bad = await client.get('/api/cattle/not-a-uuid/weighings').expect(400);
    assert.equal(bad.body.error, 'Invalid cattle id');
  });

  test('any animal can be weighed, male or female', async () => {
    const client = await signedIn('a@example.com');
    const bull = await addCow(client, { gender: 'male' });
    await weigh(client, bull.id, { weight: 2100 });
    assert.equal((await cowById(client, bull.id)).weight, 2100);
  });
});

describe('validation', () => {
  const invalid = [
    ['a missing date', { date: undefined }, 'Enter a valid weighing date'],
    ['a date that is not a date', { date: 'yesterday' }, 'Enter a valid weighing date'],
    ['an impossible date', { date: '2026-02-30' }, 'Enter a valid weighing date'],
    ['a date in the future', { date: isoDay(3) }, 'The weighing date cannot be in the future'],
    ['a missing weight', { weight: undefined }, 'Invalid weight'],
    ['an empty weight', { weight: '' }, 'Invalid weight'],
    ['a null weight', { weight: null }, 'Invalid weight'],
    ['a weight of 0', { weight: 0 }, 'Invalid weight'],
    ['a weight of "0"', { weight: '0' }, 'Invalid weight'],
    ['a weight that rounds to 0', { weight: 0.004 }, 'Invalid weight'],
    ['a negative weight', { weight: -5 }, 'Invalid weight'],
    ['a weight over 5000', { weight: 5000.01 }, 'Invalid weight'],
    ['a weight that is not a number', { weight: 'heavy' }, 'Invalid weight'],
    ['a boolean weight', { weight: true }, 'Invalid weight'],
    ['notes over 2000 characters', { notes: 'n'.repeat(2001) }, 'Notes are too long'],
  ];

  for (const [name, fields, message] of invalid) {
    test(`rejects ${name} on create and on update`, async () => {
      const client = await signedIn('a@example.com');
      const cow = await addCow(client);
      const body = { date: '2026-03-10', weight: 900, ...fields };
      const res = await client.post(`/api/cattle/${cow.id}/weighings`).send(body).expect(400);
      assert.equal(res.body.error, message);

      const existing = await weigh(client, cow.id, { weight: 950 });
      const put = await client.put(`/api/weighings/${existing.id}`).send(body).expect(400);
      assert.equal(put.body.error, message);
      assert.deepEqual((await client.get(`/api/cattle/${cow.id}/weighings`)).body, [existing]);
      assert.equal((await cowById(client, cow.id)).weight, 950);
    });
  }

  test('accepts the limits: 0.01, 5000, today, and 2000-character notes', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    await weigh(client, cow.id, { weight: 0.01 });
    await weigh(client, cow.id, { weight: 5000, date: isoDay(0), notes: 'n'.repeat(2000) });
    assert.equal((await cowById(client, cow.id)).weight, 5000);
  });

  test('rejects a malformed weighing id', async () => {
    const client = await signedIn('a@example.com');
    const res = await client.delete('/api/weighings/42').expect(400);
    assert.equal(res.body.error, 'Invalid weighing id');
    await client.put('/api/weighings/42').send({ date: '2026-03-10', weight: 900 }).expect(400);
  });

  test('stores text exactly as typed, including markup', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const notes = '<img src=x onerror="alert(1)"> & "quotes"';
    const w = await weigh(client, cow.id, { notes });
    assert.equal(w.notes, notes);
    assert.equal((await client.get('/api/weighings')).body[0].notes, notes);
  });
});

describe('update and delete', () => {
  test('update replaces date, weight and notes and keeps the animal', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const w = await weigh(client, cow.id, { notes: 'first' });
    const res = await client.put(`/api/weighings/${w.id}`).send({ date: '2026-04-01', weight: 1010.5 }).expect(200);
    assert.equal(res.body.id, w.id);
    assert.equal(res.body.cattleId, cow.id);
    assert.equal(res.body.date, '2026-04-01');
    assert.equal(res.body.weight, 1010.5);
    assert.equal(res.body.notes, '', 'fields left out are cleared');
  });

  test('delete removes the weighing', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const w = await weigh(client, cow.id);
    assert.deepEqual(await client.delete(`/api/weighings/${w.id}`).expect(200).then((r) => r.body), { ok: true });
    assert.deepEqual((await client.get('/api/weighings')).body, []);
  });

  test('unknown ids return 404', async () => {
    const client = await signedIn('a@example.com');
    const put = await client.put(`/api/weighings/${UNKNOWN_ID}`).send({ date: '2026-03-10', weight: 900 }).expect(404);
    assert.equal(put.body.error, 'Weighing not found');
    const del = await client.delete(`/api/weighings/${UNKNOWN_ID}`).expect(404);
    assert.equal(del.body.error, 'Weighing not found');
  });
});

describe('the animal weight follows the weighings', () => {
  let client;
  let cow;
  beforeEach(async () => {
    client = await signedIn('a@example.com');
    cow = await addCow(client);
  });

  test('is the newest weighing by date, whatever order they are recorded in', async () => {
    await weigh(client, cow.id, { date: '2026-03-01', weight: 1100 });
    assert.equal((await cowById(client, cow.id)).weight, 1100);
    await weigh(client, cow.id, { date: '2026-01-01', weight: 1000 });
    assert.equal((await cowById(client, cow.id)).weight, 1100, 'an older weighing does not replace it');
    await weigh(client, cow.id, { date: '2026-03-01', weight: 1105 });
    assert.equal((await cowById(client, cow.id)).weight, 1105, 'on the same date, the one recorded last wins');
  });

  test('moves when a weighing is edited', async () => {
    const older = await weigh(client, cow.id, { date: '2026-01-01', weight: 1000 });
    const newer = await weigh(client, cow.id, { date: '2026-02-01', weight: 1050 });
    await client.put(`/api/weighings/${newer.id}`).send({ date: '2026-02-01', weight: 1060 }).expect(200);
    assert.equal((await cowById(client, cow.id)).weight, 1060);
    await client.put(`/api/weighings/${older.id}`).send({ date: '2026-03-01', weight: 1070 }).expect(200);
    assert.equal((await cowById(client, cow.id)).weight, 1070, 'an edit that makes it the newest takes over');
  });

  test('falls back to the previous weighing on delete, and clears with the last one', async () => {
    const older = await weigh(client, cow.id, { date: '2026-01-01', weight: 1000 });
    const newer = await weigh(client, cow.id, { date: '2026-02-01', weight: 1050 });
    await client.delete(`/api/weighings/${newer.id}`).expect(200);
    assert.equal((await cowById(client, cow.id)).weight, 1000);
    await client.delete(`/api/weighings/${older.id}`).expect(200);
    assert.equal((await cowById(client, cow.id)).weight, null);
  });

  test('a failed create or update leaves it alone', async () => {
    const w = await weigh(client, cow.id, { weight: 1000 });
    await client.post(`/api/cattle/${cow.id}/weighings`).send({ date: '2026-04-01', weight: 0 }).expect(400);
    await client.put(`/api/weighings/${w.id}`).send({ date: '2026-04-01', weight: 6000 }).expect(400);
    assert.equal((await cowById(client, cow.id)).weight, 1000);
  });

  test("only that animal's weight changes", async () => {
    const other = await addCow(client, { tagNumber: 'COW-2', weight: 700 });
    await weigh(client, cow.id, { date: isoDay(0), weight: 1200 });
    assert.equal((await cowById(client, other.id)).weight, 700);
  });
});

describe('weight on the cattle record', () => {
  test('a weight given with a new animal becomes its first weighing, dated weightDate', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { weight: 640.5, weightDate: '2026-05-02' });
    assert.equal(cow.weight, 640.5);
    const list = (await client.get(`/api/cattle/${cow.id}/weighings`)).body;
    assert.deepEqual(list.map((w) => [w.date, w.weight, w.notes]), [['2026-05-02', 640.5, '']]);
  });

  test('without weightDate the first weighing is dated today; no weight means no weighing', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { weight: 640 });
    const [w] = (await client.get(`/api/cattle/${cow.id}/weighings`)).body;
    assert.ok([isoDay(-1), isoDay(0), isoDay(1)].includes(w.date), w.date);
    await addCow(client, { tagNumber: 'COW-2', weight: '' });
    assert.equal(await weighingCount(), 1);
  });

  test('editing the animal with a different weight records a new weighing and updates it', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { weight: 900, weightDate: '2026-01-01' });
    const res = await client
      .put(`/api/cattle/${cow.id}`)
      .send({ tagNumber: 'COW-1', nameBreed: 'Renamed', weight: 950, weightDate: '2026-02-01' })
      .expect(200);
    assert.equal(res.body.weight, 950);
    assert.equal(res.body.nameBreed, 'Renamed');
    const list = (await client.get(`/api/cattle/${cow.id}/weighings`)).body;
    assert.deepEqual(list.map((w) => [w.date, w.weight]), [['2026-02-01', 950], ['2026-01-01', 900]]);
  });

  test('editing with the same weight, a blank weight or none records nothing and keeps it', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { weight: 900.5 });
    for (const extra of [{ weight: 900.5 }, { weight: '900.50' }, { weight: '' }, { weight: null }, {}]) {
      const res = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'COW-1', ...extra }).expect(200);
      assert.equal(res.body.weight, 900.5, JSON.stringify(extra));
    }
    assert.equal(await weighingCount(), 1);
  });

  test('editing with an older weightDate records it but keeps the newer weighing as the weight', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { weight: 900, weightDate: '2026-03-01' });
    const res = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'COW-1', weight: 850, weightDate: '2026-01-01' }).expect(200);
    assert.equal(res.body.weight, 900);
    assert.equal(await weighingCount(), 2);
  });

  test('weightDate is checked: not a date, impossible, or in the future', async () => {
    const client = await signedIn('a@example.com');
    for (const [weightDate, message] of [
      ['soon', 'Enter a valid weighing date'],
      ['2026-02-30', 'Enter a valid weighing date'],
      [isoDay(3), 'The weighing date cannot be in the future'],
    ]) {
      const res = await client.post('/api/cattle').send({ tagNumber: 'COW-1', weight: 900, weightDate }).expect(400);
      assert.equal(res.body.error, message);
    }
    assert.equal(await weighingCount(), 0);
  });

  test("editing another user's animal records no weighing", async () => {
    const alice = await signedIn('alice@example.com');
    const bob = await signedIn('bob@example.com');
    const bobs = await addCow(bob, { weight: 900 });
    await alice.put(`/api/cattle/${bobs.id}`).send({ tagNumber: 'X', weight: 10 }).expect(404);
    assert.equal(await weighingCount(), 1);
    assert.equal((await cowById(bob, bobs.id)).weight, 900);
  });

  test("a calf added with a calving gets its birth weight as a weighing on the calving date", async () => {
    const client = await signedIn('a@example.com');
    const dam = await addCow(client, { gender: 'female' });
    const res = await client
      .post(`/api/cattle/${dam.id}/calvings`)
      .send({ calvingDate: '2026-03-10', calfTag: 'CALF-1', calfSex: 'female', birthWeight: 82.5, addCalf: true })
      .expect(201);
    const list = (await client.get(`/api/cattle/${res.body.calf.id}/weighings`)).body;
    assert.deepEqual(list.map((w) => [w.date, w.weight]), [['2026-03-10', 82.5]]);
    assert.equal(res.body.calf.weight, 82.5);
  });
});

describe('batch entry', () => {
  let client;
  let a;
  let b;
  let c;
  beforeEach(async () => {
    client = await signedIn('a@example.com');
    a = await addCow(client, { tagNumber: 'A', weight: 800, weightDate: '2026-01-01' });
    b = await addCow(client, { tagNumber: 'B' });
    c = await addCow(client, { tagNumber: 'C', weight: 1000, weightDate: '2026-01-01' });
  });

  test('saves every row on the one date and updates each weight', async () => {
    const res = await client
      .post('/api/weighings/batch')
      .send({ date: '2026-02-01', rows: [{ cattleId: a.id, weight: 830 }, { cattleId: b.id, weight: '612.5', notes: 'first' }] })
      .expect(200);
    assert.equal(res.body.date, '2026-02-01');
    assert.deepEqual(res.body.failed, []);
    assert.deepEqual(res.body.saved.map((s) => [s.index, s.weighing.cattleTag, s.weighing.date, s.weighing.weight, s.weighing.notes]), [
      [0, 'A', '2026-02-01', 830, ''], [1, 'B', '2026-02-01', 612.5, 'first'],
    ]);
    assert.equal((await cowById(client, a.id)).weight, 830);
    assert.equal((await cowById(client, b.id)).weight, 612.5);
    assert.equal((await cowById(client, c.id)).weight, 1000);
  });

  test('saves the valid rows and reports each failed row by position, with the reason', async () => {
    const bob = await signedIn('bob@example.com');
    const bobs = await addCow(bob, { tagNumber: 'BOB-1', weight: 700 });
    const rows = [
      { cattleId: a.id, weight: 840 },
      { cattleId: b.id, weight: 0 },
      { cattleId: '', weight: 900 },
      { cattleId: c.id, weight: 6000 },
      { cattleId: bobs.id, weight: 710 },
      { cattleId: UNKNOWN_ID, weight: 710 },
      { cattleId: a.id, weight: 845 },
      { cattleId: c.id, weight: -3 },
      { cattleId: b.id, weight: 615, notes: 'n'.repeat(2001) },
      'not a row',
      { cattleId: c.id, weight: 1020 },
    ];
    const res = await client.post('/api/weighings/batch').send({ date: '2026-02-01', rows }).expect(200);
    assert.deepEqual(res.body.saved.map((s) => [s.index, s.weighing.cattleTag, s.weighing.weight]), [[0, 'A', 840], [10, 'C', 1020]]);
    assert.deepEqual(res.body.failed.map((f) => [f.index, f.error]), [
      [1, 'Invalid weight'],
      [2, 'Choose an animal'],
      [3, 'Invalid weight'],
      [4, 'Animal not found'],
      [5, 'Animal not found'],
      [6, 'This animal is already in the batch'],
      [7, 'Invalid weight'],
      [8, 'Notes are too long'],
      [9, 'Invalid row'],
    ]);
    assert.equal(res.body.failed[3].cattleId, bobs.id);
    assert.equal((await cowById(client, a.id)).weight, 840);
    assert.equal((await cowById(client, b.id)).weight, null);
    assert.equal((await cowById(client, c.id)).weight, 1020);
    // Bob's animal is untouched and has only its own weighing.
    assert.equal((await cowById(bob, bobs.id)).weight, 700);
    assert.equal((await bob.get('/api/weighings')).body.length, 1);
  });

  test('when every row fails nothing is saved and the answer says why', async () => {
    const before = await weighingCount();
    const res = await client
      .post('/api/weighings/batch')
      .send({ date: '2026-02-01', rows: [{ cattleId: a.id, weight: 0 }, { cattleId: UNKNOWN_ID, weight: 800 }] })
      .expect(200);
    assert.deepEqual(res.body.saved, []);
    assert.deepEqual(res.body.failed.map((f) => f.error), ['Invalid weight', 'Animal not found']);
    assert.equal(await weighingCount(), before);
  });

  test('a bad date, or rows that are missing, empty or too many, refuse the whole request', async () => {
    const before = await weighingCount();
    const row = { cattleId: a.id, weight: 850 };
    for (const [body, message] of [
      [{ rows: [row] }, 'Enter a valid weighing date'],
      [{ date: '2026-02-30', rows: [row] }, 'Enter a valid weighing date'],
      [{ date: isoDay(3), rows: [row] }, 'The weighing date cannot be in the future'],
      [{ date: '2026-02-01' }, 'Send 1 to 500 rows'],
      [{ date: '2026-02-01', rows: [] }, 'Send 1 to 500 rows'],
      [{ date: '2026-02-01', rows: row }, 'Send 1 to 500 rows'],
      [{ date: '2026-02-01', rows: Array(501).fill(row) }, 'Send 1 to 500 rows'],
    ]) {
      const res = await client.post('/api/weighings/batch').send(body).expect(400);
      assert.equal(res.body.error, message, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(await weighingCount(), before);
  });

  test('a batch dated before the newest weighing records history without changing the weight', async () => {
    await client.post('/api/weighings/batch').send({ date: '2025-12-01', rows: [{ cattleId: a.id, weight: 760 }] }).expect(200);
    assert.equal((await cowById(client, a.id)).weight, 800);
    assert.deepEqual((await client.get(`/api/cattle/${a.id}/weighings`)).body.map((w) => w.weight), [800, 760]);
  });
});

describe('deleting animals', () => {
  test("deleting an animal deletes its weighings and nobody else's", async () => {
    const client = await signedIn('a@example.com');
    const daisy = await addCow(client, { tagNumber: 'DAISY' });
    const bess = await addCow(client, { tagNumber: 'BESS' });
    await weigh(client, daisy.id, { date: '2026-01-01' });
    await weigh(client, daisy.id, { date: '2026-02-01' });
    const kept = await weigh(client, bess.id);
    await client.delete(`/api/cattle/${daisy.id}`).expect(200);
    assert.deepEqual((await client.get('/api/weighings')).body.map((w) => w.id), [kept.id]);
    assert.equal(await weighingCount(), 1);
    await client.get(`/api/cattle/${daisy.id}/weighings`).expect(404);
  });

  test('deleting a user deletes their weighings', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { weight: 700 });
    await weigh(client, cow.id);
    await pool.query('DELETE FROM users WHERE id = $1', [client.user.id]);
    assert.equal(await weighingCount(), 0);
  });
});

describe('owner isolation', () => {
  let alice;
  let bob;
  let bobsCow;
  let bobsWeighing;

  beforeEach(async () => {
    alice = await signedIn('alice@example.com');
    bob = await signedIn('bob@example.com');
    bobsCow = await addCow(bob, { tagNumber: 'BOB-1' });
    bobsWeighing = await weigh(bob, bobsCow.id, { weight: 1111, notes: 'bob' });
  });

  const bobsData = async () => ({
    weighings: (await bob.get('/api/weighings').expect(200)).body,
    herd: await herd(bob),
  });

  for (const [who, options] of [['another user', {}], ['an admin', { role: 'admin' }]]) {
    test(`${who} cannot list, read, add, batch, change or delete someone else's weighings`, async () => {
      const other = who === 'an admin' ? await signedIn('admin@example.com', options) : alice;
      const before = await bobsData();

      assert.deepEqual((await other.get('/api/weighings').expect(200)).body, []);
      const list = await other.get(`/api/cattle/${bobsCow.id}/weighings`).expect(404);
      assert.equal(list.body.error, 'Cattle not found');
      const post = await other.post(`/api/cattle/${bobsCow.id}/weighings`).send({ date: '2026-04-01', weight: 5 }).expect(404);
      assert.equal(post.body.error, 'Cattle not found');
      const batch = await other
        .post('/api/weighings/batch')
        .send({ date: '2026-04-01', rows: [{ cattleId: bobsCow.id, weight: 5 }] })
        .expect(200);
      assert.deepEqual(batch.body.saved, []);
      assert.deepEqual(batch.body.failed, [{ index: 0, cattleId: bobsCow.id, error: 'Animal not found' }]);
      const put = await other.put(`/api/weighings/${bobsWeighing.id}`).send({ date: '2020-01-01', weight: 5 }).expect(404);
      assert.equal(put.body.error, 'Weighing not found');
      const del = await other.delete(`/api/weighings/${bobsWeighing.id}`).expect(404);
      assert.equal(del.body.error, 'Weighing not found');

      assert.deepEqual(await bobsData(), before);
      assert.deepEqual(before.weighings, [bobsWeighing]);
      assert.equal(before.herd[0].weight, 1111);
      assert.equal(await weighingCount(), 1);
    });
  }

  test('a client cannot choose the owner or move a weighing to another animal', async () => {
    const alicesCow = await addCow(alice, { tagNumber: 'ALICE-1' });
    const created = await alice
      .post(`/api/cattle/${alicesCow.id}/weighings`)
      .send({ date: '2026-03-10', weight: 900, ownerId: bob.user.id, owner_id: bob.user.id, cattleId: bobsCow.id, cattle_id: bobsCow.id })
      .expect(201);
    assert.equal(created.body.cattleId, alicesCow.id);
    const { rows } = await pool.query('SELECT owner_id, cattle_id FROM weighings WHERE id = $1', [created.body.id]);
    assert.deepEqual(rows, [{ owner_id: alice.user.id, cattle_id: alicesCow.id }]);

    await alice.put(`/api/weighings/${created.body.id}`).send({ date: '2026-03-10', weight: 950, cattleId: bobsCow.id }).expect(200);
    assert.deepEqual((await bob.get('/api/weighings')).body, [bobsWeighing]);
    assert.equal((await cowById(bob, bobsCow.id)).weight, 1111);
  });

  test('each user sees only their own weighings in the herd-wide list', async () => {
    const alicesCow = await addCow(alice, { tagNumber: 'ALICE-1' });
    const alices = await weigh(alice, alicesCow.id);
    assert.deepEqual((await alice.get('/api/weighings')).body.map((w) => w.id), [alices.id]);
    assert.deepEqual((await bob.get('/api/weighings')).body.map((w) => w.id), [bobsWeighing.id]);
  });

  test('after signing out, a session no longer reaches its own weighings', async () => {
    await bob.post('/api/auth/logout').expect(200);
    await bob.get('/api/weighings').expect(401);
    await bob.get(`/api/cattle/${bobsCow.id}/weighings`).expect(401);
    await bob.post('/api/weighings/batch').send({ date: '2026-03-10', rows: [{ cattleId: bobsCow.id, weight: 5 }] }).expect(401);
    await bob.delete(`/api/weighings/${bobsWeighing.id}`).expect(401);
    assert.equal(await weighingCount(), 1);
  });
});

describe('demo herd', () => {
  test('comes with weight history whose newest weighing is each animal\'s weight', async (t) => {
    process.env.DEMO_MODE = 'true';
    t.after(() => delete process.env.DEMO_MODE);
    const demo = agent();
    await demo.post('/api/auth/demo').expect(201);

    const weighings = (await demo.get('/api/weighings').expect(200)).body;
    const cattle = await herd(demo);
    for (const cow of cattle) {
      const own = weighings.filter((w) => w.cattleId === cow.id);
      assert.ok(own.length >= 3, `${cow.tagNumber} has a few weighings, so daily gain can be shown`);
      assert.equal(cow.weight, own[0].weight, cow.tagNumber);
      assert.ok(own.every((w) => w.date <= isoDay(0)), 'no weighing is in the future');
    }
  });
});

describe('migration of existing weights', () => {
  // Rows as they were before weighings existed: a weight on the animal and no weighing.
  async function legacyCow(ownerId, tag, weight, updatedAt = '2025-06-15 12:00:00+00') {
    const { rows } = await pool.query(
      'INSERT INTO cattle (owner_id, tag_number, weight, updated_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [ownerId, tag, weight, updatedAt]
    );
    return rows[0].id;
  }
  const NOTE = 'Imported from the weight on the animal record.';

  test('creates one weighing per animal with a weight, dated at its last update, once', async () => {
    const client = await signedIn('a@example.com');
    const other = await signedIn('b@example.com');
    const daisy = await legacyCow(client.user.id, 'DAISY', 1200);
    await legacyCow(client.user.id, 'NONE', null);
    const theirs = await legacyCow(other.user.id, 'THEIRS', 850.5, '2024-02-02 12:00:00+00');
    const current = await addCow(client, { tagNumber: 'CURRENT', weight: 900, weightDate: '2026-01-01' });
    await weigh(client, current.id, { date: '2026-03-01', weight: 950 });

    await prepareDatabase();
    await prepareDatabase();

    const { rows } = await pool.query(
      `SELECT cattle_id, owner_id, date, weight, notes FROM weighings WHERE cattle_id = ANY($1) ORDER BY date`,
      [[daisy, theirs]]
    );
    assert.deepEqual(rows, [
      { cattle_id: theirs, owner_id: other.user.id, date: '2024-02-02', weight: '850.50', notes: NOTE },
      { cattle_id: daisy, owner_id: client.user.id, date: '2025-06-15', weight: '1200.00', notes: NOTE },
    ]);
    assert.equal(await weighingCount(), 4, 'animals that already have weighings get no extra one');
    assert.equal((await cowById(client, daisy)).weight, 1200);
    assert.equal((await cowById(client, current.id)).weight, 950);
  });

  test('a weight of 0 saved before the fix is cleared, not imported', async () => {
    const client = await signedIn('a@example.com');
    const zero = await legacyCow(client.user.id, 'ZERO', 0);
    await prepareDatabase();
    assert.equal((await cowById(client, zero)).weight, null);
    assert.equal(await weighingCount(), 0);
  });

  test('does not bring back a weighing the user deleted', async () => {
    const client = await signedIn('a@example.com');
    const daisy = await legacyCow(client.user.id, 'DAISY', 1200);
    await prepareDatabase();
    const [w] = (await client.get(`/api/cattle/${daisy}/weighings`)).body;
    await client.delete(`/api/weighings/${w.id}`).expect(200);

    await prepareDatabase();
    assert.equal(await weighingCount(), 0);
    assert.equal((await cowById(client, daisy)).weight, null);
  });
});
