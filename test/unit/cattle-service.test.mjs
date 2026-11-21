import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CattleService } from '../../src/services/CattleService.js';
import { Cattle } from '../../src/models/Cattle.js';

// Local noon on 15 June 2026.
const NOW = new Date(2026, 5, 15, 12, 0, 0);

const HERD = [
  { id: 'a', tagNumber: 'CT-001', nameBreed: 'Daisy Holstein', gender: 'female', healthStatus: 'healthy', medications: 'Vitamin B12', notes: 'High milk producer', expectedCalvingDate: '2026-06-30' },
  { id: 'b', tagNumber: 'CT-002', nameBreed: 'Bessie Jersey', gender: 'female', healthStatus: 'pregnant', medications: '', notes: 'Move to the calving pen', expectedCalvingDate: '2026-06-15' },
  { id: 'c', tagNumber: 'CT-003', nameBreed: 'Bull Maximus', gender: 'male', healthStatus: 'healthy', medications: 'Vaccination', notes: 'Herd sire' },
  { id: 'd', tagNumber: 'CT-004', nameBreed: 'Clover Angus', gender: 'female', healthStatus: 'under_treatment', medications: 'Anti-inflammatory', notes: 'Mild lameness', expectedCalvingDate: '2026-07-01' },
  { id: 'e', tagNumber: 'ct-005', nameBreed: 'Buttercup Jersey', gender: 'female', healthStatus: 'quarantine', medications: 'Antibiotics', notes: '', expectedCalvingDate: '2026-06-01' },
  { id: 'f', tagNumber: 'CT-006', nameBreed: '', gender: 'female', healthStatus: 'healthy', expectedCalvingDate: '2025-06-20' },
];

function serviceWith(rows = HERD) {
  const service = new CattleService();
  service.cattle = rows.map((row) => new Cattle(row));
  return service;
}

const tags = (list) => list.map((c) => c.tagNumber);

// Replaces global fetch with a stub that answers with the given status and JSON body.
function stubFetch(status, body) {
  const fetchMock = mock.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (body === undefined) throw new SyntaxError('no body');
      return body;
    },
  }));
  mock.method(globalThis, 'fetch', fetchMock);
  return fetchMock;
}

afterEach(() => mock.restoreAll());

