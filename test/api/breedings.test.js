const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool, agent, signedIn, useDatabase } = require('../helpers/api');

useDatabase();

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const FULL = {
  breedingDate: '2026-01-10',
  method: 'ai',
  sire: 'Select Sires 7HO14000',
  technician: 'J. Miller',
  notes: 'Standing heat in the morning.',
};
const FULL_EXPECTED = '2026-10-20'; // 2026-01-10 + 283 days

const addCow = async (client, fields = {}) =>
  (await client.post('/api/cattle').send({ tagNumber: 'COW-1', gender: 'female', ...fields }).expect(201)).body;
const addBull = (client, fields = {}) => addCow(client, { tagNumber: 'BULL-1', nameBreed: 'Maximus', gender: 'male', ...fields });
const breed = async (client, cowId, fields = {}) =>
  (await client.post(`/api/cattle/${cowId}/breedings`).send({ breedingDate: '2026-01-10', ...fields }).expect(201)).body;
const check = async (client, cowId, fields = {}) =>
  (await client.post(`/api/cattle/${cowId}/pregnancy-checks`).send({ checkDate: '2026-02-20', result: 'pregnant', ...fields }).expect(201)).body;
const calve = async (client, cowId, fields = {}) =>
  (await client.post(`/api/cattle/${cowId}/calvings`).send({ calvingDate: '2026-10-18', ...fields }).expect(201)).body;
const herd = async (client) => (await client.get('/api/cattle').expect(200)).body;
const cowById = async (client, id) => (await herd(client)).find((c) => c.id === id);
const needsCheck = async (client, today) =>
  (await client.get(`/api/breedings/needs-check${today ? `?today=${today}` : ''}`).expect(200)).body;
const breedingCount = async () => (await pool.query('SELECT count(*)::int AS n FROM breeding_events')).rows[0].n;

describe('authentication', () => {
  for (const [method, path] of [
    ['get', '/api/breedings'],
    ['get', '/api/breedings/needs-check'],
    ['get', `/api/cattle/${UNKNOWN_ID}/breedings`],
    ['post', `/api/cattle/${UNKNOWN_ID}/breedings`],
    ['put', `/api/breedings/${UNKNOWN_ID}`],
    ['delete', `/api/breedings/${UNKNOWN_ID}`],
  ]) {
    test(`${method.toUpperCase()} ${path} needs a session`, async () => {
      const res = await request(app)[method](path).send(FULL).expect(401);
      assert.equal(res.body.error, 'Authentication required');
    });
  }
});

