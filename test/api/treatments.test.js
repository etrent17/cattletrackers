const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool, agent, signedIn, useDatabase } = require('../helpers/api');

useDatabase();

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const FULL = {
  dateGiven: '2026-03-10',
  type: 'vaccination',
  product: 'Bovi-Shield Gold 5',
  dose: '2 mL',
  route: 'Subcutaneous',
  givenBy: 'Dr. Patel',
  nextDueDate: '2027-03-10',
  withdrawalUntil: '2026-03-31',
  notes: 'Annual booster.',
};

const addCow = async (client, fields = {}) =>
  (await client.post('/api/cattle').send({ tagNumber: 'COW-1', gender: 'female', ...fields }).expect(201)).body;
const record = async (client, cowId, fields = {}) =>
  (await client.post(`/api/cattle/${cowId}/treatments`).send({ dateGiven: '2026-03-10', type: 'treatment', ...fields }).expect(201)).body;
const herd = async (client) => (await client.get('/api/cattle').expect(200)).body;
const cowById = async (client, id) => (await herd(client)).find((c) => c.id === id);
const due = async (client, query = '') => (await client.get(`/api/treatments/due${query}`).expect(200)).body;
const count = async () => (await pool.query('SELECT count(*)::int AS n FROM treatments')).rows[0].n;
const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

describe('authentication', () => {
  for (const [method, path] of [
    ['get', '/api/treatments'],
    ['get', '/api/treatments/due'],
    ['get', `/api/cattle/${UNKNOWN_ID}/treatments`],
    ['post', `/api/cattle/${UNKNOWN_ID}/treatments`],
    ['put', `/api/treatments/${UNKNOWN_ID}`],
    ['delete', `/api/treatments/${UNKNOWN_ID}`],
  ]) {
    test(`${method.toUpperCase()} ${path} needs a session`, async () => {
      const res = await request(app)[method](path).send(FULL).expect(401);
      assert.equal(res.body.error, 'Authentication required');
    });
  }
});

describe('create and read', () => {
  test('records a treatment with every field and returns it with the animal it belongs to', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { nameBreed: 'Daisy Holstein' });
    const res = await client.post(`/api/cattle/${cow.id}/treatments`).send(FULL).expect(201);
    assert.match(res.body.id, /^[0-9a-f-]{36}$/);
    assert.ok(res.body.createdAt);
    const { id, createdAt, ...rest } = res.body;
    assert.deepEqual(rest, { ...FULL, cattleId: cow.id, cattleTag: 'COW-1', cattleName: 'Daisy Holstein' });

    assert.deepEqual((await client.get(`/api/cattle/${cow.id}/treatments`).expect(200)).body, [res.body]);
    assert.deepEqual((await client.get('/api/treatments').expect(200)).body, [res.body]);
  });

  test('needs only a date and a type; the other fields come back empty', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const t = await record(client, cow.id, { type: 'vet_visit' });
    assert.equal(t.dateGiven, '2026-03-10');
    assert.equal(t.type, 'vet_visit');
    for (const field of ['product', 'dose', 'route', 'givenBy', 'nextDueDate', 'withdrawalUntil', 'notes']) {
      assert.equal(t[field], '', field);
    }
  });

  test('accepts every type', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    for (const type of ['treatment', 'vaccination', 'vet_visit', 'other']) {
      assert.equal((await record(client, cow.id, { type })).type, type);
    }
  });

  test('trims text and stores blank text as empty', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const t = await record(client, cow.id, { product: '  Meloxicam ', dose: '   ', givenBy: ' Sam ' });
    assert.equal(t.product, 'Meloxicam');
    assert.equal(t.dose, '');
    assert.equal(t.givenBy, 'Sam');
    const { rows } = await pool.query('SELECT dose FROM treatments WHERE id = $1', [t.id]);
    assert.equal(rows[0].dose, null);
  });

  test('works for males too', async () => {
    const client = await signedIn('a@example.com');
    const bull = await addCow(client, { gender: 'male' });
    await record(client, bull.id);
  });

  test('a new account has no treatments', async () => {
    const client = await signedIn('a@example.com');
    assert.deepEqual((await client.get('/api/treatments').expect(200)).body, []);
    assert.deepEqual(await due(client), []);
    const cow = await addCow(client);
    assert.deepEqual((await client.get(`/api/cattle/${cow.id}/treatments`).expect(200)).body, []);
  });

  test('lists newest first, per animal and for the whole herd', async () => {
    const client = await signedIn('a@example.com');
    const daisy = await addCow(client, { tagNumber: 'DAISY' });
    const bess = await addCow(client, { tagNumber: 'BESS' });
    await record(client, daisy.id, { dateGiven: '2024-04-01' });
    await record(client, bess.id, { dateGiven: '2025-05-01' });
    await record(client, daisy.id, { dateGiven: '2026-02-01' });

    const all = (await client.get('/api/treatments').expect(200)).body;
    assert.deepEqual(all.map((e) => [e.cattleTag, e.dateGiven]), [
      ['DAISY', '2026-02-01'], ['BESS', '2025-05-01'], ['DAISY', '2024-04-01'],
    ]);
    const daisys = (await client.get(`/api/cattle/${daisy.id}/treatments`).expect(200)).body;
    assert.deepEqual(daisys.map((e) => e.dateGiven), ['2026-02-01', '2024-04-01']);
  });

  test('returns 404 for an animal that does not exist and 400 for a malformed id', async () => {
    const client = await signedIn('a@example.com');
    for (const method of ['get', 'post']) {
      const res = await client[method](`/api/cattle/${UNKNOWN_ID}/treatments`).send(FULL).expect(404);
      assert.equal(res.body.error, 'Cattle not found');
      const bad = await client[method]('/api/cattle/42/treatments').send(FULL).expect(400);
      assert.equal(bad.body.error, 'Invalid cattle id');
    }
    assert.equal(await count(), 0);
  });
});