describe('getStatistics', () => {
  beforeEach(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
  afterEach(() => mock.timers.reset());

  test('is all zeros for an empty herd', () => {
    assert.deepEqual(serviceWith([]).getStatistics(), {
      total: 0,
      healthy: 0,
      calvingThisMonth: 0,
      scheduledTreatments: 0,
    });
  });

  test('counts the herd, healthy animals and animals under treatment', () => {
    const stats = serviceWith().getStatistics();
    assert.equal(stats.total, 6);
    assert.equal(stats.healthy, 3);
    assert.equal(stats.scheduledTreatments, 1);
  });

  test('counts expected calvings in the current month and year only', () => {
    // June 2026: CT-001 (30th), CT-002 (15th), ct-005 (1st). Not July 2026, not June 2025.
    assert.equal(serviceWith().getStatistics().calvingThisMonth, 3);
  });

  test('counts the first and last day of the month whatever the time zone', () => {
    const service = serviceWith([
      { id: '1', tagNumber: 'A', expectedCalvingDate: '2026-06-01' },
      { id: '2', tagNumber: 'B', expectedCalvingDate: '2026-06-30' },
      { id: '3', tagNumber: 'C', expectedCalvingDate: '2026-05-31' },
      { id: '4', tagNumber: 'D', expectedCalvingDate: '2026-07-01' },
    ]);
    assert.equal(service.getStatistics().calvingThisMonth, 2);
  });

  test('ignores missing or malformed calving dates', () => {
    const service = serviceWith([
      { id: '1', tagNumber: 'A', expectedCalvingDate: '' },
      { id: '2', tagNumber: 'B', expectedCalvingDate: 'June 2026' },
      { id: '3', tagNumber: 'C' },
    ]);
    assert.equal(service.getStatistics().calvingThisMonth, 0);
  });
});

describe('searchCattle', () => {
  test('returns everything for an empty query', () => {
    assert.equal(serviceWith().searchCattle('').length, 6);
    assert.equal(serviceWith().searchCattle(undefined).length, 6);
    assert.equal(serviceWith().searchCattle('   ').length, 6);
  });

  test('matches the cow number, ignoring case', () => {
    assert.deepEqual(tags(serviceWith().searchCattle('ct-005')), ['ct-005']);
    assert.deepEqual(tags(serviceWith().searchCattle('CT-005')), ['ct-005']);
  });

  test('matches name/breed, medications and notes', () => {
    assert.deepEqual(tags(serviceWith().searchCattle('jersey')), ['CT-002', 'ct-005']);
    assert.deepEqual(tags(serviceWith().searchCattle('antibiotics')), ['ct-005']);
    assert.deepEqual(tags(serviceWith().searchCattle('calving pen')), ['CT-002']);
  });

  test('trims the query', () => {
    assert.deepEqual(tags(serviceWith().searchCattle('  maximus ')), ['CT-003']);
  });

  test('returns nothing when no field matches', () => {
    assert.deepEqual(serviceWith().searchCattle('zebra'), []);
  });

  test('filters by health status', () => {
    assert.deepEqual(tags(serviceWith().searchCattle('', 'healthy')), ['CT-001', 'CT-003', 'CT-006']);
    assert.deepEqual(tags(serviceWith().searchCattle('', 'quarantine')), ['ct-005']);
  });

  test('combines the query and the status filter', () => {
    assert.deepEqual(tags(serviceWith().searchCattle('jersey', 'pregnant')), ['CT-002']);
    assert.deepEqual(serviceWith().searchCattle('jersey', 'healthy'), []);
  });

  test('copes with records that have no name, medications or notes', () => {
    const service = serviceWith([{ id: '1', tagNumber: 'ONLY-TAG' }]);
    assert.deepEqual(tags(service.searchCattle('only')), ['ONLY-TAG']);
    assert.deepEqual(service.searchCattle('daisy'), []);
  });
});

describe('getUpcomingCalvings', () => {
  beforeEach(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
  afterEach(() => mock.timers.reset());

  test('lists calvings due today or later, soonest first', () => {
    assert.deepEqual(tags(serviceWith().getUpcomingCalvings()), ['CT-002', 'CT-001', 'CT-004']);
  });

  test('respects the limit', () => {
    assert.deepEqual(tags(serviceWith().getUpcomingCalvings(1)), ['CT-002']);
  });

  test('leaves out males', () => {
    const service = serviceWith([{ id: '1', tagNumber: 'BULL', gender: 'male', expectedCalvingDate: '2026-08-01' }]);
    assert.deepEqual(service.getUpcomingCalvings(), []);
  });
});

describe('lookups', () => {
  test('isDuplicateTag ignores case and spaces, and can exclude the record being edited', () => {
    const service = serviceWith();
    assert.equal(service.isDuplicateTag(' ct-001 '), true);
    assert.equal(service.isDuplicateTag('CT-005'), true);
    assert.equal(service.isDuplicateTag('CT-999'), false);
    assert.equal(service.isDuplicateTag('CT-001', 'a'), false);
    assert.equal(service.isDuplicateTag('CT-001', 'b'), true);
  });

  test('getCattleById returns the record or null', () => {
    const service = serviceWith();
    assert.equal(service.getCattleById('c').tagNumber, 'CT-003');
    assert.equal(service.getCattleById('missing'), null);
  });

  test('getRecentCattle returns the first records up to the limit', () => {
    assert.deepEqual(tags(serviceWith().getRecentCattle(2)), ['CT-001', 'CT-002']);
    assert.equal(serviceWith().getRecentCattle().length, 5);
  });

  test('getAllCattle returns a copy', () => {
    const service = serviceWith();
    service.getAllCattle().pop();
    assert.equal(service.cattle.length, 6);
  });
});

describe('API calls (fetch stubbed)', () => {
  test('loadData fetches /api/cattle and builds Cattle records', async () => {
    const fetchMock = stubFetch(200, [{ id: 'x', tagNumber: 'CT-9', healthStatus: 'pregnant' }]);
    const service = new CattleService();
    assert.equal(await service.loadData(), true);
    assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/cattle');
    assert.equal(fetchMock.mock.calls[0].arguments[1].credentials, 'same-origin');
    assert.ok(service.cattle[0] instanceof Cattle);
    assert.equal(service.cattle[0].healthStatus, 'pregnant');
  });

  test('addCattle posts the record with a numeric weight and puts it first', async () => {
    const fetchMock = stubFetch(201, { id: 'new', tagNumber: 'CT-9', weight: 1200.5 });
    const service = serviceWith();
    const created = await service.addCattle({ tagNumber: 'CT-9', weight: '1200.5' });

    const [url, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, '/api/cattle');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { tagNumber: 'CT-9', weight: 1200.5 });
    assert.equal(created.id, 'new');
    assert.equal(service.cattle[0], created);
    assert.equal(service.cattle.length, 7);
  });

  test('addCattle sends an empty weight as null', async () => {
    const fetchMock = stubFetch(201, { id: 'new', tagNumber: 'CT-9' });
    await serviceWith().addCattle({ tagNumber: 'CT-9', weight: '' });
    assert.equal(JSON.parse(fetchMock.mock.calls[0].arguments[1].body).weight, null);
  });

  test('addCattle rejects an invalid cow number or weight without calling the server', async () => {
    const fetchMock = stubFetch(201, {});
    const service = serviceWith();
    await assert.rejects(service.addCattle({ tagNumber: '  ' }), /Invalid cow number/);
    await assert.rejects(service.addCattle({ tagNumber: 'CT-9', weight: '6000' }), /Invalid weight/);
    await assert.rejects(service.addCattle({ tagNumber: 'CT-9', weight: '0' }), /Invalid weight/);
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal(service.cattle.length, 6);
  });

  test("a failed request raises the server's error message and changes nothing", async () => {
    stubFetch(409, { error: 'Duplicate cow number' });
    const service = serviceWith();
    await assert.rejects(service.addCattle({ tagNumber: 'CT-9' }), /Duplicate cow number/);
    assert.equal(service.cattle.length, 6);
  });

  test('a failed request without a JSON body raises a generic message', async () => {
    stubFetch(500, undefined);
    await assert.rejects(serviceWith().addCattle({ tagNumber: 'CT-9' }), /Request failed/);
  });

  test('updateCattle sends a PUT and applies the saved values', async () => {
    const fetchMock = stubFetch(200, { id: 'a', tagNumber: 'CT-001', nameBreed: 'Daisy II', healthStatus: 'pregnant' });
    const service = serviceWith();
    const updated = await service.updateCattle('a', { tagNumber: 'CT-001', nameBreed: 'Daisy II', weight: '' });

    const [url, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, '/api/cattle/a');
    assert.equal(options.method, 'PUT');
    assert.equal(updated.nameBreed, 'Daisy II');
    assert.equal(service.getCattleById('a').healthStatus, 'pregnant');
  });

  test('updateCattle rejects an unknown id without calling the server', async () => {
    const fetchMock = stubFetch(200, {});
    await assert.rejects(serviceWith().updateCattle('missing', { tagNumber: 'X' }), /Cattle not found/);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test('deleteCattle sends a DELETE and removes the record', async () => {
    const fetchMock = stubFetch(200, { ok: true });
    const service = serviceWith();
    assert.equal(await service.deleteCattle('c'), true);
    const [url, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, '/api/cattle/c');
    assert.equal(options.method, 'DELETE');
    assert.equal(service.getCattleById('c'), null);
    assert.equal(service.cattle.length, 5);
  });

  test('deleteCattle keeps the record when the server refuses', async () => {
    stubFetch(404, { error: 'Cattle not found' });
    const service = serviceWith();
    await assert.rejects(service.deleteCattle('c'), /Cattle not found/);
    assert.equal(service.cattle.length, 6);
  });

  test('a 401 sends the browser to the login page', async () => {
    stubFetch(401, { error: 'Authentication required' });
    const replace = mock.fn();
    globalThis.location = { replace };
    try {
      await assert.rejects(new CattleService().loadData(), (err) => err.sessionExpired === true && err.status === 401);
      assert.deepEqual(replace.mock.calls[0].arguments, ['/login.html']);
    } finally {
      delete globalThis.location;
    }
  });
});