describe('create and read', () => {
  test('records a breeding with every field and returns it with the cow and the implied calving date', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client, { nameBreed: 'Daisy Holstein' });
    const res = await client.post(`/api/cattle/${cow.id}/breedings`).send(FULL).expect(201);
    assert.match(res.body.id, /^[0-9a-f-]{36}$/);
    assert.ok(res.body.createdAt);
    const { id, createdAt, ...rest } = res.body;
    assert.deepEqual(rest, {
      ...FULL,
      cattleId: cow.id,
      cattleTag: 'COW-1',
      cattleName: 'Daisy Holstein',
      sireCattleId: null,
      sireTag: '',
      sireName: '',
      expectedCalvingDate: FULL_EXPECTED,
      checkResult: '',
      checkDate: '',
    });
    assert.deepEqual((await client.get(`/api/cattle/${cow.id}/breedings`).expect(200)).body, [res.body]);
    assert.deepEqual((await client.get('/api/breedings').expect(200)).body, [res.body]);
  });

  test('needs only a date; the other fields come back empty', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const event = await breed(client, cow.id);
    for (const key of ['method', 'sire', 'technician', 'notes', 'sireTag', 'sireName']) assert.equal(event[key], '', key);
    assert.equal(event.sireCattleId, null);
  });

  test('lists newest breeding first, per cow and for the whole herd', async () => {
    const client = await signedIn('a@example.com');
    const daisy = await addCow(client, { tagNumber: 'DAISY' });
    const bess = await addCow(client, { tagNumber: 'BESS' });
    await breed(client, daisy.id, { breedingDate: '2025-05-01' });
    await breed(client, bess.id, { breedingDate: '2026-03-01' });
    await breed(client, daisy.id, { breedingDate: '2026-02-01' });
    const all = (await client.get('/api/breedings').expect(200)).body;
    assert.deepEqual(all.map((e) => `${e.cattleTag} ${e.breedingDate}`), ['BESS 2026-03-01', 'DAISY 2026-02-01', 'DAISY 2025-05-01']);
    const daisys = (await client.get(`/api/cattle/${daisy.id}/breedings`).expect(200)).body;
    assert.deepEqual(daisys.map((e) => e.breedingDate), ['2026-02-01', '2025-05-01']);
  });

  test('returns 404 for a cow that does not exist and 400 for a malformed id', async () => {
    const client = await signedIn('a@example.com');
    assert.equal((await client.get(`/api/cattle/${UNKNOWN_ID}/breedings`).expect(404)).body.error, 'Cattle not found');
    assert.equal((await client.post(`/api/cattle/${UNKNOWN_ID}/breedings`).send(FULL).expect(404)).body.error, 'Cattle not found');
    assert.equal((await client.get('/api/cattle/not-a-uuid/breedings').expect(400)).body.error, 'Invalid cattle id');
  });

  test('refuses a breeding for a male animal, allows one when the gender is not recorded', async () => {
    const client = await signedIn('a@example.com');
    const bull = await addBull(client);
    const res = await client.post(`/api/cattle/${bull.id}/breedings`).send(FULL).expect(400);
    assert.equal(res.body.error, 'Only female animals can have breeding records');
    const unknown = await addCow(client, { tagNumber: 'X-1', gender: '' });
    await breed(client, unknown.id);
    assert.equal(await breedingCount(), 1);
  });

  test('stores text exactly as typed, including markup', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const event = await breed(client, cow.id, { sire: '<b>Bull</b>', notes: '<script>alert(1)</script>' });
    assert.equal(event.sire, '<b>Bull</b>');
    assert.equal(event.notes, '<script>alert(1)</script>');
  });
});

describe('validation', () => {
  const long = (n) => 'x'.repeat(n);
  const cases = [
    ['a missing date', { breedingDate: '' }, 'Enter a valid breeding date'],
    ['an impossible date', { breedingDate: '2026-02-30' }, 'Enter a valid breeding date'],
    ['a future date', { breedingDate: '2999-01-01' }, 'The breeding date cannot be in the future'],
    ['an unknown method', { method: 'embryo' }, 'Invalid breeding method'],
    ['a sire over 100 characters', { sire: long(101) }, 'The sire must be 100 characters or fewer'],
    ['a malformed bull id', { sireCattleId: 'bull' }, 'Choose a bull from your herd'],
    ['a technician over 100 characters', { technician: long(101) }, 'The technician must be 100 characters or fewer'],
    ['notes over 2000 characters', { notes: long(2001) }, 'Notes are too long'],
  ];
  for (const [name, fields, message] of cases) {
    test(`rejects ${name} on create and on update`, async () => {
      const client = await signedIn('a@example.com');
      const cow = await addCow(client);
      const created = await client.post(`/api/cattle/${cow.id}/breedings`).send({ ...FULL, ...fields }).expect(400);
      assert.equal(created.body.error, message);
      const event = await breed(client, cow.id, FULL);
      const updated = await client.put(`/api/breedings/${event.id}`).send({ ...FULL, ...fields }).expect(400);
      assert.equal(updated.body.error, message);
      assert.deepEqual((await client.get('/api/breedings')).body, [event]);
    });
  }

  test('accepts a breeding dated today and the limits exactly', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const today = new Date().toISOString().slice(0, 10);
    await breed(client, cow.id, { breedingDate: today, sire: long(100), technician: long(100), notes: long(2000), method: 'natural' });
  });

  test('rejects a malformed breeding id', async () => {
    const client = await signedIn('a@example.com');
    assert.equal((await client.put('/api/breedings/nope').send(FULL).expect(400)).body.error, 'Invalid breeding id');
    assert.equal((await client.delete('/api/breedings/nope').expect(400)).body.error, 'Invalid breeding id');
  });

  test('rejects a malformed today on the needs-check list', async () => {
    const client = await signedIn('a@example.com');
    assert.equal((await client.get('/api/breedings/needs-check?today=2026-13-01').expect(400)).body.error, 'Invalid date');
  });
});

