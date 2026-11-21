const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool, agent, signedIn, useDatabase, prepareDatabase } = require('../helpers/api');

useDatabase();

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const FULL = {
  calvingDate: '2026-03-10',
  calfSex: 'female',
  calfTag: 'CALF-1',
  birthWeight: 82.5,
  ease: 'assisted',
  outcome: 'alive',
  notes: 'Light pull needed.',
};

const addCow = async (client, fields = {}) =>
  (await client.post('/api/cattle').send({ tagNumber: 'COW-1', gender: 'female', ...fields }).expect(201)).body;
const record = async (client, cowId, fields = {}) =>
  (await client.post(`/api/cattle/${cowId}/calvings`).send({ calvingDate: '2026-03-10', ...fields }).expect(201)).body;
const herd = async (client) => (await client.get('/api/cattle').expect(200)).body;
const cowById = async (client, id) => (await herd(client)).find((c) => c.id === id);
const eventCount = async () => (await pool.query('SELECT count(*)::int AS n FROM calving_events')).rows[0].n;
const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

describe('authentication', () => {
  for (const [method, path] of [
    ['get', '/api/calvings'],
    ['get', `/api/cattle/${UNKNOWN_ID}/calvings`],
    ['post', `/api/cattle/${UNKNOWN_ID}/calvings`],
    ['put', `/api/calvings/${UNKNOWN_ID}`],
    ['delete', `/api/calvings/${UNKNOWN_ID}`],
  ]) {
    test(`${method.toUpperCase()} ${path} needs a session`, async () => {
      const res = await request(app)[method](path).send(FULL).expect(401);
      assert.equal(res.body.error, 'Authentication required');
    });
  }
});