describe('validation', () => {
  let client;
  let cow;
  beforeEach(async () => {
    client = await signedIn('a@example.com');
    cow = await addCow(client);
  });

  for (const [name, fields, message] of [
    ['a missing date', { dateGiven: undefined }, 'Enter a valid treatment date'],
    ['an empty date', { dateGiven: '' }, 'Enter a valid treatment date'],
    ['text instead of a date', { dateGiven: 'last week' }, 'Enter a valid treatment date'],
    ['an impossible date', { dateGiven: '2026-02-30' }, 'Enter a valid treatment date'],
    ['a date in the future', { dateGiven: isoDay(3), nextDueDate: '', withdrawalUntil: '' }, 'The treatment date cannot be in the future'],
    ['a missing type', { type: undefined }, 'Choose a treatment type'],
    ['an unknown type', { type: 'surgery' }, 'Choose a treatment type'],
    ['a product over 100 characters', { product: 'x'.repeat(101) }, 'Product must be at most 100 characters'],
    ['a product that is not text', { product: 42 }, 'Invalid product'],
    ['a dose over 50 characters', { dose: 'x'.repeat(51) }, 'Dose must be at most 50 characters'],
    ['a route over 50 characters', { route: 'x'.repeat(51) }, 'Route must be at most 50 characters'],
    ['a given-by over 100 characters', { givenBy: 'x'.repeat(101) }, 'Given by must be at most 100 characters'],
    ['an impossible next due date', { nextDueDate: '2027-02-30' }, 'Enter a valid next due date'],
    ['a next due date on the date given', { nextDueDate: '2026-03-10' }, 'The next due date must be after the date given'],
    ['a next due date before the date given', { nextDueDate: '2026-01-01' }, 'The next due date must be after the date given'],
    ['an impossible withdrawal date', { withdrawalUntil: 'soon' }, 'Enter a valid withdrawal date'],
    ['a withdrawal date before the date given', { withdrawalUntil: '2026-03-09' }, 'The withdrawal date cannot be before the date given'],
    ['notes over 2000 characters', { notes: 'x'.repeat(2001) }, 'Notes are too long'],
  ]) {
    test(`rejects ${name} on create and on update`, async () => {
      const existing = await record(client, cow.id, FULL);
      const before = await cowById(client, cow.id);
      const created = await client.post(`/api/cattle/${cow.id}/treatments`).send({ ...FULL, ...fields }).expect(400);
      assert.equal(created.body.error, message);
      const updated = await client.put(`/api/treatments/${existing.id}`).send({ ...FULL, ...fields }).expect(400);
      assert.equal(updated.body.error, message);

      assert.deepEqual((await client.get('/api/treatments')).body, [existing]);
      assert.deepEqual(await cowById(client, cow.id), before);
    });
  }

  test('accepts a treatment dated today, and a withdrawal that ends the same day', async () => {
    const t = await record(client, cow.id, { dateGiven: isoDay(0), withdrawalUntil: isoDay(0), nextDueDate: isoDay(1) });
    assert.equal(t.dateGiven, isoDay(0));
    assert.equal(t.withdrawalUntil, isoDay(0));
  });

  test('rejects a malformed treatment id and a malformed due date filter', async () => {
    assert.equal((await client.put('/api/treatments/42').send(FULL).expect(400)).body.error, 'Invalid treatment id');
    await client.delete('/api/treatments/42').expect(400);
    assert.equal((await client.get('/api/treatments/due?until=next-week').expect(400)).body.error, 'Enter a valid date');
  });

  test('stores text exactly as typed, including markup', async () => {
    const notes = '<img src=x onerror=alert(1)> & "quotes"';
    const t = await record(client, cow.id, { notes, product: '<b>Pen</b>' });
    assert.equal(t.notes, notes);
    assert.equal(t.product, '<b>Pen</b>');
  });
});