describe('sire from the herd', () => {
  test("links a bull, keeps its number and name as the sire text, and shows the bull's current details", async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const bull = await addBull(client);
    const event = await breed(client, cow.id, { method: 'natural', sire: 'ignored', sireCattleId: bull.id });
    assert.equal(event.sireCattleId, bull.id);
    assert.equal(event.sire, 'BULL-1 Maximus');
    assert.equal(event.sireTag, 'BULL-1');
    assert.equal(event.sireName, 'Maximus');

    await client.put(`/api/cattle/${bull.id}`).send({ tagNumber: 'BULL-9', nameBreed: 'Max II', gender: 'male' }).expect(200);
    const [listed] = (await client.get('/api/breedings')).body;
    assert.equal(listed.sireTag, 'BULL-9');
    assert.equal(listed.sireName, 'Max II');
    assert.equal(listed.sire, 'BULL-1 Maximus', 'the saved text is a snapshot');
  });

  test('refuses a female, an unknown id, and a bull from another herd', async () => {
    const alice = await signedIn('alice@example.com');
    const bob = await signedIn('bob@example.com');
    const cow = await addCow(alice);
    const otherCow = await addCow(alice, { tagNumber: 'COW-2' });
    const bobsBull = await addBull(bob);
    for (const sireCattleId of [otherCow.id, cow.id, UNKNOWN_ID, bobsBull.id]) {
      const res = await alice.post(`/api/cattle/${cow.id}/breedings`).send({ ...FULL, sireCattleId }).expect(400);
      assert.equal(res.body.error, 'Choose a bull from your herd');
    }
    const event = await breed(alice, cow.id);
    const res = await alice.put(`/api/breedings/${event.id}`).send({ ...FULL, sireCattleId: bobsBull.id }).expect(400);
    assert.equal(res.body.error, 'Choose a bull from your herd');
    assert.equal(await breedingCount(), 1);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM breeding_events WHERE sire_cattle_id IS NOT NULL');
    assert.equal(rows[0].n, 0);
  });

  test('deleting the bull keeps the breeding and its sire text and clears the link', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const bull = await addBull(client);
    const event = await breed(client, cow.id, { sireCattleId: bull.id });
    await client.delete(`/api/cattle/${bull.id}`).expect(200);
    const [after] = (await client.get('/api/breedings')).body;
    assert.equal(after.id, event.id);
    assert.equal(after.sireCattleId, null);
    assert.equal(after.sire, 'BULL-1 Maximus');
    assert.equal(after.sireTag, '');
  });

  test('an update without a bull clears the link and keeps the typed sire', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const bull = await addBull(client);
    const event = await breed(client, cow.id, { sireCattleId: bull.id });
    const res = await client.put(`/api/breedings/${event.id}`).send({ ...FULL, sireCattleId: '' }).expect(200);
    assert.equal(res.body.sireCattleId, null);
    assert.equal(res.body.sire, FULL.sire);
  });
});