describe('create and read', () => {
  test('records a calving with every field and returns it with the cow it belongs to', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { nameBreed: 'Daisy Holstein' });
    const res = await client.post(`/api/cattle/${cow.id}/calvings`).send(FULL).expect(201);
    assert.match(res.body.id, /^[0-9a-f-]{36}$/);
    assert.ok(res.body.createdAt);
    const { id, createdAt, ...rest } = res.body;
    assert.deepEqual(rest, { ...FULL, cattleId: cow.id, cattleTag: 'COW-1', cattleName: 'Daisy Holstein', calf: null });

    const { calf, ...event } = res.body;
    assert.deepEqual((await client.get(`/api/cattle/${cow.id}/calvings`).expect(200)).body, [event]);
    assert.deepEqual((await client.get('/api/calvings').expect(200)).body, [event]);
  });

  test('needs only a date; the other fields come back empty', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const event = await record(client, cow.id);
    assert.equal(event.calvingDate, '2026-03-10');
    assert.equal(event.calfSex, '');
    assert.equal(event.calfTag, '');
    assert.equal(event.birthWeight, null);
    assert.equal(event.ease, '');
    assert.equal(event.outcome, '');
    assert.equal(event.notes, '');
  });

  test('a new account has no calvings', async () => {
    const client = await signedIn('a@example.com');
    assert.deepEqual((await client.get('/api/calvings').expect(200)).body, []);
    const cow = await addCow(client);
    assert.deepEqual((await client.get(`/api/cattle/${cow.id}/calvings`).expect(200)).body, []);
  });

  test('lists newest calving first, per cow and for the whole herd', async () => {
    const client = await signedIn('a@example.com');
    const daisy = await addCow(client, { tagNumber: 'DAISY' });
    const bess = await addCow(client, { tagNumber: 'BESS' });
    await record(client, daisy.id, { calvingDate: '2024-04-01' });
    await record(client, bess.id, { calvingDate: '2025-05-01' });
    await record(client, daisy.id, { calvingDate: '2026-02-01' });

    const all = (await client.get('/api/calvings').expect(200)).body;
    assert.deepEqual(all.map((e) => [e.cattleTag, e.calvingDate]), [
      ['DAISY', '2026-02-01'], ['BESS', '2025-05-01'], ['DAISY', '2024-04-01'],
    ]);
    const daisys = (await client.get(`/api/cattle/${daisy.id}/calvings`).expect(200)).body;
    assert.deepEqual(daisys.map((e) => e.calvingDate), ['2026-02-01', '2024-04-01']);
  });

  test('returns 404 for a cow that does not exist and 400 for a malformed id', async () => {
    const client = await signedIn('a@example.com');
    for (const method of ['get', 'post']) {
      const res = await client[method](`/api/cattle/${UNKNOWN_ID}/calvings`).send(FULL).expect(404);
      assert.equal(res.body.error, 'Cattle not found');
      await client[method]('/api/cattle/42/calvings').send(FULL).expect(400);
    }
    assert.equal(await eventCount(), 0);
  });

  test('refuses a calving for a male animal', async () => {
    const client = await signedIn('a@example.com');
    const bull = await addCow(client, { gender: 'male' });
    const res = await client.post(`/api/cattle/${bull.id}/calvings`).send(FULL).expect(400);
    assert.equal(res.body.error, 'Only female animals can have calving records');
    assert.equal(await eventCount(), 0);
  });

  test('allows a calving for an animal whose gender is not recorded', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { gender: '' });
    await record(client, cow.id);
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
    ['a missing date', { calvingDate: undefined }, 'Enter a valid calving date'],
    ['an empty date', { calvingDate: '' }, 'Enter a valid calving date'],
    ['text instead of a date', { calvingDate: 'last spring' }, 'Enter a valid calving date'],
    ['an impossible date', { calvingDate: '2026-02-30' }, 'Enter a valid calving date'],
    ['a date in the future', { calvingDate: isoDay(3) }, 'The calving date cannot be in the future'],
    ['an unknown calf sex', { calfSex: 'heifer' }, 'Invalid calf sex'],
    ['a calf number over 25 characters', { calfTag: 'x'.repeat(26) }, 'Invalid calf number'],
    ['a negative birth weight', { birthWeight: -5 }, 'Invalid birth weight'],
    ['a birth weight over 500', { birthWeight: 501 }, 'Invalid birth weight'],
    ['a birth weight that is not a number', { birthWeight: 'heavy' }, 'Invalid birth weight'],
    ['an unknown ease', { ease: 'easy' }, 'Invalid calving ease'],
    ['an unknown outcome', { outcome: 'fine' }, 'Invalid outcome'],
    ['notes over 2000 characters', { notes: 'x'.repeat(2001) }, 'Notes are too long'],
  ]) {
    test(`rejects ${name} on create and on update`, async () => {
      const existing = await record(client, cow.id, FULL);
      const created = await client.post(`/api/cattle/${cow.id}/calvings`).send({ ...FULL, ...fields }).expect(400);
      assert.equal(created.body.error, message);
      const updated = await client.put(`/api/calvings/${existing.id}`).send({ ...FULL, ...fields }).expect(400);
      assert.equal(updated.body.error, message);

      const { calf, ...unchanged } = existing;
      assert.deepEqual((await client.get('/api/calvings')).body, [unchanged]);
    });
  }

  test('accepts a calving dated today', async () => {
    const event = await record(client, cow.id, { calvingDate: isoDay(0) });
    assert.equal(event.calvingDate, isoDay(0));
  });

  test('rejects addCalf and clearExpected values that are not booleans', async () => {
    await client.post(`/api/cattle/${cow.id}/calvings`).send({ ...FULL, addCalf: 'yes' }).expect(400);
    await client.post(`/api/cattle/${cow.id}/calvings`).send({ ...FULL, clearExpected: 1 }).expect(400);
    assert.equal(await eventCount(), 0);
  });

  test('rejects a malformed calving id', async () => {
    await client.put('/api/calvings/42').send(FULL).expect(400);
    await client.delete('/api/calvings/42').expect(400);
  });

  test('stores text exactly as typed, including markup', async () => {
    const notes = '<img src=x onerror=alert(1)> & "quotes"';
    const event = await record(client, cow.id, { notes, calfTag: '<b>7</b>' });
    assert.equal(event.notes, notes);
    assert.equal(event.calfTag, '<b>7</b>');
  });
});