describe('update and delete', () => {
  test('update replaces the fields and keeps the animal', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const t = await record(client, cow.id, FULL);
    const res = await client
      .put(`/api/treatments/${t.id}`)
      .send({ dateGiven: '2026-03-11', type: 'other', cattleId: UNKNOWN_ID })
      .expect(200);
    assert.equal(res.body.id, t.id);
    assert.equal(res.body.cattleId, cow.id);
    assert.equal(res.body.dateGiven, '2026-03-11');
    assert.equal(res.body.type, 'other');
    assert.equal(res.body.product, '', 'fields left out are cleared');
    assert.equal(res.body.nextDueDate, '');
    assert.equal(res.body.createdAt, t.createdAt);
    assert.deepEqual((await client.get('/api/treatments')).body, [res.body]);
  });

  test('delete removes the treatment', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const t = await record(client, cow.id);
    assert.deepEqual((await client.delete(`/api/treatments/${t.id}`).expect(200)).body, { ok: true });
    assert.deepEqual((await client.get('/api/treatments')).body, []);
    await client.delete(`/api/treatments/${t.id}`).expect(404);
  });

  test('unknown ids return 404', async () => {
    const client = await signedIn('a@example.com');
    const put = await client.put(`/api/treatments/${UNKNOWN_ID}`).send(FULL).expect(404);
    assert.equal(put.body.error, 'Treatment not found');
    const del = await client.delete(`/api/treatments/${UNKNOWN_ID}`).expect(404);
    assert.equal(del.body.error, 'Treatment not found');
  });
});