describe('update and delete', () => {
  test('update replaces the fields and keeps the cow', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const event = await breed(client, cow.id, FULL);
    const res = await client.put(`/api/breedings/${event.id}`).send({ breedingDate: '2026-02-01', method: 'natural' }).expect(200);
    assert.equal(res.body.id, event.id);
    assert.equal(res.body.cattleId, cow.id);
    assert.equal(res.body.breedingDate, '2026-02-01');
    assert.equal(res.body.method, 'natural');
    assert.equal(res.body.sire, '');
    assert.equal(res.body.technician, '');
    assert.equal(res.body.notes, '');
    assert.equal(res.body.expectedCalvingDate, '2026-11-11');
  });

  test('delete removes the breeding; its checks stay and lose the link', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const event = await breed(client, cow.id);
    const c = await check(client, cow.id, { breedingId: event.id });
    assert.equal(c.breedingId, event.id);
    assert.deepEqual((await client.delete(`/api/breedings/${event.id}`).expect(200)).body, { ok: true });
    assert.deepEqual((await client.get('/api/breedings')).body, []);
    const [kept] = (await client.get('/api/pregnancy-checks')).body;
    assert.equal(kept.id, c.id);
    assert.equal(kept.breedingId, null);
    assert.equal(kept.breedingDate, '');
  });

  test('an update cannot move the breeding after one of its checks', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const event = await breed(client, cow.id);
    await check(client, cow.id, { breedingId: event.id, checkDate: '2026-02-20' });
    const res = await client.put(`/api/breedings/${event.id}`).send({ ...FULL, breedingDate: '2026-03-01' }).expect(400);
    assert.equal(res.body.error, 'A pregnancy check for this breeding is dated before the new breeding date');
    assert.equal((await client.get('/api/breedings')).body[0].breedingDate, '2026-01-10');
  });

  test('the list shows the newest check linked to each breeding', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const event = await breed(client, cow.id);
    await check(client, cow.id, { breedingId: event.id, checkDate: '2026-02-20', result: 'unsure' });
    await check(client, cow.id, { breedingId: event.id, checkDate: '2026-03-20', result: 'pregnant' });
    const [listed] = (await client.get('/api/breedings')).body;
    assert.equal(listed.checkResult, 'pregnant');
    assert.equal(listed.checkDate, '2026-03-20');
  });

  test('unknown ids return 404', async () => {
    const client = await signedIn('a@example.com');
    assert.equal((await client.put(`/api/breedings/${UNKNOWN_ID}`).send(FULL).expect(404)).body.error, 'Breeding record not found');
    assert.equal((await client.delete(`/api/breedings/${UNKNOWN_ID}`).expect(404)).body.error, 'Breeding record not found');
  });
});

