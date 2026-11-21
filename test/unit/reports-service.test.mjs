import { test, describe, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEALTH_TABLES,
  PERFORMANCE_TABLES,
  ReportsService,
  animalLabel,
  columnChart,
  csvFileName,
  daysLeftLabel,
  dueLabel,
  formatDays,
  formatPercent,
  labelIndexes,
  niceCeiling,
  periodLabel,
  plural,
  reportCsv,
  sharePercent,
} from '../../src/services/ReportsService.js';

afterEach(() => mock.restoreAll());

describe('API calls', () => {
  const calls = [];
  const stubFetch = () => {
    calls.length = 0;
    mock.method(globalThis, 'fetch', async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({}) };
    });
  };

  test("send the period and the user's date, leaving out an open end", async () => {
    stubFetch();
    const service = new ReportsService();
    await service.performance({ from: '2026-01-01', to: '2026-06-30' }, '2026-06-15');
    await service.health({ from: '', to: '2026-06-30' }, '2026-06-15');
    await service.health({}, '2026-06-15');
    assert.deepEqual(calls, [
      '/api/reports/performance?from=2026-01-01&to=2026-06-30&today=2026-06-15',
      '/api/reports/health?to=2026-06-30&today=2026-06-15',
      '/api/reports/health?today=2026-06-15',
    ]);
  });
});

describe('labels', () => {
  test('formatPercent and formatDays show a dash when there is no figure', () => {
    assert.equal(formatPercent(50), '50%');
    assert.equal(formatPercent(66.7), '66.7%');
    assert.equal(formatPercent(0), '0%');
    assert.equal(formatPercent(null), '—');
    assert.equal(formatPercent(undefined), '—');
    assert.equal(formatDays(345), '345 days');
    assert.equal(formatDays(1), '1 day');
    assert.equal(formatDays(1234.5), '1,234.5 days');
    assert.equal(formatDays(null), '—');
  });

  test('plural', () => {
    assert.equal(plural(1, 'animal'), '1 animal');
    assert.equal(plural(0, 'animal'), '0 animals');
    assert.equal(plural(2, 'calf', 'calves'), '2 calves');
  });

  test('periodLabel', () => {
    assert.equal(periodLabel({ preset: '12m', from: '2025-12-01', to: '2026-11-30' }), 'Last 12 months (2025-12-01 to 2026-11-30)');
    assert.equal(periodLabel({ preset: 'custom', from: '2026-01-01', to: '2026-06-30' }), '2026-01-01 to 2026-06-30');
    assert.equal(periodLabel({ preset: 'all', from: '', to: '' }), 'All time');
    assert.equal(periodLabel({ preset: 'custom', from: '2026-01-01', to: '' }), 'From 2026-01-01');
    assert.equal(periodLabel({ preset: 'custom', from: '', to: '2026-06-30' }), 'Up to 2026-06-30');
  });

  test('dueLabel and daysLeftLabel', () => {
    assert.equal(dueLabel(-5), '5 days overdue');
    assert.equal(dueLabel(-1), '1 day overdue');
    assert.equal(dueLabel(0), 'Due today');
    assert.equal(dueLabel(1), 'Due tomorrow');
    assert.equal(dueLabel(16), 'Due in 16 days');
    assert.equal(daysLeftLabel(0), 'Ends today');
    assert.equal(daysLeftLabel(1), '1 day left');
    assert.equal(daysLeftLabel(5), '5 days left');
  });

  test('animalLabel', () => {
    assert.equal(animalLabel({ cattleTag: 'A-1', cattleName: 'Daisy' }), 'A-1 – Daisy');
    assert.equal(animalLabel({ cattleTag: 'A-1', cattleName: '' }), 'A-1');
  });
});

