import { test, describe, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  CalvingService,
  calvingPayload,
  calvingYears,
  daysUntil,
  filterCalvings,
  validateCalving,
} from '../../src/services/CalvingService.js';

const TODAY = '2026-06-15';

const EVENTS = [
  { id: '1', cattleId: 'a', cattleTag: 'CT-001', cattleName: 'Daisy Holstein', calvingDate: '2026-04-10', calfTag: 'CT-021', outcome: 'alive', notes: 'Up and nursing' },
  { id: '2', cattleId: 'b', cattleTag: 'CT-002', cattleName: 'Bessie Jersey', calvingDate: '2025-09-01', calfTag: '', outcome: 'stillborn', notes: 'Vet attended' },
  { id: '3', cattleId: 'a', cattleTag: 'CT-001', cattleName: 'Daisy Holstein', calvingDate: '2025-03-20', calfTag: '', outcome: 'alive', notes: '' },
  { id: '4', cattleId: 'c', cattleTag: 'CT-003', cattleName: '', calvingDate: '2024-12-31', calfTag: '', outcome: '', notes: '' },
];
const ids = (list) => list.map((e) => e.id);

const FORM = {
  calvingDate: '2026-06-10',
  calfSex: 'female',
  calfTag: '  CALF-1 ',
  birthWeight: '82.5',
  ease: 'assisted',
  outcome: 'alive',
  notes: '  Light pull.  ',
  addCalf: true,
  clearExpected: false,
};

function stubFetch(status, body) {
  const fetchMock = mock.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }));
  mock.method(globalThis, 'fetch', fetchMock);
  return fetchMock;
}

afterEach(() => mock.restoreAll());

describe('calvingPayload', () => {
  test('trims text and turns the weight into a number', () => {
    assert.deepEqual(calvingPayload(FORM), {
      calvingDate: '2026-06-10',
      calfSex: 'female',
      calfTag: 'CALF-1',
      birthWeight: 82.5,
      ease: 'assisted',
      outcome: 'alive',
      notes: 'Light pull.',
      addCalf: true,
      clearExpected: false,
    });
  });

  test('an empty form gives empty strings, a null weight and false options', () => {
    assert.deepEqual(calvingPayload({}), {
      calvingDate: '', calfSex: '', calfTag: '', birthWeight: null, ease: '', outcome: '', notes: '',
      addCalf: false, clearExpected: false,
    });
    assert.equal(calvingPayload({ birthWeight: '  ' }).birthWeight, null);
  });

  test('a weight that is not a number becomes NaN, which validation rejects', () => {
    const data = calvingPayload({ ...FORM, birthWeight: 'heavy' });
    assert.ok(Number.isNaN(data.birthWeight));
    assert.equal(validateCalving(data, TODAY), 'Invalid birth weight');
  });
});

describe('validateCalving', () => {
  const check = (changes) => validateCalving({ ...calvingPayload(FORM), ...changes }, TODAY);

  test('accepts a complete record and one with only a date', () => {
    assert.equal(check({}), null);
    assert.equal(validateCalving(calvingPayload({ calvingDate: '2026-06-10' }), TODAY), null);
  });

  test('needs a real date that is not in the future', () => {
    assert.equal(check({ calvingDate: '' }), 'Enter the calving date');
    assert.equal(check({ calvingDate: 'June' }), 'Enter the calving date');
    assert.equal(check({ calvingDate: '2026-06-16' }), 'The calving date cannot be in the future');
    assert.equal(check({ calvingDate: TODAY }), null);
  });

  test('checks the birth weight range', () => {
    assert.equal(check({ birthWeight: 0 }), 'Invalid birth weight');
    assert.equal(check({ birthWeight: -3 }), 'Invalid birth weight');
    assert.equal(check({ birthWeight: 500.5 }), 'Invalid birth weight');
    assert.equal(check({ birthWeight: 500 }), null);
    assert.equal(check({ birthWeight: null }), null);
  });

  test('limits the calf number to 25 characters', () => {
    assert.equal(check({ calfTag: 'x'.repeat(26) }), 'Invalid calf number');
    assert.equal(check({ calfTag: 'x'.repeat(25) }), null);
  });

  test('adding the calf needs a calf number and a live calf', () => {
    assert.equal(check({ calfTag: '' }), 'Enter a calf number to add the calf as a new animal');
    assert.equal(check({ outcome: 'stillborn' }), 'A stillborn calf cannot be added as a new animal');
    assert.equal(check({ calfTag: '', addCalf: false }), null);
    assert.equal(check({ outcome: 'stillborn', addCalf: false }), null);
  });
});