describe('expected calving date', () => {
  let client;
  let cow;
  beforeEach(async () => {
    client = await signedIn('a@example.com');
    cow = await addCow(client);
  });
  const expected = async () => (await cowById(client, cow.id)).expectedCalvingDate;

  test('recording a breeding sets it to the breeding date + 283 days, replacing a typed date', async () => {
    await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'COW-1', gender: 'female', expectedCalvingDate: '2026-05-05' }).expect(200);
    await breed(client, cow.id, { breedingDate: '2026-01-10' });
    assert.equal(await expected(), FULL_EXPECTED);
    // A later breeding (she came back into heat) moves it again.
    await breed(client, cow.id, { breedingDate: '2026-02-01' });
    assert.equal(await expected(), '2026-11-11');
  });

  test('counts calendar days across a leap day', async () => {
    await breed(client, cow.id, { breedingDate: '2024-02-29' });
    assert.equal(await expected(), '2024-12-08');
  });

  test('an older breeding does not move it', async () => {
    await breed(client, cow.id, { breedingDate: '2026-02-01' });
    await breed(client, cow.id, { breedingDate: '2025-05-01' });
    assert.equal(await expected(), '2026-11-11');
  });

  test('a breeding before her last calving does not set it', async () => {
    await calve(client, cow.id, { calvingDate: '2026-01-15' });
    await breed(client, cow.id, { breedingDate: '2025-04-10' });
    assert.equal(await expected(), '');
  });

  test('stays editable on the animal', async () => {
    await breed(client, cow.id);
    const res = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'COW-1', gender: 'female', expectedCalvingDate: '2026-10-25' }).expect(200);
    assert.equal(res.body.expectedCalvingDate, '2026-10-25');
  });

  test('follows an edited or deleted breeding', async () => {
    const older = await breed(client, cow.id, { breedingDate: '2025-05-01' });
    const newest = await breed(client, cow.id, { breedingDate: '2026-01-10' });
    await client.put(`/api/breedings/${newest.id}`).send({ breedingDate: '2026-02-01' }).expect(200);
    assert.equal(await expected(), '2026-11-11');
    await client.delete(`/api/breedings/${newest.id}`).expect(200);
    assert.equal(await expected(), '2026-02-08', 'falls back to the previous breeding');
    await client.delete(`/api/breedings/${older.id}`).expect(200);
    assert.equal(await expected(), '', 'cleared with the last breeding');
  });

  test('a date typed by hand is kept when a breeding is edited or deleted', async () => {
    const event = await breed(client, cow.id);
    await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'COW-1', gender: 'female', expectedCalvingDate: '2026-10-25' }).expect(200);
    await client.put(`/api/breedings/${event.id}`).send({ breedingDate: '2026-02-01' }).expect(200);
    assert.equal(await expected(), '2026-10-25');
    await client.delete(`/api/breedings/${event.id}`).expect(200);
    assert.equal(await expected(), '2026-10-25');
  });

  test('a failed create or update leaves it alone', async () => {
    const event = await breed(client, cow.id);
    await client.post(`/api/cattle/${cow.id}/breedings`).send({ breedingDate: '2026-02-01', sireCattleId: UNKNOWN_ID }).expect(400);
    await client.put(`/api/breedings/${event.id}`).send({ breedingDate: '2026-02-01', method: 'x' }).expect(400);
    assert.equal(await expected(), FULL_EXPECTED);
  });

  test("only that cow's date changes", async () => {
    const other = await addCow(client, { tagNumber: 'COW-2', expectedCalvingDate: '2026-12-01' });
    await breed(client, cow.id);
    assert.equal((await cowById(client, other.id)).expectedCalvingDate, '2026-12-01');
  });

  test('calving with clearExpected clears it, and editing the old breeding does not bring it back', async () => {
    const event = await breed(client, cow.id);
    await check(client, cow.id, { breedingId: event.id });
    assert.equal((await cowById(client, cow.id)).healthStatus, 'pregnant');
    await calve(client, cow.id, { calvingDate: '2026-10-18', clearExpected: true });
    let after = await cowById(client, cow.id);
    assert.equal(after.expectedCalvingDate, '');
    assert.equal(after.healthStatus, 'healthy');

    await client.put(`/api/breedings/${event.id}`).send({ ...FULL, notes: 'edited' }).expect(200);
    after = await cowById(client, cow.id);
    assert.equal(after.expectedCalvingDate, '');
    assert.equal(after.healthStatus, 'healthy');
    // She is bred again after calving: the new breeding sets the date.
    await breed(client, cow.id, { breedingDate: new Date().toISOString().slice(0, 10) });
    assert.notEqual(await expected(), '');
  });
});