describe('update and delete', () => {
  test('update replaces the fields and keeps the cow', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const event = await record(client, cow.id, FULL);
    const res = await client
      .put(`/api/calvings/${event.id}`)
      .send({ calvingDate: '2026-03-11', outcome: 'stillborn', cattleId: UNKNOWN_ID })
      .expect(200);
    assert.equal(res.body.id, event.id);
    assert.equal(res.body.cattleId, cow.id);
    assert.equal(res.body.calvingDate, '2026-03-11');
    assert.equal(res.body.outcome, 'stillborn');
    assert.equal(res.body.calfTag, '', 'fields left out are cleared');
    assert.equal(res.body.birthWeight, null);
    assert.deepEqual((await client.get('/api/calvings')).body, [res.body]);
  });

  test('update never adds a calf', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const event = await record(client, cow.id, FULL);
    await client.put(`/api/calvings/${event.id}`).send({ ...FULL, addCalf: true }).expect(200);
    assert.equal((await herd(client)).length, 1);
  });

  test('delete removes the event', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const event = await record(client, cow.id);
    assert.deepEqual((await client.delete(`/api/calvings/${event.id}`).expect(200)).body, { ok: true });
    assert.deepEqual((await client.get('/api/calvings')).body, []);
    await client.delete(`/api/calvings/${event.id}`).expect(404);
  });

  test('unknown ids return 404', async () => {
    const client = await signedIn('a@example.com');
    const put = await client.put(`/api/calvings/${UNKNOWN_ID}`).send(FULL).expect(404);
    assert.equal(put.body.error, 'Calving record not found');
    const del = await client.delete(`/api/calvings/${UNKNOWN_ID}`).expect(404);
    assert.equal(del.body.error, 'Calving record not found');
  });
});

describe('last calving date follows the events', () => {
  let client;
  let cow;
  beforeEach(async () => {
    client = await signedIn('a@example.com');
    cow = await addCow(client);
  });
  const lastCalving = async () => (await cowById(client, cow.id)).lastCalvingDate;

  test('is the newest event, whatever order they are recorded in', async () => {
    assert.equal(await lastCalving(), '');
    await record(client, cow.id, { calvingDate: '2025-04-01' });
    assert.equal(await lastCalving(), '2025-04-01');
    await record(client, cow.id, { calvingDate: '2026-03-01' });
    assert.equal(await lastCalving(), '2026-03-01');
    await record(client, cow.id, { calvingDate: '2023-01-15' });
    assert.equal(await lastCalving(), '2026-03-01');
  });

  test('moves when the newest event is edited', async () => {
    await record(client, cow.id, { calvingDate: '2025-04-01' });
    const newest = await record(client, cow.id, { calvingDate: '2026-03-01' });
    await client.put(`/api/calvings/${newest.id}`).send({ calvingDate: '2026-03-05' }).expect(200);
    assert.equal(await lastCalving(), '2026-03-05');
    await client.put(`/api/calvings/${newest.id}`).send({ calvingDate: '2024-01-01' }).expect(200);
    assert.equal(await lastCalving(), '2025-04-01');
  });

  test('falls back to the previous event on delete, and clears with the last one', async () => {
    const older = await record(client, cow.id, { calvingDate: '2025-04-01' });
    const newest = await record(client, cow.id, { calvingDate: '2026-03-01' });
    await client.delete(`/api/calvings/${newest.id}`).expect(200);
    assert.equal(await lastCalving(), '2025-04-01');
    await client.delete(`/api/calvings/${older.id}`).expect(200);
    assert.equal(await lastCalving(), '');
  });

  test('a failed create or update leaves it alone', async () => {
    const event = await record(client, cow.id, { calvingDate: '2025-04-01' });
    await client.post(`/api/cattle/${cow.id}/calvings`).send({ calvingDate: '2026-02-30' }).expect(400);
    await client.put(`/api/calvings/${event.id}`).send({ calvingDate: 'nope' }).expect(400);
    assert.equal(await lastCalving(), '2025-04-01');
  });

  test("only that cow's date changes", async () => {
    const other = await addCow(client, { tagNumber: 'COW-2' });
    await record(client, cow.id, { calvingDate: '2026-03-01' });
    assert.equal((await cowById(client, other.id)).lastCalvingDate, '');
  });

  test('a last calving date given with a new animal becomes her first event', async () => {
    const daisy = await addCow(client, { tagNumber: 'DAISY', lastCalvingDate: '2025-09-15' });
    assert.equal(daisy.lastCalvingDate, '2025-09-15');
    const events = (await client.get(`/api/cattle/${daisy.id}/calvings`)).body;
    assert.deepEqual(events.map((e) => e.calvingDate), ['2025-09-15']);
  });

  test('a new male animal gets no last calving date and no event', async () => {
    const bull = await addCow(client, { tagNumber: 'BULL', gender: 'male', lastCalvingDate: '2025-09-15' });
    assert.equal(bull.lastCalvingDate, '');
    assert.equal(await eventCount(), 0);
  });

  test('editing the animal cannot change it: the events decide', async () => {
    await record(client, cow.id, { calvingDate: '2026-03-01' });
    const typed = await client
      .put(`/api/cattle/${cow.id}`)
      .send({ tagNumber: 'COW-1', gender: 'female', lastCalvingDate: '2020-01-01' })
      .expect(200);
    assert.equal(typed.body.lastCalvingDate, '2026-03-01');
    const blank = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'COW-1' }).expect(200);
    assert.equal(blank.body.lastCalvingDate, '2026-03-01');
    assert.equal(await eventCount(), 1);

    const never = await addCow(client, { tagNumber: 'COW-2' });
    const res = await client.put(`/api/cattle/${never.id}`).send({ tagNumber: 'COW-2', lastCalvingDate: '2020-01-01' }).expect(200);
    assert.equal(res.body.lastCalvingDate, '');
  });
});

