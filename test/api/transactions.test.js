const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, agent, pool, signedIn, useDatabase } = require('../helpers/api');

useDatabase();

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const FEED = { date: '2026-03-10', kind: 'expense', category: 'Feed', amount: '125.50', description: 'Hay, 20 bales' };
const SALE = { date: '2026-03-20', kind: 'income', category: 'Sale of animals', amount: '1800.00' };

const add = (client, tx) => client.post('/api/transactions').send(tx).expect(201).then((r) => r.body);
const addCow = (client, tagNumber = 'CT-1') => client.post('/api/cattle').send({ tagNumber }).expect(201).then((r) => r.body);

describe('authentication', () => {
  for (const [method, path] of [
    ['get', '/api/transactions'],
    ['get', '/api/transactions/summary'],
    ['post', '/api/transactions'],
    ['put', `/api/transactions/${UNKNOWN_ID}`],
    ['delete', `/api/transactions/${UNKNOWN_ID}`],
  ]) {
    test(`${method.toUpperCase()} ${path} needs a session`, async () => {
      const res = await request(app)[method](path).send(FEED).expect(401);
      assert.equal(res.body.error, 'Authentication required');
    });
  }
});

describe('create, read, update, delete', () => {
  test('a new account has no transactions', async () => {
    const client = await signedIn('a@example.com');
    const res = await client.get('/api/transactions').expect(200);
    assert.deepEqual(res.body, []);
  });

  test('round-trips every field, with the amount as an exact string', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const created = await add(client, { ...FEED, cattleId: cow.id });
    const list = await client.get('/api/transactions').expect(200);
    assert.equal(list.body.length, 1);
    for (const t of [created, list.body[0]]) {
      assert.match(t.id, /^[0-9a-f-]{36}$/);
      assert.equal(t.date, '2026-03-10');
      assert.equal(t.kind, 'expense');
      assert.equal(t.category, 'Feed');
      assert.equal(t.amount, '125.50');
      assert.equal(t.description, 'Hay, 20 bales');
      assert.equal(t.cattleId, cow.id);
      assert.equal(t.cattleTagNumber, 'CT-1');
      assert.ok(t.createdAt && t.updatedAt);
    }
  });

  test('accepts a numeric amount and normalises it to two decimals', async () => {
    const client = await signedIn('a@example.com');
    assert.equal((await add(client, { ...FEED, amount: 7 })).amount, '7.00');
    assert.equal((await add(client, { ...FEED, amount: 0.1 })).amount, '0.10');
    assert.equal((await add(client, { ...FEED, amount: ' 12.3 ' })).amount, '12.30');
  });

  test('optional fields default to empty / null and the category is trimmed', async () => {
    const client = await signedIn('a@example.com');
    const t = await add(client, { date: '2026-01-01', kind: 'income', category: '  Milk  ', amount: '1', cattleId: '', description: '' });
    assert.equal(t.category, 'Milk');
    assert.equal(t.cattleId, null);
    assert.equal(t.cattleTagNumber, null);
    assert.equal(t.description, '');
  });

  test('lists newest date first', async () => {
    const client = await signedIn('a@example.com');
    await add(client, { ...FEED, date: '2026-02-01' });
    await add(client, { ...FEED, date: '2026-04-01' });
    await add(client, { ...FEED, date: '2026-03-01' });
    const res = await client.get('/api/transactions').expect(200);
    assert.deepEqual(res.body.map((t) => t.date), ['2026-04-01', '2026-03-01', '2026-02-01']);
  });

  test('update replaces the record', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const t = await add(client, { ...FEED, cattleId: cow.id });
    const res = await client.put(`/api/transactions/${t.id}`).send({ ...SALE, amount: '99.99' }).expect(200);
    assert.equal(res.body.id, t.id);
    assert.equal(res.body.kind, 'income');
    assert.equal(res.body.amount, '99.99');
    assert.equal(res.body.cattleId, null, 'a field left out is cleared');
    assert.equal(res.body.description, '');
    const list = await client.get('/api/transactions');
    assert.equal(list.body[0].category, 'Sale of animals');
  });

  test('update and delete of an unknown id return 404', async () => {
    const client = await signedIn('a@example.com');
    await client.put(`/api/transactions/${UNKNOWN_ID}`).send(FEED).expect(404);
    await client.delete(`/api/transactions/${UNKNOWN_ID}`).expect(404);
    await client.delete('/api/transactions/not-a-uuid').expect(400);
  });

  test('delete removes the record', async () => {
    const client = await signedIn('a@example.com');
    const t = await add(client, FEED);
    await client.delete(`/api/transactions/${t.id}`).expect(200);
    assert.deepEqual((await client.get('/api/transactions')).body, []);
    await client.delete(`/api/transactions/${t.id}`).expect(404);
  });
});

