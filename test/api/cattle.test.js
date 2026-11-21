const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, signedIn, useDatabase } = require('../helpers/api');

useDatabase();

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const FULL = {
  tagNumber: 'CT-100',
  nameBreed: 'Daisy Holstein',
  gender: 'female',
  birthDate: '2021-03-01',
  weight: 1380.5,
  lastCalvingDate: '2025-09-15',
  expectedCalvingDate: '2026-12-01',
  medications: 'Vitamin B12',
  healthStatus: 'pregnant',
  notes: 'Due for a hoof trim.',
};

describe('authentication', () => {
  for (const [method, path] of [
    ['get', '/api/cattle'],
    ['post', '/api/cattle'],
    ['put', `/api/cattle/${UNKNOWN_ID}`],
    ['delete', `/api/cattle/${UNKNOWN_ID}`],
  ]) {
    test(`${method.toUpperCase()} ${path} needs a session`, async () => {
      const res = await request(app)[method](path).send({ tagNumber: 'CT-1' }).expect(401);
      assert.equal(res.body.error, 'Authentication required');
    });
  }
});

describe('create and read', () => {
  test('a new account has no cattle', async () => {
    const client = await signedIn('a@example.com');
    const res = await client.get('/api/cattle').expect(200);
    assert.deepEqual(res.body, []);
  });

  test('saves a record with only a cow number', async () => {
    const client = await signedIn('a@example.com');
    const res = await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201);
    assert.match(res.body.id, /^[0-9a-f-]{36}$/);
    assert.equal(res.body.tagNumber, 'CT-1');
    assert.equal(res.body.healthStatus, 'healthy');
    assert.equal(res.body.weight, null);
    assert.equal(res.body.nameBreed, '');
    assert.equal(res.body.gender, '');
    assert.equal(res.body.birthDate, '');
  });

  test('round-trips every field, with dates as YYYY-MM-DD and weight as a number', async () => {
    const client = await signedIn('a@example.com');
    const created = await client.post('/api/cattle').send(FULL).expect(201);
    const list = await client.get('/api/cattle').expect(200);
    assert.equal(list.body.length, 1);
    for (const record of [created.body, list.body[0]]) {
      const { id, createdAt, updatedAt, withdrawalUntil, ...rest } = record;
      assert.deepEqual(rest, FULL);
      assert.equal(withdrawalUntil, '', 'no treatments, no withdrawal period');
      assert.ok(id && createdAt && updatedAt);
    }
  });

  test('treats empty strings from the form as "not set"', async () => {
    const client = await signedIn('a@example.com');
    const res = await client
      .post('/api/cattle')
      .send({ tagNumber: 'CT-1', nameBreed: '', gender: '', birthDate: '', weight: null, healthStatus: '', notes: '' })
      .expect(201);
    assert.equal(res.body.birthDate, '');
    assert.equal(res.body.weight, null);
    assert.equal(res.body.healthStatus, 'healthy');
  });

  test('trims the cow number', async () => {
    const client = await signedIn('a@example.com');
    const res = await client.post('/api/cattle').send({ tagNumber: '  CT-1  ' }).expect(201);
    assert.equal(res.body.tagNumber, 'CT-1');
  });

  test('lists newest first', async () => {
    const client = await signedIn('a@example.com');
    for (const tagNumber of ['CT-1', 'CT-2', 'CT-3']) {
      await client.post('/api/cattle').send({ tagNumber }).expect(201);
    }
    const res = await client.get('/api/cattle').expect(200);
    assert.deepEqual(res.body.map((c) => c.tagNumber), ['CT-3', 'CT-2', 'CT-1']);
  });
});