describe('clearExpected', () => {
  test('clears the expected calving date and a pregnant status', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { expectedCalvingDate: '2026-03-12', healthStatus: 'pregnant' });
    await record(client, cow.id, { clearExpected: true });
    const after = await cowById(client, cow.id);
    assert.equal(after.expectedCalvingDate, '');
    assert.equal(after.healthStatus, 'healthy');
    assert.equal(after.lastCalvingDate, '2026-03-10');
  });

  test('leaves other health statuses alone', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { expectedCalvingDate: '2026-03-12', healthStatus: 'quarantine' });
    await record(client, cow.id, { clearExpected: true });
    const after = await cowById(client, cow.id);
    assert.equal(after.expectedCalvingDate, '');
    assert.equal(after.healthStatus, 'quarantine');
  });

  test('without it the expected date and status stay', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { expectedCalvingDate: '2026-03-12', healthStatus: 'pregnant' });
    await record(client, cow.id);
    const after = await cowById(client, cow.id);
    assert.equal(after.expectedCalvingDate, '2026-03-12');
    assert.equal(after.healthStatus, 'pregnant');
  });
});

describe('add the calf as a new animal', () => {
  let client;
  let cow;
  beforeEach(async () => {
    client = await signedIn('a@example.com');
    cow = await addCow(client, { tagNumber: 'DAM-1' });
  });

  test('creates the calf with its number, sex, birth date and weight', async () => {
    const res = await client.post(`/api/cattle/${cow.id}/calvings`).send({ ...FULL, addCalf: true }).expect(201);
    const calf = res.body.calf;
    assert.equal(calf.tagNumber, 'CALF-1');
    assert.equal(calf.gender, 'female');
    assert.equal(calf.birthDate, '2026-03-10');
    assert.equal(calf.weight, 82.5);
    assert.equal(calf.healthStatus, 'healthy');
    assert.equal(calf.notes, 'Calf of DAM-1.');
    assert.equal(calf.lastCalvingDate, '');

    const animals = await herd(client);
    assert.deepEqual(animals.map((c) => c.tagNumber).sort(), ['CALF-1', 'DAM-1']);
    assert.deepEqual(animals.find((c) => c.id === calf.id), calf);
    const { rows } = await pool.query('SELECT owner_id FROM cattle WHERE id = $1', [calf.id]);
    assert.equal(rows[0].owner_id, client.user.id);
    assert.equal(await eventCount(), 1);
  });

  test('works with only a date and a calf number', async () => {
    const res = await client
      .post(`/api/cattle/${cow.id}/calvings`)
      .send({ calvingDate: '2026-03-10', calfTag: ' CALF-2 ', addCalf: true })
      .expect(201);
    assert.equal(res.body.calfTag, 'CALF-2');
    assert.equal(res.body.calf.tagNumber, 'CALF-2');
    assert.equal(res.body.calf.gender, '');
    assert.equal(res.body.calf.weight, null);
  });

  test('without the option no animal is created', async () => {
    const res = await client.post(`/api/cattle/${cow.id}/calvings`).send({ ...FULL, addCalf: false }).expect(201);
    assert.equal(res.body.calf, null);
    assert.equal((await herd(client)).length, 1);
  });

  test('needs a calf number', async () => {
    const res = await client
      .post(`/api/cattle/${cow.id}/calvings`)
      .send({ ...FULL, calfTag: '', addCalf: true })
      .expect(400);
    assert.equal(res.body.error, 'Enter a calf number to add the calf as a new animal');
    assert.equal(await eventCount(), 0);
  });

  test('is refused for a stillborn calf', async () => {
    const res = await client
      .post(`/api/cattle/${cow.id}/calvings`)
      .send({ ...FULL, outcome: 'stillborn', addCalf: true })
      .expect(400);
    assert.equal(res.body.error, 'A stillborn calf cannot be added as a new animal');
    assert.equal(await eventCount(), 0);
  });

  test('a duplicate cow number (any case) rolls the whole calving back', async () => {
    await addCow(client, { tagNumber: 'calf-1' });
    await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'DAM-1', expectedCalvingDate: '2026-03-12', healthStatus: 'pregnant' }).expect(200);

    const res = await client
      .post(`/api/cattle/${cow.id}/calvings`)
      .send({ ...FULL, addCalf: true, clearExpected: true })
      .expect(409);
    assert.equal(res.body.error, 'Duplicate cow number');

    assert.equal(await eventCount(), 0);
    assert.equal((await herd(client)).length, 2);
    const dam = await cowById(client, cow.id);
    assert.equal(dam.lastCalvingDate, '');
    assert.equal(dam.expectedCalvingDate, '2026-03-12');
    assert.equal(dam.healthStatus, 'pregnant');
  });

  test("the calf number may match the dam's own number only in another account", async () => {
    await client.post(`/api/cattle/${cow.id}/calvings`).send({ ...FULL, calfTag: 'dam-1', addCalf: true }).expect(409);
    const bob = await signedIn('bob@example.com');
    const bobsCow = await addCow(bob, { tagNumber: 'BOB-1' });
    await bob.post(`/api/cattle/${bobsCow.id}/calvings`).send({ ...FULL, calfTag: 'DAM-1', addCalf: true }).expect(201);
  });

  test('a demo account at its 25-animal limit gets 403 and no calving', async (t) => {
    process.env.DEMO_MODE = 'true';
    t.after(() => delete process.env.DEMO_MODE);
    const demo = agent();
    await demo.post('/api/auth/demo').expect(201);
    for (let n = 9; n <= 25; n += 1) {
      await demo.post('/api/cattle').send({ tagNumber: `EXTRA-${n}` }).expect(201);
    }
    const before = await eventCount();
    const dam = (await herd(demo)).find((c) => c.tagNumber === 'CT-001');
    const res = await demo.post(`/api/cattle/${dam.id}/calvings`).send({ ...FULL, calfTag: 'CALF-26', addCalf: true }).expect(403);
    assert.equal(res.body.error, 'Demo accounts are limited to 25 animals.');
    assert.equal(await eventCount(), before);
    assert.equal((await herd(demo)).length, 25);
  });
});