describe('upcoming and overdue follow-ups (GET /api/treatments/due)', () => {
  let client;
  let daisy;
  let bess;
  beforeEach(async () => {
    client = await signedIn('a@example.com');
    daisy = await addCow(client, { tagNumber: 'DAISY' });
    bess = await addCow(client, { tagNumber: 'BESS' });
  });
  const summary = (list) => list.map((t) => [t.cattleTag, t.product, t.nextDueDate]);

  test('lists treatments with a next due date, soonest first, overdue ones included', async () => {
    await record(client, daisy.id, { dateGiven: '2026-01-01', product: 'Later', nextDueDate: '2027-01-01' });
    await record(client, daisy.id, { dateGiven: '2025-01-01', product: 'Overdue', nextDueDate: '2025-06-01' });
    await record(client, bess.id, { dateGiven: '2026-01-01', product: 'Soon', nextDueDate: isoDay(3) });
    await record(client, bess.id, { dateGiven: '2026-01-01', product: 'None' });

    const list = await due(client);
    assert.deepEqual(summary(list), [
      ['DAISY', 'Overdue', '2025-06-01'], ['BESS', 'Soon', isoDay(3)], ['DAISY', 'Later', '2027-01-01'],
    ]);
    assert.equal(list[0].cattleId, daisy.id);
    assert.equal(list[0].type, 'treatment');
  });

  test('`until` keeps the ones due on or before that date', async () => {
    await record(client, daisy.id, { product: 'A', nextDueDate: '2026-04-01' });
    await record(client, daisy.id, { product: 'B', nextDueDate: '2026-04-08' });
    await record(client, daisy.id, { product: 'C', nextDueDate: '2026-04-09' });
    assert.deepEqual(summary(await due(client, '?until=2026-04-08')).map((r) => r[1]), ['A', 'B']);
  });

  test('recording the follow-up (same animal, type and product) closes the earlier one', async () => {
    const first = await record(client, daisy.id, { type: 'vaccination', product: 'Ultrabac 7', dateGiven: '2025-03-01', nextDueDate: '2026-03-01' });
    assert.deepEqual((await due(client)).map((t) => t.id), [first.id]);

    // Not the same series: another animal, another type, another product.
    await record(client, bess.id, { type: 'vaccination', product: 'Ultrabac 7', dateGiven: '2026-03-02' });
    await record(client, daisy.id, { type: 'treatment', product: 'Ultrabac 7', dateGiven: '2026-03-02' });
    await record(client, daisy.id, { type: 'vaccination', product: 'Bovi-Shield', dateGiven: '2026-03-02' });
    assert.deepEqual((await due(client)).map((t) => t.id), [first.id]);

    // The follow-up, with its own next due date; product matched ignoring case and spaces.
    const second = await record(client, daisy.id, { type: 'vaccination', product: ' ultrabac 7 ', dateGiven: '2026-03-03', nextDueDate: '2027-03-03' });
    assert.deepEqual((await due(client)).map((t) => t.id), [second.id]);

    // The history keeps both, unchanged.
    const history = (await client.get(`/api/cattle/${daisy.id}/treatments`)).body;
    assert.equal(history.find((t) => t.id === first.id).nextDueDate, '2026-03-01');

    // Deleting the follow-up reopens the earlier schedule.
    await client.delete(`/api/treatments/${second.id}`).expect(200);
    assert.deepEqual((await due(client)).map((t) => t.id), [first.id]);
  });

  test('an older record entered later does not close a newer schedule', async () => {
    const current = await record(client, daisy.id, { product: 'Pen', dateGiven: '2026-03-01', nextDueDate: '2026-04-01' });
    await record(client, daisy.id, { product: 'Pen', dateGiven: '2025-01-01' });
    assert.deepEqual((await due(client)).map((t) => t.id), [current.id]);
  });

  test('two records of a series on the same day: only the last one entered counts', async () => {
    await record(client, daisy.id, { product: 'Pen', dateGiven: '2026-03-01', nextDueDate: '2026-04-01' });
    const last = await record(client, daisy.id, { product: 'Pen', dateGiven: '2026-03-01', nextDueDate: '2026-05-01' });
    assert.deepEqual((await due(client)).map((t) => t.id), [last.id]);
  });

  test('clearing the next due date dismisses it; setting one schedules it', async () => {
    const t = await record(client, daisy.id, { ...FULL, nextDueDate: '2026-04-01' });
    await client.put(`/api/treatments/${t.id}`).send({ ...FULL, nextDueDate: '' }).expect(200);
    assert.deepEqual(await due(client), []);
    await client.put(`/api/treatments/${t.id}`).send({ ...FULL, nextDueDate: '2026-05-01' }).expect(200);
    assert.deepEqual(summary(await due(client)), [['DAISY', FULL.product, '2026-05-01']]);
  });
});