describe('validation', () => {
  const invalid = [
    ['zero amount', { amount: '0' }, /Amount/],
    ['zero amount with decimals', { amount: '0.00' }, /Amount/],
    ['negative amount', { amount: '-5' }, /Amount/],
    ['negative numeric amount', { amount: -5 }, /Amount/],
    ['three decimal places', { amount: '1.005' }, /Amount/],
    ['too large for NUMERIC(12,2)', { amount: '12345678901.00' }, /Amount/],
    ['exponent notation', { amount: '1e3' }, /Amount/],
    ['not a number', { amount: 'abc' }, /Amount/],
    ['missing amount', { amount: undefined }, /amount/i],
    ['boolean amount', { amount: true }, /amount/i],
    ['unknown kind', { kind: 'transfer' }, /income or expense/],
    ['missing kind', { kind: undefined }, /income or expense/],
    ['missing date', { date: undefined }, /date/],
    ['impossible date', { date: '2026-02-30' }, /date/],
    ['date with a time', { date: '2026-02-03T10:00:00Z' }, /date/],
    ['not a date', { date: 'yesterday' }, /date/],
    ['empty category', { category: '   ' }, /Category/],
    ['missing category', { category: undefined }, /category/i],
    ['category over 50 characters', { category: 'x'.repeat(51) }, /Category/],
    ['description over 500 characters', { description: 'x'.repeat(501) }, /Description/],
    ['malformed animal id', { cattleId: 'cow-1' }, /Unknown animal/],
  ];
  for (const [name, patch, message] of invalid) {
    test(`rejects ${name}`, async () => {
      const client = await signedIn('a@example.com');
      const res = await client.post('/api/transactions').send({ ...FEED, ...patch }).expect(400);
      assert.match(res.body.error, message);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM transactions');
      assert.equal(rows[0].n, 0);
    });
  }

  test('accepts the boundaries', async () => {
    const client = await signedIn('a@example.com');
    assert.equal((await add(client, { ...FEED, amount: '0.01' })).amount, '0.01');
    assert.equal((await add(client, { ...FEED, amount: '9999999999.99' })).amount, '9999999999.99');
    assert.equal((await add(client, { ...FEED, category: 'x'.repeat(50) })).category.length, 50);
    assert.equal((await add(client, { ...FEED, description: 'x'.repeat(500) })).description.length, 500);
  });

  test('update validates too', async () => {
    const client = await signedIn('a@example.com');
    const t = await add(client, FEED);
    await client.put(`/api/transactions/${t.id}`).send({ ...FEED, amount: '0' }).expect(400);
    const list = await client.get('/api/transactions');
    assert.equal(list.body[0].amount, '125.50');
  });

  test('rejects bad query parameters', async () => {
    const client = await signedIn('a@example.com');
    await client.get('/api/transactions?from=2026-13-01').expect(400);
    await client.get('/api/transactions?to=soon').expect(400);
    await client.get('/api/transactions?from=2026-05-01&to=2026-04-01').expect(400);
    await client.get('/api/transactions?from=2026-01-01&from=2026-02-01').expect(400);
    await client.get('/api/transactions?cattleId=xyz').expect(400);
    await client.get('/api/transactions/summary?from=2026-02-30').expect(400);
  });
});

describe('owner isolation', () => {
  test('one user cannot see, change or delete another user\'s transactions', async () => {
    const alice = await signedIn('alice@example.com');
    const bob = await signedIn('bob@example.com');
    const t = await add(alice, FEED);

    assert.deepEqual((await bob.get('/api/transactions')).body, []);
    assert.equal((await bob.get('/api/transactions/summary')).body.count, 0);
    await bob.put(`/api/transactions/${t.id}`).send(SALE).expect(404);
    await bob.delete(`/api/transactions/${t.id}`).expect(404);

    const list = await alice.get('/api/transactions');
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].amount, '125.50');
  });

  test('a transaction cannot be linked to another user\'s animal', async () => {
    const alice = await signedIn('alice@example.com');
    const bob = await signedIn('bob@example.com');
    const bobsCow = await addCow(bob, 'BOB-1');

    const res = await alice.post('/api/transactions').send({ ...FEED, cattleId: bobsCow.id }).expect(400);
    assert.equal(res.body.error, 'Unknown animal');
    await alice.post('/api/transactions').send({ ...FEED, cattleId: UNKNOWN_ID }).expect(400);

    const t = await add(alice, FEED);
    await alice.put(`/api/transactions/${t.id}`).send({ ...FEED, cattleId: bobsCow.id }).expect(400);
    const { rows } = await pool.query('SELECT cattle_id FROM transactions');
    assert.deepEqual(rows, [{ cattle_id: null }]);
  });

  test('filtering by another user\'s animal returns nothing', async () => {
    const alice = await signedIn('alice@example.com');
    const bob = await signedIn('bob@example.com');
    const bobsCow = await addCow(bob, 'BOB-1');
    await add(bob, { ...FEED, cattleId: bobsCow.id });
    assert.deepEqual((await alice.get(`/api/transactions?cattleId=${bobsCow.id}`)).body, []);
  });
});