describe('filterCalvings', () => {
  test('with no filters returns everything in the same order', () => {
    assert.deepEqual(ids(filterCalvings(EVENTS)), ['1', '2', '3', '4']);
    assert.deepEqual(ids(filterCalvings(EVENTS, { query: '  ', outcome: 'all', year: 'all' })), ['1', '2', '3', '4']);
  });

  test('searches cow number, cow name, calf number and notes, ignoring case', () => {
    assert.deepEqual(ids(filterCalvings(EVENTS, { query: 'ct-001' })), ['1', '3']);
    assert.deepEqual(ids(filterCalvings(EVENTS, { query: 'JERSEY' })), ['2']);
    assert.deepEqual(ids(filterCalvings(EVENTS, { query: 'ct-021' })), ['1']);
    assert.deepEqual(ids(filterCalvings(EVENTS, { query: 'vet' })), ['2']);
    assert.deepEqual(ids(filterCalvings(EVENTS, { query: 'nothing' })), []);
  });

  test('filters by outcome; an event with no outcome matches only "all"', () => {
    assert.deepEqual(ids(filterCalvings(EVENTS, { outcome: 'alive' })), ['1', '3']);
    assert.deepEqual(ids(filterCalvings(EVENTS, { outcome: 'stillborn' })), ['2']);
  });

  test('filters by calendar year', () => {
    assert.deepEqual(ids(filterCalvings(EVENTS, { year: '2025' })), ['2', '3']);
    assert.deepEqual(ids(filterCalvings(EVENTS, { year: '2024' })), ['4']);
    assert.deepEqual(ids(filterCalvings(EVENTS, { year: '2023' })), []);
  });

  test('combines filters', () => {
    assert.deepEqual(ids(filterCalvings(EVENTS, { query: 'daisy', outcome: 'alive', year: '2025' })), ['3']);
  });

  test('copes with missing optional fields and does not change the input', () => {
    const sparse = [{ id: '9', cattleTag: 'CT-9', calvingDate: '2026-01-01' }];
    assert.deepEqual(ids(filterCalvings(sparse, { query: 'ct-9' })), ['9']);
    assert.deepEqual(ids(filterCalvings(sparse, { query: 'notes' })), []);
    assert.equal(EVENTS.length, 4);
  });
});

describe('calvingYears', () => {
  test('lists each year once, newest first', () => {
    assert.deepEqual(calvingYears(EVENTS), ['2026', '2025', '2024']);
    assert.deepEqual(calvingYears([]), []);
  });
});

describe('daysUntil', () => {
  test('counts whole days from today', () => {
    assert.equal(daysUntil('2026-06-15', TODAY), 0);
    assert.equal(daysUntil('2026-06-16', TODAY), 1);
    assert.equal(daysUntil('2026-07-15', TODAY), 30);
    assert.equal(daysUntil('2026-06-01', TODAY), -14);
  });

  test('is not thrown off by a daylight-saving change', () => {
    assert.equal(daysUntil('2026-03-30', '2026-03-28'), 2);
    assert.equal(daysUntil('2026-11-02', '2026-10-31'), 2);
  });

  test('is null for something that is not a date', () => {
    assert.equal(daysUntil('', TODAY), null);
    assert.equal(daysUntil(null, TODAY), null);
    assert.equal(daysUntil('soon', TODAY), null);
  });
});

describe('API calls', () => {
  const call = (fetchMock) => {
    const [path, options] = fetchMock.mock.calls[0].arguments;
    return { path, method: options.method || 'GET', body: options.body && JSON.parse(options.body) };
  };

  test('loadAll fetches the herd-wide list and keeps it', async () => {
    const fetchMock = stubFetch(200, EVENTS);
    const service = new CalvingService();
    assert.deepEqual(await service.loadAll(), EVENTS);
    assert.deepEqual(service.events, EVENTS);
    assert.deepEqual(call(fetchMock), { path: '/api/calvings', method: 'GET', body: undefined });
  });

  test("loadForCattle fetches one animal's history without touching the herd-wide list", async () => {
    const fetchMock = stubFetch(200, [EVENTS[0]]);
    const service = new CalvingService();
    assert.deepEqual(await service.loadForCattle('cow/1'), [EVENTS[0]]);
    assert.deepEqual(service.events, []);
    assert.equal(call(fetchMock).path, '/api/cattle/cow%2F1/calvings');
  });

  test('add posts the whole payload under the cow', async () => {
    const fetchMock = stubFetch(201, { id: 'new', calf: null });
    const data = calvingPayload(FORM);
    assert.deepEqual(await new CalvingService().add('cow-1', data), { id: 'new', calf: null });
    assert.deepEqual(call(fetchMock), { path: '/api/cattle/cow-1/calvings', method: 'POST', body: data });
  });

  test('update sends the fields without the create-only options', async () => {
    const fetchMock = stubFetch(200, { id: 'e1' });
    await new CalvingService().update('e1', calvingPayload(FORM));
    const sent = call(fetchMock);
    assert.equal(sent.path, '/api/calvings/e1');
    assert.equal(sent.method, 'PUT');
    assert.equal('addCalf' in sent.body, false);
    assert.equal('clearExpected' in sent.body, false);
    assert.equal(sent.body.calfTag, 'CALF-1');
  });

  test('remove sends DELETE', async () => {
    const fetchMock = stubFetch(200, { ok: true });
    await new CalvingService().remove('e1');
    assert.deepEqual(call(fetchMock), { path: '/api/calvings/e1', method: 'DELETE', body: undefined });
  });

  test('a refused request rejects with the server message and status', async () => {
    stubFetch(409, { error: 'Duplicate cow number' });
    await assert.rejects(new CalvingService().add('cow-1', calvingPayload(FORM)), (err) => {
      assert.equal(err.message, 'Duplicate cow number');
      assert.equal(err.status, 409);
      return true;
    });
  });

  test('a failed load keeps the previous list', async () => {
    const service = new CalvingService();
    service.events = EVENTS;
    stubFetch(500, { error: 'Internal server error' });
    await assert.rejects(service.loadAll(), /Internal server error/);
    assert.deepEqual(service.events, EVENTS);
  });
});