describe('update', () => {
  test('changes a record and keeps the change', async () => {
    const client = await signedIn('a@example.com');
    const { body: cow } = await client.post('/api/cattle').send(FULL).expect(201);
    const res = await client
      .put(`/api/cattle/${cow.id}`)
      .send({ ...FULL, nameBreed: 'Daisy II', weight: 1400, healthStatus: 'healthy' })
      .expect(200);
    assert.equal(res.body.id, cow.id);
    assert.equal(res.body.nameBreed, 'Daisy II');
    assert.equal(res.body.weight, 1400);

    const list = await client.get('/api/cattle');
    assert.equal(list.body[0].nameBreed, 'Daisy II');
    assert.equal(list.body[0].healthStatus, 'healthy');
  });

  test('replaces the whole record: fields left out are cleared', async () => {
    const client = await signedIn('a@example.com');
    const { body: cow } = await client.post('/api/cattle').send(FULL).expect(201);
    const res = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-100' }).expect(200);
    assert.equal(res.body.nameBreed, '');
    assert.equal(res.body.healthStatus, 'healthy');
    // Except the weight, which follows the weighings (test/api/weighings.test.js): leaving it out
    // records nothing and keeps the latest weighing.
    assert.equal(res.body.weight, FULL.weight);
  });

  test('can keep its own cow number, in a different case', async () => {
    const client = await signedIn('a@example.com');
    const { body: cow } = await client.post('/api/cattle').send({ tagNumber: 'ct-1' }).expect(201);
    const res = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1' }).expect(200);
    assert.equal(res.body.tagNumber, 'CT-1');
  });

  test('returns 404 for an unknown id', async () => {
    const client = await signedIn('a@example.com');
    const res = await client.put(`/api/cattle/${UNKNOWN_ID}`).send({ tagNumber: 'CT-1' }).expect(404);
    assert.equal(res.body.error, 'Cattle not found');
  });

  test('returns 400 for an id that is not a UUID', async () => {
    const client = await signedIn('a@example.com');
    await client.put('/api/cattle/42').send({ tagNumber: 'CT-1' }).expect(400);
  });
});

describe('delete', () => {
  test('removes the record', async () => {
    const client = await signedIn('a@example.com');
    const { body: keep } = await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201);
    const { body: gone } = await client.post('/api/cattle').send({ tagNumber: 'CT-2' }).expect(201);
    const res = await client.delete(`/api/cattle/${gone.id}`).expect(200);
    assert.deepEqual(res.body, { ok: true });
    const list = await client.get('/api/cattle');
    assert.deepEqual(list.body.map((c) => c.id), [keep.id]);
  });

  test('returns 404 the second time', async () => {
    const client = await signedIn('a@example.com');
    const { body: cow } = await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201);
    await client.delete(`/api/cattle/${cow.id}`).expect(200);
    await client.delete(`/api/cattle/${cow.id}`).expect(404);
  });

  test('returns 400 for an id that is not a UUID', async () => {
    const client = await signedIn('a@example.com');
    await client.delete('/api/cattle/not-a-uuid').expect(400);
  });

  test('frees the cow number for reuse', async () => {
    const client = await signedIn('a@example.com');
    const { body: cow } = await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201);
    await client.delete(`/api/cattle/${cow.id}`).expect(200);
    await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201);
  });
});

describe('duplicate cow numbers', () => {
  test('rejects the same number', async () => {
    const client = await signedIn('a@example.com');
    await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201);
    const res = await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(409);
    assert.equal(res.body.error, 'Duplicate cow number');
  });

  test('rejects the same number in a different case', async () => {
    const client = await signedIn('a@example.com');
    await client.post('/api/cattle').send({ tagNumber: 'ct-1' }).expect(201);
    await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(409);
    const list = await client.get('/api/cattle');
    assert.equal(list.body.length, 1);
  });

  test('rejects the same number with extra spaces', async () => {
    const client = await signedIn('a@example.com');
    await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201);
    await client.post('/api/cattle').send({ tagNumber: ' CT-1 ' }).expect(409);
  });

  test('rejects renaming a record to a number already in use', async () => {
    const client = await signedIn('a@example.com');
    await client.post('/api/cattle').send({ tagNumber: 'CT-1' }).expect(201);
    const { body: second } = await client.post('/api/cattle').send({ tagNumber: 'CT-2' }).expect(201);
    const res = await client.put(`/api/cattle/${second.id}`).send({ tagNumber: 'ct-1' }).expect(409);
    assert.equal(res.body.error, 'Duplicate cow number');
  });
});

