import { test, describe, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  WeightService,
  averageDailyGain,
  batchRows,
  changesSincePrevious,
  chartGeometry,
  daysBetween,
  filterWeighings,
  formatAdg,
  formatGain,
  formatWeight,
  gainSegments,
  isValidWeight,
  oldestFirst,
  validateWeighing,
  weighingPayload,
} from '../../src/services/WeightService.js';

const TODAY = '2026-06-15';

// One animal's history, newest first as the API returns it.
const DAISY = [
  { id: 'd3', cattleId: 'a', date: '2026-05-01', weight: 1300, createdAt: '2026-05-01T10:00:00Z' },
  { id: 'd2', cattleId: 'a', date: '2026-03-01', weight: 1240, createdAt: '2026-03-01T10:00:00Z' },
  { id: 'd1', cattleId: 'a', date: '2026-01-01', weight: 1180, createdAt: '2026-01-01T10:00:00Z' },
];

function stubFetch(status, body) {
  const fetchMock = mock.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }));
  mock.method(globalThis, 'fetch', fetchMock);
  return fetchMock;
}

afterEach(() => mock.restoreAll());

describe('weights', () => {
  test('isValidWeight: more than 0 and at most 5000, numbers or numeric strings', () => {
    for (const ok of [0.01, 1, '1200.5', 5000, '5000']) assert.equal(isValidWeight(ok), true, String(ok));
    for (const bad of [0, '0', -1, 5000.01, '', ' ', null, undefined, 'heavy', true, NaN, Infinity]) {
      assert.equal(isValidWeight(bad), false, String(bad));
    }
  });

  test('weighingPayload trims the text and turns the weight into a number', () => {
    assert.deepEqual(weighingPayload({ date: '2026-06-01', weight: ' 1200.5 ', notes: '  ok  ' }), { date: '2026-06-01', weight: 1200.5, notes: 'ok' });
    assert.deepEqual(weighingPayload({ date: '', weight: '', notes: undefined }), { date: '', weight: null, notes: '' });
  });

  test('validateWeighing checks the date, the weight and the notes', () => {
    const ok = { date: TODAY, weight: 900, notes: '' };
    assert.equal(validateWeighing(ok, TODAY), null);
    assert.equal(validateWeighing({ ...ok, date: '' }, TODAY), 'Enter the weighing date');
    assert.equal(validateWeighing({ ...ok, date: '2026-02-30' }, TODAY), 'Enter the weighing date');
    assert.equal(validateWeighing({ ...ok, date: '2026-06-16' }, TODAY), 'The weighing date cannot be in the future');
    assert.equal(validateWeighing({ ...ok, weight: null }, TODAY), 'Enter the weight');
    assert.match(validateWeighing({ ...ok, weight: 0 }, TODAY), /more than 0/);
    assert.match(validateWeighing({ ...ok, weight: 5001 }, TODAY), /at most 5000/);
    assert.equal(validateWeighing({ ...ok, notes: 'n'.repeat(2001) }, TODAY), 'Notes are too long');
  });

  test('formatting', () => {
    assert.equal(formatWeight(1234.5), '1,234.5 lbs');
    assert.equal(formatWeight(null), '—');
    assert.equal(formatGain(12.5), '+12.5 lbs');
    assert.equal(formatGain(-3), '−3 lbs');
    assert.equal(formatGain(0), '0 lbs');
    assert.equal(formatAdg(2.4137), '+2.41 lbs/day');
    assert.equal(formatAdg(-0.5), '−0.50 lbs/day');
    assert.equal(formatAdg(0.001), '0.00 lbs/day');
    assert.equal(formatAdg(null), '—');
  });
});