describe('filtering', () => {
  test('from and to are inclusive calendar dates', async () => {
    const client = await signedIn('a@example.com');
    for (const date of ['2026-01-31', '2026-02-01', '2026-02-28', '2026-03-01']) {
      await add(client, { ...FEED, date });
    }
    const dates = async (qs) => (await client.get(`/api/transactions${qs}`).expect(200)).body.map((t) => t.date);
    assert.deepEqual(await dates('?from=2026-02-01&to=2026-02-28'), ['2026-02-28', '2026-02-01']);
    assert.deepEqual(await dates('?from=2026-02-28'), ['2026-03-01', '2026-02-28']);
    assert.deepEqual(await dates('?to=2026-01-31'), ['2026-01-31']);
    assert.deepEqual(await dates('?from=&to='), ['2026-03-01', '2026-02-28', '2026-02-01', '2026-01-31']);
  });

  test('cattleId narrows the list to one animal', async () => {
    const client = await signedIn('a@example.com');
    const daisy = await addCow(client, 'DAISY');
    const max = await addCow(client, 'MAX');
    await add(client, { ...FEED, cattleId: daisy.id, description: 'daisy' });
    await add(client, { ...FEED, cattleId: max.id, description: 'max' });
    await add(client, { ...FEED, description: 'herd' });
    const res = await client.get(`/api/transactions?cattleId=${daisy.id}`).expect(200);
    assert.deepEqual(res.body.map((t) => t.description), ['daisy']);
  });
});

describe('summary', () => {
  test('an empty range has zero totals', async () => {
    const client = await signedIn('a@example.com');
    const res = await client.get('/api/transactions/summary').expect(200);
    assert.deepEqual(res.body, {
      from: null, to: null, count: 0, income: '0.00', expenses: '0.00', net: '0.00',
      herdSize: 0, costPerHead: null, byCategory: [], byMonth: [],
    });
  });

  test('sums exactly: 0.10 + 0.20 is 0.30', async () => {
    const client = await signedIn('a@example.com');
    await add(client, { ...SALE, amount: '0.10' });
    await add(client, { ...SALE, amount: '0.20' });
    await add(client, { ...FEED, amount: 0.1 });
    await add(client, { ...FEED, amount: 0.2 });
    await add(client, { ...FEED, amount: '0.30' });
    const { body } = await client.get('/api/transactions/summary').expect(200);
    assert.equal(body.income, '0.30');
    assert.equal(body.expenses, '0.60');
    assert.equal(body.net, '-0.30');
    assert.notEqual(0.1 + 0.2, 0.3, 'floating-point addition would drift here');
  });

  test('large sums do not lose cents', async () => {
    const client = await signedIn('a@example.com');
    for (let i = 0; i < 3; i++) await add(client, { ...SALE, amount: '9999999999.99' });
    await add(client, { ...SALE, amount: '0.01' });
    await add(client, { ...FEED, amount: '0.03' });
    const { body } = await client.get('/api/transactions/summary').expect(200);
    assert.equal(body.income, '29999999999.98');
    assert.equal(body.expenses, '0.03');
    assert.equal(body.net, '29999999999.95');
    assert.equal(body.byMonth[0].income, '29999999999.98');
  });

  test('totals by category, by month, net and cost per head match the range', async () => {
    const client = await signedIn('a@example.com');
    await addCow(client, 'CT-1');
    await addCow(client, 'CT-2');
    await addCow(client, 'CT-3');
    await add(client, { ...FEED, date: '2025-12-31', amount: '1000.00' }); // outside the range
    await add(client, { ...FEED, date: '2026-01-05', amount: '100.00' });
    await add(client, { ...FEED, date: '2026-02-10', amount: '50.25' });
    await add(client, { ...FEED, date: '2026-02-11', category: 'Vet and medicine', amount: '49.75' });
    await add(client, { ...SALE, date: '2026-02-20', amount: '1500.00' });
    await add(client, { ...SALE, date: '2026-03-31', category: 'Milk', amount: '210.40' });
    await add(client, { ...SALE, date: '2026-04-01', amount: '9999.00' }); // outside the range

    const { body } = await client.get('/api/transactions/summary?from=2026-01-01&to=2026-03-31').expect(200);
    assert.equal(body.from, '2026-01-01');
    assert.equal(body.to, '2026-03-31');
    assert.equal(body.count, 5);
    assert.equal(body.income, '1710.40');
    assert.equal(body.expenses, '200.00');
    assert.equal(body.net, '1510.40');
    assert.equal(body.herdSize, 3);
    assert.equal(body.costPerHead, '66.67'); // 200.00 / 3, rounded to the cent
    assert.deepEqual(body.byCategory, [
      { kind: 'income', category: 'Sale of animals', total: '1500.00', count: 1 },
      { kind: 'income', category: 'Milk', total: '210.40', count: 1 },
      { kind: 'expense', category: 'Feed', total: '150.25', count: 2 },
      { kind: 'expense', category: 'Vet and medicine', total: '49.75', count: 1 },
    ]);
    assert.deepEqual(body.byMonth, [
      { month: '2026-01', income: '0.00', expenses: '100.00', net: '-100.00' },
      { month: '2026-02', income: '1500.00', expenses: '100.00', net: '1400.00' },
      { month: '2026-03', income: '210.40', expenses: '0.00', net: '210.40' },
    ]);

    // The report totals equal the sum of the listed transactions for the same range (in cents).
    const list = (await client.get('/api/transactions?from=2026-01-01&to=2026-03-31')).body;
    const cents = (kind) => list.filter((t) => t.kind === kind).reduce((s, t) => s + Math.round(Number(t.amount) * 100), 0);
    assert.equal(cents('income'), 171040);
    assert.equal(cents('expense'), 20000);
  });

  test('cost per head is null without animals', async () => {
    const client = await signedIn('a@example.com');
    await add(client, FEED);
    const { body } = await client.get('/api/transactions/summary').expect(200);
    assert.equal(body.herdSize, 0);
    assert.equal(body.costPerHead, null);
  });
});