describe('needs pregnancy check', () => {
  const TODAY = '2026-06-01';
  let client;
  beforeEach(async () => {
    client = await signedIn('a@example.com');
  });
  const tags = async (today = TODAY) => (await needsCheck(client, today)).cows.map((c) => c.cattleTag);

  test('lists cows bred more than 35 days ago with no check since, oldest breeding first', async () => {
    const a = await addCow(client, { tagNumber: 'A' });
    const b = await addCow(client, { tagNumber: 'B', nameBreed: 'Bess' });
    const c = await addCow(client, { tagNumber: 'C' });
    await breed(client, a.id, { breedingDate: '2026-04-26' }); // 36 days before TODAY
    await breed(client, b.id, { breedingDate: '2026-03-01', sire: 'Angus AI' });
    await breed(client, c.id, { breedingDate: '2026-04-27' }); // exactly 35 days: not yet
    const body = await needsCheck(client, TODAY);
    assert.equal(body.today, TODAY);
    assert.equal(body.checkAfterDays, 35);
    assert.equal(body.gestationDays, 283);
    assert.deepEqual(body.cows.map((x) => [x.cattleTag, x.breedingDate, x.daysSinceBreeding]), [
      ['B', '2026-03-01', 92],
      ['A', '2026-04-26', 36],
    ]);
    assert.equal(body.cows[0].cattleName, 'Bess');
    assert.equal(body.cows[0].sire, 'Angus AI');
    assert.equal(body.cows[0].cattleId, b.id);
    assert.deepEqual(await tags('2026-06-02'), ['B', 'A', 'C']);
  });

  test('a check on or after the breeding takes the cow off; an older check does not', async () => {
    const a = await addCow(client, { tagNumber: 'A' });
    const b = await addCow(client, { tagNumber: 'B' });
    await check(client, a.id, { checkDate: '2025-12-01', result: 'open' });
    await breed(client, a.id, { breedingDate: '2026-01-10' });
    await breed(client, b.id, { breedingDate: '2026-01-10' });
    await check(client, b.id, { checkDate: '2026-01-10', result: 'unsure' });
    assert.deepEqual(await tags(), ['A']);
  });

  test('only the newest breeding counts, and a cow that has calved since is not listed', async () => {
    const a = await addCow(client, { tagNumber: 'A' });
    const b = await addCow(client, { tagNumber: 'B' });
    await breed(client, a.id, { breedingDate: '2026-01-10' });
    await breed(client, a.id, { breedingDate: '2026-05-20' }); // rebred recently
    await breed(client, b.id, { breedingDate: '2025-04-01' });
    await calve(client, b.id, { calvingDate: '2026-01-05' });
    assert.deepEqual(await tags(), []);
  });

  test("defaults to the server's date and lists only the user's own cows", async () => {
    const other = await signedIn('b@example.com');
    const theirs = await addCow(other, { tagNumber: 'THEIRS' });
    await breed(other, theirs.id, { breedingDate: '2025-01-01' });
    const mine = await addCow(client, { tagNumber: 'MINE' });
    await breed(client, mine.id, { breedingDate: '2025-01-01' });
    const body = await needsCheck(client);
    assert.equal(body.today, new Date().toISOString().slice(0, 10));
    assert.deepEqual(body.cows.map((c) => c.cattleTag), ['MINE']);
  });
});