describe('average daily gain', () => {
  test('daysBetween counts calendar days, across a daylight-saving change and a leap day', () => {
    assert.equal(daysBetween('2026-01-01', '2026-03-01'), 59);
    assert.equal(daysBetween('2026-03-01', '2026-04-01'), 31);
    assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
    assert.equal(daysBetween('2026-05-01', '2026-01-01'), -120);
    assert.equal(daysBetween('nope', '2026-01-01'), null);
  });

  test('between the first and the last weighing: total gain over the days between them', () => {
    const adg = averageDailyGain(DAISY);
    assert.equal(adg.from.id, 'd1');
    assert.equal(adg.to.id, 'd3');
    assert.equal(adg.days, 120);
    assert.equal(adg.gain, 120);
    assert.equal(adg.adg, 1);
  });

  test('between consecutive weighings, oldest first', () => {
    const segments = gainSegments(DAISY);
    assert.deepEqual(segments.map((s) => [s.from.id, s.to.id, s.days, s.gain]), [['d1', 'd2', 59, 60], ['d2', 'd3', 61, 60]]);
    assert.ok(Math.abs(segments[0].adg - 60 / 59) < 1e-12);
    assert.ok(Math.abs(segments[1].adg - 60 / 61) < 1e-12);
  });

  test('a loss gives a negative gain; decimals are kept to the cent', () => {
    const [segment] = gainSegments([
      { id: 'b', date: '2026-01-11', weight: 1099.9 },
      { id: 'a', date: '2026-01-01', weight: 1120.15 },
    ]);
    assert.equal(segment.gain, -20.25);
    assert.equal(segment.adg, -2.025);
  });

  test('none with fewer than two weighings, or when all are on one day', () => {
    assert.equal(averageDailyGain([]), null);
    assert.equal(averageDailyGain([DAISY[0]]), null);
    const sameDay = [
      { id: 'x', date: '2026-01-01', weight: 900, createdAt: '2026-01-01T10:00:00Z' },
      { id: 'y', date: '2026-01-01', weight: 905, createdAt: '2026-01-01T11:00:00Z' },
    ];
    assert.equal(averageDailyGain(sameDay), null);
    const [segment] = gainSegments(sameDay);
    assert.equal(segment.days, 0);
    assert.equal(segment.gain, 5);
    assert.equal(segment.adg, null, 'no daily rate over zero days');
  });

  test('a same-day reweigh: overall ADG runs from the first to the last recorded', () => {
    const list = [
      { id: 'late', date: '2026-01-11', weight: 1010, createdAt: '2026-01-11T12:00:00Z' },
      { id: 'early', date: '2026-01-11', weight: 1000, createdAt: '2026-01-11T09:00:00Z' },
      { id: 'start', date: '2026-01-01', weight: 950, createdAt: '2026-01-01T09:00:00Z' },
    ];
    assert.deepEqual(oldestFirst(list).map((w) => w.id), ['start', 'early', 'late']);
    const adg = averageDailyGain(list);
    assert.equal(adg.to.id, 'late');
    assert.equal(adg.adg, 6);
  });

  test('changesSincePrevious works per animal in a mixed list', () => {
    const herd = [
      { id: 'b2', cattleId: 'b', date: '2026-05-10', weight: 700 },
      ...DAISY,
      { id: 'b1', cattleId: 'b', date: '2026-05-01', weight: 682 },
    ];
    const changes = changesSincePrevious(herd);
    assert.deepEqual([...changes.keys()].sort(), ['b2', 'd2', 'd3']);
    assert.equal(changes.get('b2').gain, 18);
    assert.equal(changes.get('b2').adg, 2);
    assert.equal(changes.get('d3').days, 61);
    assert.equal(changes.has('d1'), false, 'a first weighing has no change');
  });
});

describe('batch rows', () => {
  test('skips blank rows, sends the valid ones and reports the rest by position', () => {
    const { send, invalid } = batchRows([
      { cattleId: 'a', weight: '1200', notes: ' ok ' },
      { cattleId: '', weight: '', notes: '' },
      { cattleId: '', weight: '900', notes: '' },
      { cattleId: 'b', weight: '', notes: '' },
      { cattleId: 'c', weight: '0', notes: '' },
      { cattleId: 'a', weight: '1210', notes: '' },
      { cattleId: 'd', weight: '650.5', notes: '' },
      { cattleId: 'e', weight: '700', notes: 'n'.repeat(2001) },
    ]);
    assert.deepEqual(send, [
      { position: 0, cattleId: 'a', weight: 1200, notes: 'ok' },
      { position: 6, cattleId: 'd', weight: 650.5, notes: '' },
    ]);
    assert.deepEqual(invalid, [
      { position: 2, error: 'Choose an animal' },
      { position: 3, error: 'Enter the weight' },
      { position: 4, error: 'Weight must be more than 0 and at most 5000 lbs' },
      { position: 5, error: 'This animal is already in the batch' },
      { position: 7, error: 'Notes are too long' },
    ]);
  });
});