describe('deleting animals', () => {
  test("deleting a cow deletes her calving events and nobody else's", async () => {
    const client = await signedIn('a@example.com');
    const daisy = await addCow(client, { tagNumber: 'DAISY' });
    const bess = await addCow(client, { tagNumber: 'BESS' });
    await record(client, daisy.id, { calvingDate: '2025-04-01' });
    await record(client, daisy.id, { calvingDate: '2026-03-01' });
    const kept = await record(client, bess.id);

    await client.delete(`/api/cattle/${daisy.id}`).expect(200);
    assert.deepEqual((await client.get('/api/calvings')).body.map((e) => e.id), [kept.id]);
    assert.equal(await eventCount(), 1);
    await client.get(`/api/cattle/${daisy.id}/calvings`).expect(404);
  });

  test('deleting a calf that was added as an animal keeps the calving event', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const event = await record(client, cow.id, { ...FULL, addCalf: true });
    await client.delete(`/api/cattle/${event.calf.id}`).expect(200);
    assert.equal(await eventCount(), 1);
  });

  test('deleting a user deletes their calving events', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    await record(client, cow.id);
    await pool.query('DELETE FROM users WHERE id = $1', [client.user.id]);
    assert.equal(await eventCount(), 0);
  });
});

describe('owner isolation', () => {
  let alice;
  let bob;
  let bobsCow;
  let bobsEvent;

  beforeEach(async () => {
    alice = await signedIn('alice@example.com');
    bob = await signedIn('bob@example.com');
    bobsCow = await addCow(bob, { tagNumber: 'BOB-1' });
    bobsEvent = await record(bob, bobsCow.id, FULL);
    delete bobsEvent.calf;
  });

  // Bob's data exactly as he sees it; nothing Alice does may change it.
  const bobsData = async () => ({
    events: (await bob.get('/api/calvings').expect(200)).body,
    herd: await herd(bob),
  });

  for (const [who, options] of [['another user', {}], ['an admin', { role: 'admin' }]]) {
    test(`${who} cannot list, read, add, change or delete someone else's calvings`, async () => {
      const other = who === 'an admin' ? await signedIn('admin@example.com', options) : alice;
      const before = await bobsData();

      assert.deepEqual((await other.get('/api/calvings').expect(200)).body, []);
      const list = await other.get(`/api/cattle/${bobsCow.id}/calvings`).expect(404);
      assert.equal(list.body.error, 'Cattle not found');
      const post = await other.post(`/api/cattle/${bobsCow.id}/calvings`).send({ ...FULL, calvingDate: '2026-04-01' }).expect(404);
      assert.equal(post.body.error, 'Cattle not found');
      await other
        .post(`/api/cattle/${bobsCow.id}/calvings`)
        .send({ ...FULL, calfTag: 'SNEAK', addCalf: true, clearExpected: true })
        .expect(404);
      const put = await other.put(`/api/calvings/${bobsEvent.id}`).send({ calvingDate: '2020-01-01', notes: 'changed' }).expect(404);
      assert.equal(put.body.error, 'Calving record not found');
      const del = await other.delete(`/api/calvings/${bobsEvent.id}`).expect(404);
      assert.equal(del.body.error, 'Calving record not found');

      assert.deepEqual(await bobsData(), before);
      assert.deepEqual(before.events, [bobsEvent]);
      assert.equal(before.herd[0].lastCalvingDate, FULL.calvingDate);
      assert.deepEqual(await herd(other), []);
      assert.equal(await eventCount(), 1);
    });
  }

  test('a client cannot choose the owner or move an event to another cow', async () => {
    const alicesCow = await addCow(alice, { tagNumber: 'ALICE-1' });
    const created = await alice
      .post(`/api/cattle/${alicesCow.id}/calvings`)
      .send({ ...FULL, ownerId: bob.user.id, owner_id: bob.user.id, cattleId: bobsCow.id, cattle_id: bobsCow.id })
      .expect(201);
    assert.equal(created.body.cattleId, alicesCow.id);
    const { rows } = await pool.query('SELECT owner_id, cattle_id FROM calving_events WHERE id = $1', [created.body.id]);
    assert.deepEqual(rows, [{ owner_id: alice.user.id, cattle_id: alicesCow.id }]);

    await alice.put(`/api/calvings/${created.body.id}`).send({ ...FULL, cattleId: bobsCow.id }).expect(200);
    assert.deepEqual((await bob.get('/api/calvings')).body, [bobsEvent]);
  });

  test('each user sees only their own events in the herd-wide list', async () => {
    const alicesCow = await addCow(alice, { tagNumber: 'ALICE-1' });
    const alicesEvent = await record(alice, alicesCow.id);
    assert.deepEqual((await alice.get('/api/calvings')).body.map((e) => e.id), [alicesEvent.id]);
    assert.deepEqual((await bob.get('/api/calvings')).body.map((e) => e.id), [bobsEvent.id]);
  });

  test('after signing out, a session no longer reaches its own calvings', async () => {
    await bob.post('/api/auth/logout').expect(200);
    await bob.get('/api/calvings').expect(401);
    await bob.get(`/api/cattle/${bobsCow.id}/calvings`).expect(401);
    await bob.delete(`/api/calvings/${bobsEvent.id}`).expect(401);
    assert.equal(await eventCount(), 1);
  });
});

