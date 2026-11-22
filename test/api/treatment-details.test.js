const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { signedIn, useDatabase, pool } = require('../helpers/api');
const { initTreatmentDetails } = require('../../lib/treatment-details');
useDatabase();
const BASE = { dateGiven: '2025-01-01', type: 'treatment' };
const DETAILS = { reason: 'Lameness', observations: 'Left rear leg', productLot: 'LOT-123',
  productExpiryDate: '2027-06-30', veterinarian: 'Dr. Smith',
  withdrawalSource: 'Recorded veterinary instructions', withdrawalNotes: 'Verify before movement' };
async function setup() {
  const client = await signedIn('details@example.com');
  const cow = (await client.post('/api/cattle').send({ tagNumber: 'DETAILS-1' }).expect(201)).body;
  return { client, cow };
}
const pick = (record) => Object.fromEntries(Object.keys(DETAILS).map((key) => [key, record[key]]));
describe('extended treatment details', () => {
  test('round trips all details and preserves them when an older client omits them', async () => {
    const { client, cow } = await setup();
    const created = (await client.post(`/api/cattle/${cow.id}/treatments`).send({ ...BASE, ...DETAILS }).expect(201)).body;
    assert.deepEqual(pick(created), DETAILS);
    const updated = (await client.put(`/api/treatments/${created.id}`).send({ ...BASE, notes: 'Changed' }).expect(200)).body;
    assert.deepEqual(pick(updated), DETAILS);
    const history = (await client.get(`/api/cattle/${cow.id}/treatments`).expect(200)).body;
    assert.deepEqual(pick(history[0]), DETAILS);
    const herd = (await client.get('/api/treatments').expect(200)).body;
    assert.deepEqual(pick(herd[0]), DETAILS);
  });
  test('trims details and allows explicit clearing', async () => {
    const { client, cow } = await setup();
    const created = (await client.post(`/api/cattle/${cow.id}/treatments`).send({ ...BASE, reason: '  Check leg  ' }).expect(201)).body;
    assert.equal(created.reason, 'Check leg');
    const cleared = (await client.put(`/api/treatments/${created.id}`).send({ ...BASE, reason: '', productExpiryDate: '' }).expect(200)).body;
    assert.equal(cleared.reason, undefined);
    assert.equal(cleared.productExpiryDate, undefined);
  });
  test('rejects malformed details without changing the record', async () => {
    const { client, cow } = await setup();
    const created = (await client.post(`/api/cattle/${cow.id}/treatments`).send({ ...BASE, ...DETAILS }).expect(201)).body;
    for (const invalid of [{ reason: 42 }, { reason: 'x'.repeat(501) }, { observations: 'x'.repeat(2001) },
      { productLot: 'x'.repeat(101) }, { veterinarian: 'x'.repeat(101) },
      { withdrawalSource: 'x'.repeat(501) }, { withdrawalNotes: 'x'.repeat(2001) },
      { productExpiryDate: '2025-02-30' }, { productExpiryDate: 'tomorrow' }]) {
      await client.put(`/api/treatments/${created.id}`).send({ ...BASE, ...invalid }).expect(400);
      await client.post(`/api/cattle/${cow.id}/treatments`).send({ ...BASE, ...invalid }).expect(400);
    }
    assert.deepEqual((await client.get('/api/treatments').expect(200)).body, [created]);
  });
  test('another owner cannot overwrite or read details', async () => {
    const { client, cow } = await setup();
    const created = (await client.post(`/api/cattle/${cow.id}/treatments`).send({ ...BASE, ...DETAILS }).expect(201)).body;
    const other = await signedIn('other-details@example.com');
    await other.put(`/api/treatments/${created.id}`).send({ ...BASE, reason: 'Changed' }).expect(404);
    await other.get(`/api/cattle/${cow.id}/treatments`).expect(404);
    assert.deepEqual((await other.get('/api/treatments').expect(200)).body, []);
    assert.deepEqual((await client.get('/api/treatments').expect(200)).body, [created]);
  });
  test('schema initialization can be repeated without losing details', async () => {
    const { client, cow } = await setup();
    const created = (await client.post(`/api/cattle/${cow.id}/treatments`).send({ ...BASE, ...DETAILS }).expect(201)).body;
    await initTreatmentDetails(pool);
    await initTreatmentDetails(pool);
    assert.deepEqual((await client.get('/api/treatments').expect(200)).body, [created]);
  });
});