describe('filter and chart', () => {
  test('filterWeighings matches cow number, name and notes', () => {
    const list = [
      { id: '1', cattleTag: 'CT-001', cattleName: 'Daisy', notes: '' },
      { id: '2', cattleTag: 'CT-002', cattleName: 'Bess', notes: 'Weighed at the sale barn' },
    ];
    assert.deepEqual(filterWeighings(list, { query: 'daisy' }).map((w) => w.id), ['1']);
    assert.deepEqual(filterWeighings(list, { query: 'BARN' }).map((w) => w.id), ['2']);
    assert.deepEqual(filterWeighings(list, { query: 'ct-00' }).map((w) => w.id), ['1', '2']);
    assert.equal(filterWeighings(list, {}), list);
  });

  test('chartGeometry places points by date and weight inside the padding', () => {
    const g = chartGeometry(DAISY, { width: 600, height: 220, pad: { top: 10, right: 10, bottom: 10, left: 10 } });
    assert.deepEqual(g.points.map((p) => p.weighing.id), ['d1', 'd2', 'd3']);
    assert.equal(g.points[0].x, 10);
    assert.equal(g.points[2].x, 590);
    assert.equal(g.points[1].x, Math.round((10 + (59 / 120) * 580) * 100) / 100);
    assert.ok(g.points[0].y > g.points[2].y, 'heavier is higher');
    for (const p of g.points) assert.ok(p.y > 10 && p.y < 210);
    assert.ok(g.min < 1180 && g.max > 1300);
    assert.equal(g.yTicks.length, 3);
  });

  test('chartGeometry: none without weighings; one point or one day sits in the middle', () => {
    assert.equal(chartGeometry([]), null);
    const g = chartGeometry([DAISY[0]], { width: 200, height: 100, pad: { top: 0, right: 0, bottom: 0, left: 0 } });
    assert.equal(g.points[0].x, 100);
    assert.equal(g.points[0].y, 50);
  });
});

describe('WeightService requests', () => {
  test('loadAll keeps the herd list', async () => {
    const fetchMock = stubFetch(200, DAISY);
    const service = new WeightService();
    assert.deepEqual(await service.loadAll(), DAISY);
    assert.equal(service.weighings, DAISY);
    assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/weighings');
  });

  test('each call sends the right method, URL and body', async () => {
    const fetchMock = stubFetch(200, {});
    const service = new WeightService();
    const data = { date: TODAY, weight: 900, notes: '' };
    await service.loadForCattle('a/b');
    await service.add('a/b', data);
    await service.update('w1', data);
    await service.remove('w1');
    await service.saveBatch(TODAY, [{ cattleId: 'a', weight: 900, notes: '' }]);
    const calls = fetchMock.mock.calls.map((c) => [c.arguments[0], c.arguments[1].method || 'GET', c.arguments[1].body && JSON.parse(c.arguments[1].body)]);
    assert.deepEqual(calls, [
      ['/api/cattle/a%2Fb/weighings', 'GET', undefined],
      ['/api/cattle/a%2Fb/weighings', 'POST', data],
      ['/api/weighings/w1', 'PUT', data],
      ['/api/weighings/w1', 'DELETE', undefined],
      ['/api/weighings/batch', 'POST', { date: TODAY, rows: [{ cattleId: 'a', weight: 900, notes: '' }] }],
    ]);
  });

  test("a failed request raises the server's message with its status", async () => {
    stubFetch(400, { error: 'Invalid weight' });
    await assert.rejects(new WeightService().add('a', {}), (err) => err.message === 'Invalid weight' && err.status === 400);
  });
});