describe('deleting animals and users', () => {
  test("deleting a cow deletes her breedings and checks and nobody else's", async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const other = await addCow(client, { tagNumber: 'COW-2' });
    await breed(client, cow.id);
    await check(client, cow.id);
    const kept = await breed(client, other.id);
    await client.delete(`/api/cattle/${cow.id}`).expect(200);
    assert.deepEqual((await client.get('/api/breedings')).body.map((e) => e.id), [kept.id]);
    assert.deepEqual((await client.get('/api/pregnancy-checks')).body, []);
  });

  test('deleting a user deletes their breedings and checks', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    await breed(client, cow.id);
    await check(client, cow.id);
    await pool.query('DELETE FROM users WHERE id = $1', [client.user.id]);
    assert.equal(await breedingCount(), 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM pregnancy_checks')).rows[0].n, 0);
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
    bobsEvent = await breed(bob, bobsCow.id, { ...FULL, breedingDate: '2025-01-01' });
  });

  const bobsData = async () => ({
    events: (await bob.get('/api/breedings').expect(200)).body,
    needs: (await needsCheck(bob, '2026-06-01')).cows,
    herd: await herd(bob),
  });

  for (const [who, options] of [['another user', {}], ['an admin', { role: 'admin' }]]) {
    test(`${who} cannot list, read, add, change or delete someone else's breedings`, async () => {
      const other = who === 'an admin' ? await signedIn('admin@example.com', options) : alice;
      const before = await bobsData();

      assert.deepEqual((await other.get('/api/breedings').expect(200)).body, []);
      assert.deepEqual((await needsCheck(other, '2026-06-01')).cows, []);
      assert.equal((await other.get(`/api/cattle/${bobsCow.id}/breedings`).expect(404)).body.error, 'Cattle not found');
      assert.equal((await other.post(`/api/cattle/${bobsCow.id}/breedings`).send(FULL).expect(404)).body.error, 'Cattle not found');
      const put = await other.put(`/api/breedings/${bobsEvent.id}`).send({ breedingDate: '2020-01-01', notes: 'changed' }).expect(404);
      assert.equal(put.body.error, 'Breeding record not found');
      assert.equal((await other.delete(`/api/breedings/${bobsEvent.id}`).expect(404)).body.error, 'Breeding record not found');

      assert.deepEqual(await bobsData(), before);
      assert.deepEqual(before.events, [bobsEvent]);
      assert.equal(before.needs.length, 1);
      assert.equal(before.herd[0].expectedCalvingDate, '2025-10-11');
      assert.equal(await breedingCount(), 1);
    });
  }

  test("a client cannot choose the owner, move an event to another cow, or use another herd's bull", async () => {
    const alicesCow = await addCow(alice, { tagNumber: 'ALICE-1' });
    const bobsBull = await addBull(bob);
    const created = await alice
      .post(`/api/cattle/${alicesCow.id}/breedings`)
      .send({ ...FULL, ownerId: bob.user.id, owner_id: bob.user.id, cattleId: bobsCow.id, cattle_id: bobsCow.id })
      .expect(201);
    assert.equal(created.body.cattleId, alicesCow.id);
    const { rows } = await pool.query('SELECT owner_id, cattle_id FROM breeding_events WHERE id = $1', [created.body.id]);
    assert.deepEqual(rows, [{ owner_id: alice.user.id, cattle_id: alicesCow.id }]);

    await alice.put(`/api/breedings/${created.body.id}`).send({ ...FULL, cattleId: bobsCow.id }).expect(200);
    await alice.put(`/api/breedings/${created.body.id}`).send({ ...FULL, sireCattleId: bobsBull.id }).expect(400);
    assert.deepEqual((await bob.get('/api/breedings')).body, [bobsEvent]);
  });

  test('after signing out, a session no longer reaches its own breedings', async () => {
    await bob.post('/api/auth/logout').expect(200);
    await bob.get('/api/breedings').expect(401);
    await bob.get('/api/breedings/needs-check').expect(401);
    await bob.get(`/api/cattle/${bobsCow.id}/breedings`).expect(401);
    await bob.delete(`/api/breedings/${bobsEvent.id}`).expect(401);
    assert.equal(await breedingCount(), 1);
  });
});

describe('demo herd', () => {
  test('comes with breedings and checks that match each expected calving date and status', async (t) => {
    process.env.DEMO_MODE = 'true';
    t.after(() => delete process.env.DEMO_MODE);
    const demo = agent();
    await demo.post('/api/auth/demo').expect(201);

    const events = (await demo.get('/api/breedings').expect(200)).body;
    const checks = (await demo.get('/api/pregnancy-checks').expect(200)).body;
    assert.ok(events.length >= 4, 'the Breeding page is not empty in demo mode');
    assert.ok(checks.length >= 3);
    const cows = await herd(demo);
    for (const cow of cows) {
      const mine = events.filter((e) => e.cattleId === cow.id && (!cow.lastCalvingDate || e.breedingDate > cow.lastCalvingDate));
      const newestCheck = checks.find((c) => c.cattleId === cow.id);
      if (!mine.length) {
        assert.equal(cow.expectedCalvingDate, '', `${cow.tagNumber} has an expected date but no breeding`);
        continue;
      }
      const open = newestCheck && newestCheck.checkDate >= mine[0].breedingDate && newestCheck.result === 'open';
      assert.equal(cow.expectedCalvingDate, open ? '' : mine[0].expectedCalvingDate, cow.tagNumber);
      if (newestCheck?.result === 'pregnant') assert.equal(cow.healthStatus, 'pregnant', cow.tagNumber);
    }
    for (const e of events.filter((x) => x.sireCattleId)) {
      assert.equal(cows.find((c) => c.id === e.sireCattleId).gender, 'male');
    }
    const needs = (await demo.get('/api/breedings/needs-check').expect(200)).body.cows;
    assert.ok(needs.length >= 1, 'the needs-check list is not empty in demo mode');
  });
});