describe('deleting an animal', () => {
  test('keeps its transactions and clears the link', async () => {
    const client = await signedIn('a@example.com');
    const cow = await addCow(client);
    const t = await add(client, { ...FEED, cattleId: cow.id });
    await client.delete(`/api/cattle/${cow.id}`).expect(200);

    const list = await client.get('/api/transactions').expect(200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].id, t.id);
    assert.equal(list.body[0].cattleId, null);
    assert.equal(list.body[0].cattleTagNumber, null);
    assert.equal(list.body[0].amount, '125.50');
  });

  test('deleting the user deletes their transactions', async () => {
    const client = await signedIn('a@example.com');
    await add(client, FEED);
    await pool.query('DELETE FROM users WHERE id = $1', [client.user.id]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM transactions');
    assert.equal(rows[0].n, 0);
  });
});

describe('database constraints', () => {
  test('the table itself rejects a non-positive amount and an unknown kind', async () => {
    const client = await signedIn('a@example.com');
    const insert = (kind, amount) => pool.query(
      "INSERT INTO transactions (owner_id, date, kind, category, amount) VALUES ($1, '2026-01-01', $2, 'Feed', $3)",
      [client.user.id, kind, amount]
    );
    await assert.rejects(insert('expense', '0'), { code: '23514' });
    await assert.rejects(insert('expense', '-1'), { code: '23514' });
    await assert.rejects(insert('refund', '1'), { code: '23514' });
  });
});

describe('demo mode', () => {
  test('a demo account starts with sample transactions and is capped at 200', async (t) => {
    process.env.DEMO_MODE = 'true';
    t.after(() => delete process.env.DEMO_MODE);
    const client = agent();
    const demo = await client.post('/api/auth/demo').expect(201);

    const list = (await client.get('/api/transactions').expect(200)).body;
    assert.equal(list.length, 12);
    const linked = list.filter((tx) => tx.cattleId);
    assert.deepEqual(linked.map((tx) => tx.cattleTagNumber).sort(), ['CT-004', 'CT-005', 'CT-007']);

    const summary = (await client.get('/api/transactions/summary').expect(200)).body;
    assert.equal(summary.income, '10808.90');
    assert.equal(summary.expenses, '4690.64');
    assert.equal(summary.net, '6118.26');
    assert.equal(summary.herdSize, 8);
    assert.equal(summary.costPerHead, '586.33');

    await pool.query(
      `INSERT INTO transactions (owner_id, date, kind, category, amount)
       SELECT $1, '2026-01-01', 'expense', 'Feed', 1 FROM generate_series(1, 188)`,
      [demo.body.user.id]
    );
    const res = await client.post('/api/transactions').send(FEED).expect(403);
    assert.equal(res.body.error, 'Demo accounts are limited to 200 transactions.');
  });
});