describe('withdrawal period on the animal', () => {
  let client;
  let cow;
  beforeEach(async () => {
    client = await signedIn('a@example.com');
    cow = await addCow(client);
  });
  const withdrawal = async () => (await cowById(client, cow.id)).withdrawalUntil;

  test('is the latest withdrawal date of her treatments, whatever order they are recorded in', async () => {
    assert.equal(await withdrawal(), '');
    await record(client, cow.id, { dateGiven: '2026-03-01', withdrawalUntil: '2026-03-20' });
    assert.equal(await withdrawal(), '2026-03-20');
    await record(client, cow.id, { dateGiven: '2026-03-05', withdrawalUntil: '2026-04-15' });
    assert.equal(await withdrawal(), '2026-04-15');
    await record(client, cow.id, { dateGiven: '2026-03-10', withdrawalUntil: '2026-03-25' });
    assert.equal(await withdrawal(), '2026-04-15', 'a shorter, later withdrawal does not shorten it');
    await record(client, cow.id, { dateGiven: '2026-03-11' });
    assert.equal(await withdrawal(), '2026-04-15');
  });

  test('follows edits and deletes, and clears with the last withdrawal', async () => {
    const short = await record(client, cow.id, { dateGiven: '2026-03-01', withdrawalUntil: '2026-03-20' });
    const long = await record(client, cow.id, { dateGiven: '2026-03-05', withdrawalUntil: '2026-04-15' });
    await client.put(`/api/treatments/${long.id}`).send({ dateGiven: '2026-03-05', type: 'treatment', withdrawalUntil: '2026-04-30' }).expect(200);
    assert.equal(await withdrawal(), '2026-04-30');
    await client.put(`/api/treatments/${long.id}`).send({ dateGiven: '2026-03-05', type: 'treatment' }).expect(200);
    assert.equal(await withdrawal(), '2026-03-20');
    await client.delete(`/api/treatments/${short.id}`).expect(200);
    assert.equal(await withdrawal(), '');
  });

  test('is returned by every cattle route and cannot be set through them', async () => {
    await record(client, cow.id, { dateGiven: '2026-03-01', withdrawalUntil: '2026-03-20' });
    const put = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'COW-1', withdrawalUntil: '2030-01-01' }).expect(200);
    assert.equal(put.body.withdrawalUntil, '2026-03-20');
    const created = await client.post('/api/cattle').send({ tagNumber: 'COW-2', withdrawalUntil: '2030-01-01' }).expect(201);
    assert.equal(created.body.withdrawalUntil, '');
  });

  test("only that animal's withdrawal changes", async () => {
    const other = await addCow(client, { tagNumber: 'COW-2' });
    await record(client, cow.id, { withdrawalUntil: '2026-03-20' });
    assert.equal((await cowById(client, other.id)).withdrawalUntil, '');
  });

  test('a failed create or update leaves it alone', async () => {
    const t = await record(client, cow.id, { dateGiven: '2026-03-01', withdrawalUntil: '2026-03-20' });
    await client.post(`/api/cattle/${cow.id}/treatments`).send({ dateGiven: '2026-03-01', type: 'bad', withdrawalUntil: '2026-09-01' }).expect(400);
    await client.put(`/api/treatments/${t.id}`).send({ dateGiven: '2026-03-01', type: 'treatment', withdrawalUntil: '2026-02-01' }).expect(400);
    assert.equal(await withdrawal(), '2026-03-20');
  });
});

describe('deleting animals and users', () => {
  test("deleting an animal deletes its treatments and nobody else's", async () => {
    const client = await signedIn('a@example.com');
    const daisy = await addCow(client, { tagNumber: 'DAISY' });
    const bess = await addCow(client, { tagNumber: 'BESS' });
    await record(client, daisy.id, { nextDueDate: '2026-04-01' });
    await record(client, daisy.id, { dateGiven: '2026-03-01' });
    const kept = await record(client, bess.id, { nextDueDate: '2026-05-01' });

    await client.delete(`/api/cattle/${daisy.id}`).expect(200);
    assert.deepEqual((await client.get('/api/treatments')).body.map((e) => e.id), [kept.id]);
    assert.deepEqual((await due(client)).map((e) => e.id), [kept.id]);
    assert.equal(await count(), 1);
    await client.get(`/api/cattle/${daisy.id}/treatments`).expect(404);
  });

  test('deleting a user deletes their treatments', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    await record(client, cow.id);
    await pool.query('DELETE FROM users WHERE id = $1', [client.user.id]);
    assert.equal(await count(), 0);
  });
});