describe('chart geometry', () => {
  test('sharePercent rounds and survives an empty whole', () => {
    assert.equal(sharePercent(1, 3), 33);
    assert.equal(sharePercent(2, 3), 67);
    assert.equal(sharePercent(3, 3), 100);
    assert.equal(sharePercent(0, 0), 0);
  });

  test('niceCeiling picks the next of 1, 2, 5, 10, ...', () => {
    assert.deepEqual([0, 1, 2, 3, 5, 6, 10, 11, 20, 21, 50, 51, 100, 480].map(niceCeiling), [1, 1, 2, 5, 5, 10, 10, 20, 20, 50, 50, 100, 100, 500]);
  });

  test('columnChart scales the columns to a round axis top and keeps them inside the plot', () => {
    const chart = columnChart([0, 5, 10], { width: 340, height: 140, left: 30, right: 10, top: 10, bottom: 30, maxBarWidth: 48 });
    assert.equal(chart.top, 10);
    assert.deepEqual(chart.plot, { left: 30, right: 330, top: 10, bottom: 110 });
    // Three 100-wide slots; columns are 48 wide (the cap), centred in their slot.
    assert.deepEqual(chart.bars.map((b) => [b.x, b.width]), [[56, 48], [156, 48], [256, 48]]);
    // Heights: 0, half and all of the 100-high plot, standing on the baseline (y = 110).
    assert.deepEqual(chart.bars.map((b) => [b.y, b.height]), [[110, 0], [60, 50], [10, 100]]);
  });

  test('columnChart narrows the columns when there are many, and handles none', () => {
    const many = columnChart(Array.from({ length: 120 }, (_, i) => i), { width: 640, left: 20, right: 20 });
    assert.equal(many.top, 200);
    const slot = 600 / 120;
    for (const bar of many.bars) {
      assert.ok(bar.width >= 1 && bar.width < slot);
      assert.ok(bar.x >= 20 && bar.x + bar.width <= 620);
    }
    assert.deepEqual(columnChart([]).bars, []);
    assert.equal(columnChart([0, 0]).top, 1);
  });

  test('labelIndexes keeps evenly spaced labels that end on the last column', () => {
    assert.deepEqual(labelIndexes(6, 8), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(labelIndexes(12, 8), [1, 3, 5, 7, 9, 11]);
    assert.deepEqual(labelIndexes(120, 8), [14, 29, 44, 59, 74, 89, 104, 119]);
    assert.deepEqual(labelIndexes(0, 8), []);
  });
});

describe('CSV', () => {
  test('reportCsv writes numbers as numbers and guards text', () => {
    const csv = reportCsv([
      ['Cow ID', 'Gain', 'Note'],
      ['A-1', -1.5, '=SUM(A1)'],
      ['-5 "old"', 0, null],
      ['x, y', 1000.25, undefined],
    ]);
    assert.equal(csv, 'Cow ID,Gain,Note\r\nA-1,-1.5,\'=SUM(A1)\r\n"\'-5 ""old""",0,\r\n"x, y",1000.25,\r\n');
  });

  test('csvFileName', () => {
    const today = '2026-06-15';
    assert.equal(csvFileName(PERFORMANCE_TABLES.herd, { from: '2026-01-01', to: '2026-06-30' }, today), 'herd-size-2026-01-01-to-2026-06-30.csv');
    assert.equal(csvFileName(PERFORMANCE_TABLES.gain, { from: '', to: '' }, today), 'daily-gain-by-animal-start-to-2026-06-15.csv');
    assert.equal(csvFileName(HEALTH_TABLES.withdrawal, { from: '2026-01-01', to: '2026-06-30' }, today), 'withdrawal-periods-2026-06-15.csv');
  });

  const performance = {
    herd: { size: 2, byMonth: [{ month: '2026-05', asOf: '2026-05-31', added: 1, size: 1 }, { month: '2026-06', asOf: '2026-06-15', added: 1, size: 2 }] },
    calvings: {
      count: 3, cowsCalved: 2, breedingFemales: 4, calvingRate: 50, averageBirthWeight: 77.5,
      byOutcome: { alive: 2, stillborn: 1, unknown: 0 },
      byEase: { unassisted: 2, assisted: 0, caesarean: 1, unknown: 0 },
    },
    calvingInterval: { intervals: 2, averageDays: 345, minDays: 315, maxDays: 375 },
    breeding: { breedings: 4, checked: 2, pregnant: 1, open: 1, conceptionRate: null },
    dailyGain: {
      animals: 2,
      herdAverage: 0.25,
      byGroup: [{ group: 'female', animals: 1, average: 1.5 }, { group: 'male', animals: 1, average: -1 }],
      byAnimal: [
        { cattleTag: 'A-1', cattleName: 'Daisy, "the first"', group: 'female', firstDate: '2026-01-10', firstWeight: 1000, lastDate: '2026-04-20', lastWeight: 1150, days: 100, gain: 150, dailyGain: 1.5 },
        { cattleTag: '=A-4', cattleName: '', group: 'male', firstDate: '2026-02-01', firstWeight: 1500, lastDate: '2026-03-03', lastWeight: 1470, days: 30, gain: -30, dailyGain: -1 },
      ],
    },
  };

  test('performance tables', () => {
    assert.deepEqual(PERFORMANCE_TABLES.herd.rows(performance), [
      ['Month', 'Counted up to', 'Animals added', 'Herd size'],
      ['2026-05', '2026-05-31', 1, 1],
      ['2026-06', '2026-06-15', 1, 2],
    ]);
    const summary = Object.fromEntries(PERFORMANCE_TABLES.summary.rows(performance).slice(1).map(([name, value]) => [name, value]));
    assert.equal(summary['Calving rate'], 50);
    assert.equal(summary['Average calving interval'], 345);
    assert.equal(summary['Conception rate'], null);
    assert.equal(summary['Herd average daily gain'], 0.25);
    assert.deepEqual(PERFORMANCE_TABLES.calvings.rows(performance), [
      ['Breakdown', 'Category', 'Calvings', 'Share %'],
      ['Outcome', 'Alive', 2, 67],
      ['Outcome', 'Stillborn', 1, 33],
      ['Outcome', 'Not recorded', 0, 0],
      ['Ease', 'Unassisted', 2, 67],
      ['Ease', 'Assisted', 0, 0],
      ['Ease', 'Caesarean', 1, 33],
      ['Ease', 'Not recorded', 0, 0],
    ]);
    assert.deepEqual(PERFORMANCE_TABLES['gain-groups'].rows(performance).slice(1), [
      ['Females', 1, 1.5], ['Males', 1, -1], ['Whole herd', 2, 0.25],
    ]);
    // Negative numbers stay numbers; a name with a comma is quoted; a tag starting with = is defused.
    assert.equal(
      reportCsv(PERFORMANCE_TABLES.gain.rows(performance)),
      'Cow ID,Name,Group,First weighing,First weight (lbs),Last weighing,Last weight (lbs),Days,Gain (lbs),Daily gain (lbs/day)\r\n' +
      'A-1,"Daisy, ""the first""",Females,2026-01-10,1000,2026-04-20,1150,100,150,1.5\r\n' +
      "'=A-4,,Males,2026-02-01,1500,2026-03-03,1470,30,-30,-1\r\n"
    );
  });

  const health = {
    treatments: {
      count: 4,
      animals: 3,
      byType: [
        { type: 'treatment', count: 3, animals: 2 }, { type: 'vaccination', count: 1, animals: 1 },
        { type: 'vet_visit', count: 0, animals: 0 }, { type: 'other', count: 0, animals: 0 },
      ],
      byMonth: [{ month: '2026-02', treatment: 3, vaccination: 0, vet_visit: 0, other: 0, total: 3 }, { month: '2026-03', treatment: 0, vaccination: 1, vet_visit: 0, other: 0, total: 1 }],
    },
    underTreatment: [{ cattleTag: 'A-2', cattleName: 'Bess', medications: 'Penicillin', lastTreatmentDate: '2026-02-20', lastTreatmentType: 'treatment', lastTreatmentProduct: 'penicillin' }],
    quarantine: [{ cattleTag: 'A-3', cattleName: '', medications: '', lastTreatmentDate: null, lastTreatmentType: null, lastTreatmentProduct: '' }],
    withdrawal: [{ cattleTag: 'A-4', cattleName: 'Max', withdrawalUntil: '2026-06-15', daysLeft: 0, product: 'Hoof trim', dateGiven: '2026-05-05' }],
    followUps: {
      upcomingDays: 30,
      overdue: [{ cattleTag: 'A-2', cattleName: 'Bess', type: 'treatment', product: 'penicillin', dateGiven: '2026-02-20', nextDueDate: '2026-06-10', daysUntil: -5 }],
      upcoming: [{ cattleTag: 'A-3', cattleName: '', type: 'vet_visit', product: '', dateGiven: '2026-02-25', nextDueDate: '2026-06-15', daysUntil: 0 }],
    },
  };

  test('health tables', () => {
    assert.deepEqual(HEALTH_TABLES.types.rows(health), [
      ['Type', 'Treatments', 'Animals', 'Share %'],
      ['Treatment', 3, 2, 75],
      ['Vaccination', 1, 1, 25],
      ['Vet visit', 0, 0, 0],
      ['Other', 0, 0, 0],
      ['Total', 4, 3, 100],
    ]);
    assert.deepEqual(HEALTH_TABLES.months.rows(health), [
      ['Month', 'Treatment', 'Vaccination', 'Vet visit', 'Other', 'Total'],
      ['2026-02', 3, 0, 0, 0, 3],
      ['2026-03', 0, 1, 0, 0, 1],
    ]);
    assert.deepEqual(HEALTH_TABLES.attention.rows(health).slice(1), [
      ['A-2', 'Bess', 'Under Treatment', 'Penicillin', '2026-02-20', 'Treatment', 'penicillin'],
      ['A-3', '', 'In Quarantine', '', null, '', ''],
    ]);
    assert.deepEqual(HEALTH_TABLES.withdrawal.rows(health).slice(1), [['A-4', 'Max', '2026-06-15', 0, 'Hoof trim', '2026-05-05']]);
    assert.deepEqual(HEALTH_TABLES['follow-ups'].rows(health).slice(1), [
      ['A-2', 'Bess', 'Treatment', 'penicillin', '2026-02-20', '2026-06-10', -5, 'Overdue'],
      ['A-3', '', 'Vet visit', '', '2026-02-25', '2026-06-15', 0, 'Upcoming'],
    ]);
  });
});
