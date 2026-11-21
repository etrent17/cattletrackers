import { test, describe, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  BreedingService,
  addDays,
  breedingForCheck,
  breedingLabel,
  breedingPayload,
  checkPayload,
  filterRecords,
  herdBulls,
  sireLabel,
  validateBreeding,
  validateCheck,
} from '../../src/services/BreedingService.js';

const TODAY = '2026-06-15';

function stubFetch(status, body) {
  const fetchMock = mock.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }));
  mock.method(globalThis, 'fetch', fetchMock);
  return fetchMock;
}

afterEach(() => mock.restoreAll());

describe('addDays', () => {
  test('adds 283 days for the expected calving date', () => {
    assert.equal(addDays('2026-01-10', 283), '2026-10-20');
    assert.equal(addDays('2026-01-01', 283), '2026-10-11');
  });

  test('crosses month, year and leap-day boundaries', () => {
    assert.equal(addDays('2024-02-29', 283), '2024-12-08');
    assert.equal(addDays('2026-03-01', 283), '2026-12-09');
    assert.equal(addDays('2026-04-15', 283), '2027-01-23');
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
    assert.equal(addDays('2025-02-28', 1), '2025-03-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });

  test('goes back with a negative number and keeps the date for zero', () => {
    assert.equal(addDays('2026-06-01', -35), '2026-04-27');
    assert.equal(addDays('2026-06-01', 0), '2026-06-01');
  });

  test('is not shifted by daylight-saving changes (local calendar dates)', () => {
    // Spans the March and October/November clock changes in most time zones.
    assert.equal(addDays('2026-03-01', 30), '2026-03-31');
    assert.equal(addDays('2026-10-20', 14), '2026-11-03');
  });

  test('returns "" for something that is not a date', () => {
    assert.equal(addDays('', 283), '');
    assert.equal(addDays('2026-1-1', 283), '');
    assert.equal(addDays('2026-06-01', NaN), '');
  });
});

describe('labels', () => {
  test("sireLabel prefers the linked bull's current details, then the typed sire", () => {
    assert.equal(sireLabel({ sireCattleId: 'b', sireTag: 'BULL-9', sireName: 'Max II', sire: 'BULL-1 Maximus' }), 'BULL-9 Max II');
    assert.equal(sireLabel({ sireCattleId: 'b', sireTag: 'BULL-9', sireName: '', sire: 'x' }), 'BULL-9');
    assert.equal(sireLabel({ sireCattleId: null, sireTag: '', sire: 'BULL-1 Maximus' }), 'BULL-1 Maximus');
    assert.equal(sireLabel({ sire: '' }), '');
  });

  test('breedingLabel joins date, method and sire', () => {
    assert.equal(breedingLabel({ breedingDate: '2026-01-10', method: 'ai', sire: 'ABS 29JE4012' }), '2026-01-10 · AI · ABS 29JE4012');
    assert.equal(breedingLabel({ breedingDate: '2026-01-10', method: '', sire: '' }), '2026-01-10');
  });
});

describe('breeding form', () => {
  const FORM = { breedingDate: '2026-06-01', method: 'natural', sire: '  Angus AI ', sireCattleId: '', technician: ' J. Miller ', notes: ' ok ' };

  test('breedingPayload trims text; a herd bull replaces the typed sire', () => {
    assert.deepEqual(breedingPayload(FORM), {
      breedingDate: '2026-06-01', method: 'natural', sire: 'Angus AI', sireCattleId: null, technician: 'J. Miller', notes: 'ok',
    });
    assert.deepEqual(breedingPayload({ ...FORM, sireCattleId: 'bull-1' }).sire, '');
    assert.deepEqual(breedingPayload({ ...FORM, sireCattleId: 'bull-1' }).sireCattleId, 'bull-1');
    assert.deepEqual(breedingPayload({}), { breedingDate: '', method: '', sire: '', sireCattleId: null, technician: '', notes: '' });
  });

  test('validateBreeding checks the date and lengths', () => {
    const ok = breedingPayload(FORM);
    assert.equal(validateBreeding(ok, TODAY), null);
    assert.equal(validateBreeding({ ...ok, breedingDate: TODAY }, TODAY), null);
    assert.equal(validateBreeding({ ...ok, breedingDate: '' }, TODAY), 'Enter the breeding date');
    assert.equal(validateBreeding({ ...ok, breedingDate: '2026-06-16' }, TODAY), 'The breeding date cannot be in the future');
    assert.equal(validateBreeding({ ...ok, sire: 'x'.repeat(101) }, TODAY), 'The sire must be 100 characters or fewer');
    assert.equal(validateBreeding({ ...ok, technician: 'x'.repeat(101) }, TODAY), 'The technician must be 100 characters or fewer');
  });
});

describe('pregnancy check form', () => {
  test('checkPayload trims notes and sends an empty breeding as null', () => {
    assert.deepEqual(checkPayload({ checkDate: '2026-06-01', result: 'open', method: 'ultrasound', breedingId: '', notes: ' x ' }), {
      checkDate: '2026-06-01', result: 'open', method: 'ultrasound', breedingId: null, notes: 'x',
    });
    assert.equal(checkPayload({ breedingId: 'b1' }).breedingId, 'b1');
  });

  test('validateCheck needs a past date, a result, and a date not before the breeding', () => {
    const ok = checkPayload({ checkDate: '2026-06-01', result: 'pregnant' });
    assert.equal(validateCheck(ok, TODAY), null);
    assert.equal(validateCheck({ ...ok, checkDate: '' }, TODAY), 'Enter the check date');
    assert.equal(validateCheck({ ...ok, checkDate: '2026-06-16' }, TODAY), 'The check date cannot be in the future');
    assert.equal(validateCheck({ ...ok, result: '' }, TODAY), 'Choose a result: pregnant, open or unsure');
    assert.equal(validateCheck({ ...ok, result: 'maybe' }, TODAY), 'Choose a result: pregnant, open or unsure');
    assert.equal(validateCheck(ok, TODAY, '2026-06-02'), 'The check date cannot be before the breeding date');
    assert.equal(validateCheck(ok, TODAY, '2026-06-01'), null);
  });

  test('breedingForCheck picks the newest breeding on or before the check date', () => {
    const list = [
      { id: 'a', breedingDate: '2026-01-10' },
      { id: 'c', breedingDate: '2026-05-01' },
      { id: 'b', breedingDate: '2026-03-01' },
    ];
    assert.equal(breedingForCheck(list, '2026-04-01').id, 'b');
    assert.equal(breedingForCheck(list, '2026-05-01').id, 'c');
    assert.equal(breedingForCheck(list, '2025-12-31'), null);
    assert.equal(breedingForCheck(list, ''), null);
    assert.equal(breedingForCheck([], '2026-04-01'), null);
  });
});

describe('lists', () => {
  test('herdBulls keeps males only, by cow number', () => {
    const cattle = [
      { id: '1', tagNumber: 'B-10', gender: 'male' },
      { id: '2', tagNumber: 'C-1', gender: 'female' },
      { id: '3', tagNumber: 'B-9', gender: 'male' },
      { id: '4', tagNumber: 'X', gender: '' },
    ];
    assert.deepEqual(herdBulls(cattle).map((c) => c.tagNumber), ['B-9', 'B-10']);
  });

  test('filterRecords matches cow, sire, technician and notes, ignoring case', () => {
    const events = [
      { id: '1', cattleTag: 'CT-001', cattleName: 'Daisy', sire: 'ABS 29JE4012', technician: 'J. Miller', notes: '' },
      { id: '2', cattleTag: 'CT-002', cattleName: 'Bess', sireCattleId: 'b', sireTag: 'BULL-1', sireName: 'Max', sire: 'old', notes: 'Pasture bred' },
      { id: '3', cattleTag: 'CT-003', cattleName: '', notes: '' },
    ];
    const ids = (q) => filterRecords(events, q).map((e) => e.id);
    assert.deepEqual(ids(''), ['1', '2', '3']);
    assert.deepEqual(ids('daisy'), ['1']);
    assert.deepEqual(ids('max'), ['2']);
    assert.deepEqual(ids('miller'), ['1']);
    assert.deepEqual(ids('PASTURE'), ['2']);
    assert.deepEqual(ids('ct-003'), ['3']);
    assert.deepEqual(ids('nothing'), []);
  });
});

describe('BreedingService requests', () => {
  const lastCall = (fetchMock) => {
    const [url, options = {}] = fetchMock.mock.calls.at(-1).arguments;
    return { url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined };
  };

  test('loadNeedsCheck sends the local date and keeps the server constants', async () => {
    const fetchMock = stubFetch(200, { today: TODAY, checkAfterDays: 35, gestationDays: 283, cows: [{ id: 'x' }] });
    const service = new BreedingService();
    await service.loadNeedsCheck(TODAY);
    assert.deepEqual(lastCall(fetchMock), { url: `/api/breedings/needs-check?today=${TODAY}`, method: 'GET', body: undefined });
    assert.equal(service.gestationDays, 283);
    assert.equal(service.checkAfterDays, 35);
    assert.deepEqual(service.needsCheck, [{ id: 'x' }]);
  });

  test('loadAll fetches breedings, checks and the needs-check list', async () => {
    const fetchMock = mock.fn(async (url) => ({
      status: 200,
      ok: true,
      json: async () => (url.startsWith('/api/breedings/needs-check') ? { cows: [], checkAfterDays: 35, gestationDays: 283 } : [{ url }]),
    }));
    mock.method(globalThis, 'fetch', fetchMock);
    const service = new BreedingService();
    await service.loadAll(TODAY);
    assert.deepEqual(service.breedings, [{ url: '/api/breedings' }]);
    assert.deepEqual(service.checks, [{ url: '/api/pregnancy-checks' }]);
    assert.equal(fetchMock.mock.calls.length, 3);
  });

  test('each call uses the right method and URL', async () => {
    const fetchMock = stubFetch(200, {});
    const service = new BreedingService();
    const cases = [
      [() => service.loadBreedingsFor('c/1'), { url: '/api/cattle/c%2F1/breedings', method: 'GET', body: undefined }],
      [() => service.loadChecksFor('c1'), { url: '/api/cattle/c1/pregnancy-checks', method: 'GET', body: undefined }],
      [() => service.addBreeding('c1', { breedingDate: TODAY }), { url: '/api/cattle/c1/breedings', method: 'POST', body: { breedingDate: TODAY } }],
      [() => service.updateBreeding('b1', { breedingDate: TODAY }), { url: '/api/breedings/b1', method: 'PUT', body: { breedingDate: TODAY } }],
      [() => service.removeBreeding('b1'), { url: '/api/breedings/b1', method: 'DELETE', body: undefined }],
      [() => service.addCheck('c1', { result: 'open' }), { url: '/api/cattle/c1/pregnancy-checks', method: 'POST', body: { result: 'open' } }],
      [() => service.updateCheck('p1', { result: 'open' }), { url: '/api/pregnancy-checks/p1', method: 'PUT', body: { result: 'open' } }],
      [() => service.removeCheck('p1'), { url: '/api/pregnancy-checks/p1', method: 'DELETE', body: undefined }],
    ];
    for (const [call, expected] of cases) {
      await call();
      assert.deepEqual(lastCall(fetchMock), expected);
    }
  });

  test('a server error is thrown with its message and status', async () => {
    stubFetch(400, { error: 'Choose a bull from your herd' });
    await assert.rejects(new BreedingService().addBreeding('c1', {}), { message: 'Choose a bull from your herd', status: 400 });
  });
});