describe('validation', () => {
  const invalid = [
    ['a missing cow number', {}, 'Invalid value'],
    ['an empty cow number', { tagNumber: '' }, 'Invalid cow number'],
    ['a blank cow number', { tagNumber: '   ' }, 'Invalid cow number'],
    ['a cow number over 25 characters', { tagNumber: 'X'.repeat(26) }, 'Invalid cow number'],
    ['a cow number that is not text', { tagNumber: 12345 }, 'Invalid value'],
    ['a negative weight', { tagNumber: 'CT-1', weight: -5 }, 'Invalid weight'],
    ['a weight over 5000', { tagNumber: 'CT-1', weight: 6000 }, 'Invalid weight'],
    ['a weight that is not a number', { tagNumber: 'CT-1', weight: 'heavy' }, 'Invalid weight'],
    ['an unknown gender', { tagNumber: 'CT-1', gender: 'cow' }, 'Invalid value'],
    ['an unknown health status', { tagNumber: 'CT-1', healthStatus: 'sick' }, 'Invalid value'],
    ['a birth date that is not a date', { tagNumber: 'CT-1', birthDate: 'yesterday' }, 'Invalid value'],
    ['an impossible calving date', { tagNumber: 'CT-1', expectedCalvingDate: '2026-02-30' }, 'Invalid value'],
    ['a name over 100 characters', { tagNumber: 'CT-1', nameBreed: 'n'.repeat(101) }, 'Invalid value'],
    ['medications over 500 characters', { tagNumber: 'CT-1', medications: 'm'.repeat(501) }, 'Invalid value'],
    ['notes over 2000 characters', { tagNumber: 'CT-1', notes: 'n'.repeat(2001) }, 'Invalid value'],
  ];

  for (const [label, body, message] of invalid) {
    test(`create rejects ${label}`, async () => {
      const client = await signedIn('a@example.com');
      const res = await client.post('/api/cattle').send(body).expect(400);
      assert.equal(res.body.error, message);
      const list = await client.get('/api/cattle');
      assert.equal(list.body.length, 0);
    });
  }

  test('update applies the same rules and leaves the record unchanged', async () => {
    const client = await signedIn('a@example.com');
    const { body: cow } = await client.post('/api/cattle').send({ tagNumber: 'CT-1', weight: 900 }).expect(201);
    const res = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', weight: 6000 }).expect(400);
    assert.equal(res.body.error, 'Invalid weight');
    const list = await client.get('/api/cattle');
    assert.equal(list.body[0].weight, 900);
  });

  test('accepts the limits: 25-character number, weight 5000', async () => {
    const client = await signedIn('a@example.com');
    await client.post('/api/cattle').send({ tagNumber: 'X'.repeat(25), weight: 5000 }).expect(201);
  });

  // docs/api.md says weight must be greater than 0, and the form rejects 0
  // (test/unit/validators.test.mjs). The API used to skip the check for 0 (optional({ values:
  // 'falsy' })) and store it; see docs/known-issues.md.
  test('rejects a weight of 0', async () => {
    const client = await signedIn('a@example.com');
    for (const weight of [0, '0', '0.00', 0.001]) {
      const res = await client.post('/api/cattle').send({ tagNumber: 'CT-1', weight }).expect(400);
      assert.equal(res.body.error, 'Invalid weight', `weight ${JSON.stringify(weight)}`);
    }
    assert.equal((await client.get('/api/cattle')).body.length, 0);
  });

  test('update rejects a weight of 0 and keeps the record', async () => {
    const client = await signedIn('a@example.com');
    const { body: cow } = await client.post('/api/cattle').send({ tagNumber: 'CT-1', weight: 900 }).expect(201);
    const res = await client.put(`/api/cattle/${cow.id}`).send({ tagNumber: 'CT-1', weight: 0 }).expect(400);
    assert.equal(res.body.error, 'Invalid weight');
    assert.equal((await client.get('/api/cattle')).body[0].weight, 900);
  });

  test('an empty string, null or a missing weight still means "no weight"', async () => {
    const client = await signedIn('a@example.com');
    for (const [tagNumber, extra] of [['CT-1', { weight: '' }], ['CT-2', { weight: null }], ['CT-3', {}]]) {
      const res = await client.post('/api/cattle').send({ tagNumber, ...extra }).expect(201);
      assert.equal(res.body.weight, null, tagNumber);
    }
  });

  test('rejects a weight that is not a number or a numeric string', async () => {
    const client = await signedIn('a@example.com');
    for (const weight of [true, false, [], {}, ' ', '12kg']) {
      const res = await client.post('/api/cattle').send({ tagNumber: 'CT-1', weight }).expect(400);
      assert.equal(res.body.error, 'Invalid weight', `weight ${JSON.stringify(weight)}`);
    }
  });

  test('malformed JSON is a 400, not a server error', async () => {
    const client = await signedIn('a@example.com');
    const res = await client
      .post('/api/cattle')
      .set('Content-Type', 'application/json')
      .send('{"tagNumber": ')
      .expect(400);
    assert.equal(res.body.error, 'Invalid request body');
    const list = await client.get('/api/cattle');
    assert.equal(list.body.length, 0);
  });

  test('a date with a time part is stored as the date', async () => {
    const client = await signedIn('a@example.com');
    const res = await client.post('/api/cattle').send({ tagNumber: 'CT-1', birthDate: '2024-05-06T10:30:00Z' }).expect(201);
    assert.equal(res.body.birthDate, '2024-05-06');
  });
});