describe('demo herd', () => {
  test('comes with calving history that matches each last calving date', async (t) => {
    process.env.DEMO_MODE = 'true';
    t.after(() => delete process.env.DEMO_MODE);
    const demo = agent();
    await demo.post('/api/auth/demo').expect(201);

    const events = (await demo.get('/api/calvings').expect(200)).body;
    assert.ok(events.length >= 5, 'the Calving page is not empty in demo mode');
    const newest = {};
    for (const e of events) if (!newest[e.cattleId] || e.calvingDate > newest[e.cattleId]) newest[e.cattleId] = e.calvingDate;
    for (const cow of await herd(demo)) {
      assert.equal(cow.lastCalvingDate, newest[cow.id] || '', cow.tagNumber);
    }
  });
});

describe('migration of existing last calving dates', () => {
  // Rows as they were before calving events existed: a date on the animal and no event.
  async function legacyCow(ownerId, tag, lastCalving) {
    const { rows } = await pool.query(
      'INSERT INTO cattle (owner_id, tag_number, last_calving_date) VALUES ($1, $2, $3) RETURNING id',
      [ownerId, tag, lastCalving]
    );
    return rows[0].id;
  }

  test('creates one event per animal with a date, once, and keeps the date', async () => {
    const client = await signedIn('a@example.com');
    const other = await signedIn('b@example.com');
    const daisy = await legacyCow(client.user.id, 'DAISY', '2025-09-15');
    await legacyCow(client.user.id, 'NEVER', null);
    const theirs = await legacyCow(other.user.id, 'THEIRS', '2024-02-02');
    const current = await addCow(client, { tagNumber: 'CURRENT' });
    await record(client, current.id, { calvingDate: '2026-01-01' });
    await record(client, current.id, { calvingDate: '2026-03-01' });

    await prepareDatabase();
    await prepareDatabase();

    const { rows } = await pool.query(
      'SELECT cattle_id, owner_id, calving_date, outcome, notes FROM calving_events WHERE cattle_id = ANY($1) ORDER BY calving_date',
      [[daisy, theirs]]
    );
    assert.deepEqual(rows, [
      { cattle_id: theirs, owner_id: other.user.id, calving_date: '2024-02-02', outcome: null, notes: 'Imported from the last calving date on the animal record.' },
      { cattle_id: daisy, owner_id: client.user.id, calving_date: '2025-09-15', outcome: null, notes: 'Imported from the last calving date on the animal record.' },
    ]);
    assert.equal(await eventCount(), 4, 'animals that already have events get no extra one');

    const events = (await client.get('/api/calvings')).body;
    assert.deepEqual(events.map((e) => [e.cattleTag, e.calvingDate]), [
      ['CURRENT', '2026-03-01'], ['CURRENT', '2026-01-01'], ['DAISY', '2025-09-15'],
    ]);
    assert.equal((await cowById(client, daisy)).lastCalvingDate, '2025-09-15');
  });

  test('does not bring back an event the user deleted', async () => {
    const client = await signedIn('a@example.com');
    const daisy = await legacyCow(client.user.id, 'DAISY', '2025-09-15');
    await prepareDatabase();
    const [event] = (await client.get(`/api/cattle/${daisy}/calvings`)).body;
    await client.delete(`/api/calvings/${event.id}`).expect(200);

    await prepareDatabase();
    assert.equal(await eventCount(), 0);
    assert.equal((await cowById(client, daisy)).lastCalvingDate, '');
  });
});