describe('owner isolation', () => {
  let alice;
  let bob;
  let bobsCow;
  let bobsTreatment;

  beforeEach(async () => {
    alice = await signedIn('alice@example.com');
    bob = await signedIn('bob@example.com');
    bobsCow = await addCow(bob, { tagNumber: 'BOB-1' });
    bobsTreatment = await record(bob, bobsCow.id, { ...FULL, nextDueDate: '2026-04-01' });
  });

  // Bob's data exactly as he sees it; nothing another user does may change it.
  const bobsData = async () => ({
    treatments: (await bob.get('/api/treatments').expect(200)).body,
    due: await due(bob),
    herd: await herd(bob),
  });

  for (const [who, options] of [['another user', {}], ['an admin', { role: 'admin' }]]) {
    test(`${who} cannot list, read, add, change or delete someone else's treatments`, async () => {
      const other = who === 'an admin' ? await signedIn('admin@example.com', options) : alice;
      const before = await bobsData();

      assert.deepEqual((await other.get('/api/treatments').expect(200)).body, []);
      assert.deepEqual(await due(other), []);
      const list = await other.get(`/api/cattle/${bobsCow.id}/treatments`).expect(404);
      assert.equal(list.body.error, 'Cattle not found');
      const post = await other.post(`/api/cattle/${bobsCow.id}/treatments`).send({ ...FULL, withdrawalUntil: '2030-01-01' }).expect(404);
      assert.equal(post.body.error, 'Cattle not found');
      const put = await other.put(`/api/treatments/${bobsTreatment.id}`).send({ ...FULL, notes: 'changed', withdrawalUntil: '2030-01-01' }).expect(404);
      assert.equal(put.body.error, 'Treatment not found');
      const del = await other.delete(`/api/treatments/${bobsTreatment.id}`).expect(404);
      assert.equal(del.body.error, 'Treatment not found');

      assert.deepEqual(await bobsData(), before);
      assert.deepEqual(before.treatments, [bobsTreatment]);
      assert.deepEqual(before.due, [bobsTreatment]);
      assert.equal(before.herd[0].withdrawalUntil, FULL.withdrawalUntil);
      assert.deepEqual(await herd(other), []);
      assert.equal(await count(), 1);
    });
  }

  test("another user's follow-up of the same product does not close Bob's schedule", async () => {
    const alicesCow = await addCow(alice, { tagNumber: 'BOB-1' });
    await record(alice, alicesCow.id, { ...FULL, dateGiven: '2026-03-20', nextDueDate: '' });
    assert.deepEqual(await due(bob), [bobsTreatment]);
  });

  test('a client cannot choose the owner or move a treatment to another animal', async () => {
    const alicesCow = await addCow(alice, { tagNumber: 'ALICE-1' });
    const created = await alice
      .post(`/api/cattle/${alicesCow.id}/treatments`)
      .send({ ...FULL, ownerId: bob.user.id, owner_id: bob.user.id, cattleId: bobsCow.id, cattle_id: bobsCow.id })
      .expect(201);
    assert.equal(created.body.cattleId, alicesCow.id);
    const { rows } = await pool.query('SELECT owner_id, cattle_id FROM treatments WHERE id = $1', [created.body.id]);
    assert.deepEqual(rows, [{ owner_id: alice.user.id, cattle_id: alicesCow.id }]);

    await alice.put(`/api/treatments/${created.body.id}`).send({ ...FULL, cattleId: bobsCow.id }).expect(200);
    assert.deepEqual((await bob.get('/api/treatments')).body, [bobsTreatment]);
  });

  test('after signing out, a session no longer reaches its own treatments', async () => {
    await bob.post('/api/auth/logout').expect(200);
    await bob.get('/api/treatments').expect(401);
    await bob.get('/api/treatments/due').expect(401);
    await bob.get(`/api/cattle/${bobsCow.id}/treatments`).expect(401);
    await bob.delete(`/api/treatments/${bobsTreatment.id}`).expect(401);
    assert.equal(await count(), 1);
  });
});

describe('demo herd', () => {
  test('comes with treatments: an overdue and an upcoming follow-up, and a running withdrawal', async (t) => {
    process.env.DEMO_MODE = 'true';
    t.after(() => delete process.env.DEMO_MODE);
    const demo = agent();
    await demo.post('/api/auth/demo').expect(201);

    const treatments = (await demo.get('/api/treatments').expect(200)).body;
    assert.ok(treatments.length >= 5, 'the Medical Records page is not empty in demo mode');
    const open = await due(demo);
    const today = isoDay(0);
    assert.ok(open.some((d) => d.nextDueDate < today), 'one is overdue');
    assert.ok(open.some((d) => d.nextDueDate >= today && d.nextDueDate <= isoDay(7)), 'one is due within a week');

    const animals = await herd(demo);
    assert.ok(animals.some((c) => c.withdrawalUntil >= today), 'one animal is in a withdrawal period');
    for (const cow of animals) {
      const dates = treatments.filter((x) => x.cattleId === cow.id && x.withdrawalUntil).map((x) => x.withdrawalUntil).sort();
      assert.equal(cow.withdrawalUntil, dates.at(-1) || '', cow.tagNumber);
    }
  });
});
