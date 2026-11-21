// Performance and health reports. The herd below is small enough to work every figure out by
// hand; the arithmetic is written next to each expectation.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, pool, signedIn, useDatabase } = require('../helpers/api');

useDatabase();

const TODAY = '2026-06-15';
const PERIOD = `from=2026-01-01&to=2026-06-30&today=${TODAY}`;
const ALL = `today=${TODAY}`;

const performance = async (client, query = PERIOD) => (await client.get(`/api/reports/performance?${query}`).expect(200)).body;
const health = async (client, query = PERIOD) => (await client.get(`/api/reports/health?${query}`).expect(200)).body;

// The known herd. Rows go in with SQL so that created_at (the date an animal joined) is fixed.
//
//   tag  gender  born        joined (UTC)        status           note
//   A-1  female  2020-01-01  2025-11-10          healthy          calved 2024, 2025, 2026 (twins)
//   A-2  female  2021-03-01  2025-11-20          under_treatment  calved 2025, 2026
//   A-3  female  2025-09-01  2026-01-05          quarantine       9 months old: not breeding age
//   A-4  male    2019-05-05  2026-03-15          healthy
//   A-5  (none)  (none)      2026-03-31 23:30    pregnant         calved 2024, so she counts as a breeding female
//   A-6  female  (none)      2026-06-10          healthy          no birth date: counts as breeding age
async function seed(ownerId) {
  const id = {};
  const cow = async (tag, gender, birth, joined, status, extra = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO cattle (owner_id, tag_number, name_breed, gender, birth_date, created_at, health_status, medications, withdrawal_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [ownerId, tag, `${tag} name`, gender, birth, joined, status, extra.medications || null, extra.withdrawal || null]
    );
    id[tag] = rows[0].id;
  };
  await cow('A-1', 'female', '2020-01-01', '2025-11-10T12:00:00Z', 'healthy', { withdrawal: '2026-01-10' });
  await cow('A-2', 'female', '2021-03-01', '2025-11-20T12:00:00Z', 'under_treatment', { medications: 'Penicillin', withdrawal: '2026-06-20' });
  await cow('A-3', 'female', '2025-09-01', '2026-01-05T12:00:00Z', 'quarantine');
  await cow('A-4', 'male', '2019-05-05', '2026-03-15T12:00:00Z', 'healthy', { withdrawal: '2026-06-15' });
  await cow('A-5', null, null, '2026-03-31T23:30:00Z', 'pregnant');
  await cow('A-6', 'female', null, '2026-06-10T12:00:00Z', 'healthy');

  const calving = (tag, date, outcome, ease, birthWeight) =>
    pool.query(
      'INSERT INTO calving_events (cattle_id, owner_id, calving_date, outcome, ease, birth_weight) VALUES ($1,$2,$3,$4,$5,$6)',
      [id[tag], ownerId, date, outcome, ease, birthWeight]
    );
  await calving('A-1', '2024-03-01', 'alive', 'unassisted', null);
  await calving('A-1', '2025-03-11', 'alive', 'assisted', 80);
  await calving('A-1', '2026-03-21', 'alive', 'unassisted', 70); // twins: two events, one calving
  await calving('A-1', '2026-03-21', 'stillborn', 'caesarean', null);
  await calving('A-2', '2025-04-01', null, null, 90);
  await calving('A-2', '2026-02-10', 'alive', 'unassisted', 85);
  await calving('A-5', '2024-05-01', null, null, null);

  const weigh = (tag, date, weight) =>
    pool.query('INSERT INTO weighings (cattle_id, owner_id, date, weight) VALUES ($1,$2,$3,$4)', [id[tag], ownerId, date, weight]);
  await weigh('A-1', '2025-12-01', 900); // before the period
  await weigh('A-1', '2026-01-10', 1000);
  await weigh('A-1', '2026-02-15', 1100); // in between: not used
  await weigh('A-1', '2026-04-20', 1150);
  await weigh('A-2', '2026-05-01', 1200); // one weighing: no gain
  await weigh('A-3', '2026-03-01', 300); // two weighings on one day: no gain
  await weigh('A-3', '2026-03-01', 310);
  await weigh('A-4', '2026-02-01', 1500);
  await weigh('A-4', '2026-03-03', 1470);
  await weigh('A-5', '2026-04-01', 800);
  await weigh('A-5', '2026-04-11', 825);

  const breed = (tag, date) =>
    pool.query('INSERT INTO breeding_events (cattle_id, owner_id, breeding_date) VALUES ($1,$2,$3)', [id[tag], ownerId, date]);
  const check = (tag, date, result) =>
    pool.query('INSERT INTO pregnancy_checks (cattle_id, owner_id, check_date, result) VALUES ($1,$2,$3,$4)', [id[tag], ownerId, date, result]);
  await breed('A-1', '2026-04-10');
  await check('A-1', '2026-05-20', 'pregnant'); // -> pregnant
  await breed('A-2', '2026-03-01');
  await check('A-2', '2026-04-05', 'open'); // -> open
  await breed('A-2', '2026-04-10');
  await check('A-2', '2026-05-15', 'unsure'); // -> not checked
  await breed('A-6', '2026-06-01'); // -> not checked
  await breed('A-5', '2025-06-01'); // before the period
  await check('A-5', '2025-07-10', 'open');
  await check('A-5', '2025-08-01', 'pregnant'); // the newer check decides -> pregnant

  const treat = (tag, date, type, product, nextDue, withdrawal) =>
    pool.query(
      'INSERT INTO treatments (cattle_id, owner_id, date_given, type, product, next_due_date, withdrawal_until) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id[tag], ownerId, date, type, product, nextDue, withdrawal]
    );
  await treat('A-1', '2025-12-20', 'vaccination', 'Ivermectin', null, '2026-01-10'); // before the period
  await treat('A-1', '2026-01-15', 'vaccination', 'Bovi-Shield', '2026-07-01', null); // due in 16 days
  await treat('A-2', '2026-02-10', 'treatment', 'Penicillin', '2026-02-20', '2026-03-01'); // closed by the next one
  await treat('A-2', '2026-02-20', 'treatment', 'penicillin', '2026-06-10', '2026-06-20'); // 5 days overdue
  await treat('A-3', '2026-02-03', 'treatment', 'Banamine', null, null);
  await treat('A-3', '2026-02-25', 'vet_visit', null, '2026-06-15', null); // due today
  await treat('A-4', '2026-05-05', 'other', 'Hoof trim', '2026-08-01', '2026-06-15'); // due in 47 days: not listed
  return id;
}

describe('authentication and validation', () => {
  for (const path of ['/api/reports/performance', '/api/reports/health']) {
    test(`GET ${path} needs a session`, async () => {
      const res = await request(app).get(path).expect(401);
      assert.equal(res.body.error, 'Authentication required');
    });

    test(`GET ${path} refuses bad dates`, async () => {
      const client = await signedIn('a@example.com');
      const error = async (query) => (await client.get(`${path}?${query}`).expect(400)).body.error;
      assert.equal(await error('from=2026-02-30'), 'Invalid "from" date');
      assert.equal(await error('from=yesterday'), 'Invalid "from" date');
      assert.equal(await error('to=2026-13-01'), 'Invalid "to" date');
      assert.equal(await error('to=20260101'), 'Invalid "to" date');
      assert.equal(await error('today=2026-6-1'), 'Invalid "today" date');
      assert.equal(await error('from=2026-03-02&to=2026-03-01'), '"from" must be on or before "to"');
      await client.get(`${path}?from=2026-03-01&to=2026-03-01`).expect(200);
      await client.get(`${path}?from=&to=`).expect(200);
    });

    test(`GET ${path} uses the server's date when today is not given`, async () => {
      const client = await signedIn('a@example.com');
      const res = await client.get(path).expect(200);
      assert.equal(res.body.today, new Date().toISOString().slice(0, 10));
      assert.equal(res.body.from, null);
      assert.equal(res.body.to, null);
    });
  }
});

describe('performance report: figures for the known herd', () => {
  test('herd size now and at each month end of the period', async () => {
    const client = await signedIn('a@example.com');
    await seed(client.user.id);
    const report = await performance(client);
    assert.equal(report.from, '2026-01-01');
    assert.equal(report.to, '2026-06-30');
    assert.equal(report.today, TODAY);
    assert.equal(report.herd.size, 6);
    assert.equal(report.herd.females, 4); // A-1, A-2, A-3, A-6
    assert.equal(report.herd.males, 1); // A-4
    // Joined: A-1, A-2 in Nov 2025; A-3 in Jan; A-4, A-5 in Mar (A-5 at 23:30 UTC on the 31st); A-6 in Jun.
    // June stops at today (the 15th), not at the 30th.
    assert.deepEqual(report.herd.byMonth, [
      { month: '2026-01', asOf: '2026-01-31', added: 1, size: 3 },
      { month: '2026-02', asOf: '2026-02-28', added: 0, size: 3 },
      { month: '2026-03', asOf: '2026-03-31', added: 2, size: 5 },
      { month: '2026-04', asOf: '2026-04-30', added: 0, size: 5 },
      { month: '2026-05', asOf: '2026-05-31', added: 0, size: 5 },
      { month: '2026-06', asOf: '2026-06-15', added: 1, size: 6 },
    ]);
  });

  test('with no dates the herd series starts in the month the first animal joined', async () => {
    const client = await signedIn('a@example.com');
    await seed(client.user.id);
    const { herd } = await performance(client, ALL);
    assert.deepEqual(herd.byMonth.map((m) => [m.month, m.added, m.size]), [
      ['2025-11', 2, 2], ['2025-12', 0, 2], ['2026-01', 1, 3], ['2026-02', 0, 3],
      ['2026-03', 2, 5], ['2026-04', 0, 5], ['2026-05', 0, 5], ['2026-06', 1, 6],
    ]);
  });

  test('a period that ends mid-month counts animals up to its last day', async () => {
    const client = await signedIn('a@example.com');
    await seed(client.user.id);
    const { herd } = await performance(client, `from=2026-03-10&to=2026-03-20&today=${TODAY}`);
    // On record by 20 March: A-1, A-2, A-3, A-4. A-5 joined on the 31st.
    assert.deepEqual(herd.byMonth, [{ month: '2026-03', asOf: '2026-03-20', added: 1, size: 4 }]);
  });

  test('calvings, outcomes, ease, birth weight and calving rate', async () => {
    const client = await signedIn('a@example.com');
    await seed(client.user.id);
    const { calvings } = await performance(client);
    assert.deepEqual(calvings, {
      count: 3, // A-1's twins (2 events) and A-2's calf
      cows: 2,
      byOutcome: { alive: 2, stillborn: 1, unknown: 0 },
      byEase: { unassisted: 2, assisted: 0, caesarean: 1, unknown: 0 },
      birthWeights: 2,
      averageBirthWeight: 77.5, // (70 + 85) / 2
      breedingAgeMonths: 15,
      breedingFemales: 4, // A-1, A-2 (old enough), A-5 (has calved), A-6 (female, no birth date)
      cowsCalved: 2, // A-1, A-2
      calvingRate: 50, // 2 / 4
    });

    const all = (await performance(client, ALL)).calvings;
    assert.equal(all.count, 7);
    assert.equal(all.cows, 3);
    assert.deepEqual(all.byOutcome, { alive: 4, stillborn: 1, unknown: 2 });
    assert.deepEqual(all.byEase, { unassisted: 3, assisted: 1, caesarean: 1, unknown: 2 });
    assert.equal(all.birthWeights, 4);
    assert.equal(all.averageBirthWeight, 81.3); // (80 + 70 + 90 + 85) / 4 = 81.25, rounded to one decimal
    assert.equal(all.breedingFemales, 4);
    assert.equal(all.cowsCalved, 3);
    assert.equal(all.calvingRate, 75);
  });

  test('a heifer becomes a breeding female once she is 15 months old at the end of the period', async () => {
    const client = await signedIn('a@example.com');
    await seed(client.user.id);
    // A-3 was born 2025-09-01: she is 15 months old on 2026-12-01.
    const rate = async (today) => (await performance(client, `today=${today}`)).calvings.breedingFemales;
    assert.equal(await rate('2026-11-30'), 4);
    assert.equal(await rate('2026-12-01'), 5);
    // The end of the period counts, not today, when it is earlier.
    assert.equal((await performance(client, 'to=2026-11-30&today=2027-06-01')).calvings.breedingFemales, 4);
  });

  test('average calving interval', async () => {
    const client = await signedIn('a@example.com');
    await seed(client.user.id);
    // In the period: A-1 2025-03-11 -> 2026-03-21 = 375 days (twins are one calving);
    // A-2 2025-04-01 -> 2026-02-10 = 315 days. (375 + 315) / 2 = 345.
    assert.deepEqual((await performance(client)).calvingInterval, { intervals: 2, cows: 2, averageDays: 345, minDays: 315, maxDays: 375 });
    // All time adds A-1 2024-03-01 -> 2025-03-11 = 375 days. (375 + 375 + 315) / 3 = 355.
    assert.deepEqual((await performance(client, ALL)).calvingInterval, { intervals: 3, cows: 2, averageDays: 355, minDays: 315, maxDays: 375 });
    // A period holding only first calvings has no interval.
    assert.deepEqual(
      (await performance(client, `from=2024-01-01&to=2024-12-31&today=${TODAY}`)).calvingInterval,
      { intervals: 0, cows: 0, averageDays: null, minDays: null, maxDays: null }
    );
  });

  test('average daily gain by animal, by group and for the herd', async () => {
    const client = await signedIn('a@example.com');
    const id = await seed(client.user.id);
    const { dailyGain } = await performance(client);
    assert.equal(dailyGain.animals, 3);
    assert.equal(dailyGain.herdAverage, 1); // (2.5 + 1.5 - 1) / 3
    assert.deepEqual(dailyGain.byGroup, [
      { group: 'female', animals: 1, average: 1.5 },
      { group: 'male', animals: 1, average: -1 },
      { group: 'unknown', animals: 1, average: 2.5 },
    ]);
    assert.deepEqual(dailyGain.byAnimal, [
      // 800 -> 825 in 10 days
      { cattleId: id['A-5'], cattleTag: 'A-5', cattleName: 'A-5 name', group: 'unknown', firstDate: '2026-04-01', firstWeight: 800, lastDate: '2026-04-11', lastWeight: 825, weighings: 2, days: 10, gain: 25, dailyGain: 2.5 },
      // 1000 on 10 Jan -> 1150 on 20 Apr: 21 + 28 + 31 + 20 = 100 days
      { cattleId: id['A-1'], cattleTag: 'A-1', cattleName: 'A-1 name', group: 'female', firstDate: '2026-01-10', firstWeight: 1000, lastDate: '2026-04-20', lastWeight: 1150, weighings: 3, days: 100, gain: 150, dailyGain: 1.5 },
      // 1500 on 1 Feb -> 1470 on 3 Mar: 30 days
      { cattleId: id['A-4'], cattleTag: 'A-4', cattleName: 'A-4 name', group: 'male', firstDate: '2026-02-01', firstWeight: 1500, lastDate: '2026-03-03', lastWeight: 1470, weighings: 2, days: 30, gain: -30, dailyGain: -1 },
    ]);

    // All time A-1 starts at 900 on 2025-12-01: 250 lbs in 140 days = 1.7857 -> 1.79.
    const all = (await performance(client, ALL)).dailyGain;
    const a1 = all.byAnimal.find((a) => a.cattleTag === 'A-1');
    assert.deepEqual([a1.firstDate, a1.days, a1.gain, a1.dailyGain, a1.weighings], ['2025-12-01', 140, 250, 1.79, 4]);
    assert.equal(all.herdAverage, 1.1); // (1.7857 + 2.5 - 1) / 3 = 1.0952
  });

  test('conception rate from breedings and the checks that followed them', async () => {
    const client = await signedIn('a@example.com');
    await seed(client.user.id);
    // In the period: A-1 pregnant, A-2 open then (re-bred) only "unsure", A-6 never checked.
    assert.deepEqual((await performance(client)).breeding, { breedings: 4, checked: 2, pregnant: 1, open: 1, conceptionRate: 50 });
    // All time adds A-5: open, then pregnant three weeks later -> pregnant. 2 / 3 = 66.7 %.
    assert.deepEqual((await performance(client, ALL)).breeding, { breedings: 5, checked: 3, pregnant: 2, open: 1, conceptionRate: 66.7 });
  });

  test('a period with no records keeps the herd figures and reports no rates', async () => {
    const client = await signedIn('a@example.com');
    await seed(client.user.id);
    const report = await performance(client, `from=2030-01-01&to=2030-12-31&today=${TODAY}`);
    assert.equal(report.herd.size, 6);
    assert.deepEqual(report.herd.byMonth, []); // the period has not started
    assert.equal(report.calvings.count, 0);
    assert.equal(report.calvings.averageBirthWeight, null);
    assert.equal(report.calvings.breedingFemales, 4); // as of today
    assert.equal(report.calvings.calvingRate, 0);
    assert.deepEqual(report.calvingInterval, { intervals: 0, cows: 0, averageDays: null, minDays: null, maxDays: null });
    assert.deepEqual(report.dailyGain, { animals: 0, herdAverage: null, byGroup: [], byAnimal: [] });
    assert.deepEqual(report.breeding, { breedings: 0, checked: 0, pregnant: 0, open: 0, conceptionRate: null });
  });

  test('an empty herd', async () => {
    const client = await signedIn('a@example.com');
    for (const query of [PERIOD, ALL]) {
      const report = await performance(client, query);
      assert.deepEqual(report.herd.size, 0);
      assert.ok(report.herd.byMonth.every((m) => m.size === 0 && m.added === 0));
      assert.equal(report.calvings.count, 0);
      assert.equal(report.calvings.breedingFemales, 0);
      assert.equal(report.calvings.calvingRate, null);
      assert.equal(report.calvingInterval.averageDays, null);
      assert.deepEqual(report.dailyGain, { animals: 0, herdAverage: null, byGroup: [], byAnimal: [] });
      assert.equal(report.breeding.conceptionRate, null);
    }
    assert.equal((await performance(client, PERIOD)).herd.byMonth.length, 6);
    assert.deepEqual((await performance(client, ALL)).herd.byMonth, []);
  });

  test('the herd series keeps at most the newest 120 months', async () => {
    const client = await signedIn('a@example.com');
    const { herd } = await performance(client, `from=2000-01-01&today=${TODAY}`);
    assert.equal(herd.byMonth.length, 120);
    assert.equal(herd.byMonth[0].month, '2016-07');
    assert.equal(herd.byMonth.at(-1).month, '2026-06');
  });
});

describe('health report: figures for the known herd', () => {
  test('treatments by type and by month', async () => {
    const client = await signedIn('a@example.com');
    await seed(client.user.id);
    const { treatments } = await health(client);
    assert.deepEqual(treatments, {
      count: 6,
      animals: 4, // A-1, A-2, A-3, A-4
      byType: [
        { type: 'treatment', count: 3, animals: 2 }, // A-2 twice, A-3
        { type: 'vaccination', count: 1, animals: 1 },
        { type: 'vet_visit', count: 1, animals: 1 },
        { type: 'other', count: 1, animals: 1 },
      ],
      byMonth: [
        { month: '2026-01', treatment: 0, vaccination: 1, vet_visit: 0, other: 0, total: 1 },
        { month: '2026-02', treatment: 3, vaccination: 0, vet_visit: 1, other: 0, total: 4 },
        { month: '2026-05', treatment: 0, vaccination: 0, vet_visit: 0, other: 1, total: 1 },
      ],
    });

    const all = (await health(client, ALL)).treatments;
    assert.equal(all.count, 7);
    assert.deepEqual(all.byType[1], { type: 'vaccination', count: 2, animals: 1 });
    assert.deepEqual(all.byMonth[0], { month: '2025-12', treatment: 0, vaccination: 1, vet_visit: 0, other: 0, total: 1 });
  });

  test('animals under treatment and in quarantine now', async () => {
    const client = await signedIn('a@example.com');
    const id = await seed(client.user.id);
    const report = await health(client);
    assert.deepEqual(report.herd, { size: 6, healthy: 3, pregnant: 1, underTreatment: 1, quarantine: 1 });
    assert.deepEqual(report.underTreatment, [{
      cattleId: id['A-2'], cattleTag: 'A-2', cattleName: 'A-2 name', medications: 'Penicillin',
      lastTreatmentDate: '2026-02-20', lastTreatmentType: 'treatment', lastTreatmentProduct: 'penicillin',
    }]);
    assert.deepEqual(report.quarantine, [{
      cattleId: id['A-3'], cattleTag: 'A-3', cattleName: 'A-3 name', medications: '',
      lastTreatmentDate: '2026-02-25', lastTreatmentType: 'vet_visit', lastTreatmentProduct: '',
    }]);
  });

  test('animals in a withdrawal period today, the one ending first at the top', async () => {
    const client = await signedIn('a@example.com');
    const id = await seed(client.user.id);
    const report = await health(client);
    // A-1's period ended on 2026-01-10. A-4's ends today, which still counts.
    assert.deepEqual(report.withdrawal, [
      { cattleId: id['A-4'], cattleTag: 'A-4', cattleName: 'A-4 name', withdrawalUntil: '2026-06-15', daysLeft: 0, product: 'Hoof trim', dateGiven: '2026-05-05' },
      { cattleId: id['A-2'], cattleTag: 'A-2', cattleName: 'A-2 name', withdrawalUntil: '2026-06-20', daysLeft: 5, product: 'penicillin', dateGiven: '2026-02-20' },
    ]);
    assert.deepEqual((await health(client, 'today=2026-06-16')).withdrawal.map((w) => [w.cattleTag, w.daysLeft]), [['A-2', 4]]);
  });

  test('overdue and upcoming follow-ups, with the same open rule as /api/treatments/due', async () => {
    const client = await signedIn('a@example.com');
    await seed(client.user.id);
    const { followUps } = await health(client);
    assert.equal(followUps.upcomingDays, 30);
    const brief = (list) => list.map((f) => [f.cattleTag, f.type, f.product, f.dateGiven, f.nextDueDate, f.daysUntil]);
    // A-2's first penicillin (due 2026-02-20) was closed by the second; the second is 5 days late.
    assert.deepEqual(brief(followUps.overdue), [['A-2', 'treatment', 'penicillin', '2026-02-20', '2026-06-10', -5]]);
    // Due today counts as upcoming. A-4's is 47 days away: outside the 30 days.
    assert.deepEqual(brief(followUps.upcoming), [
      ['A-3', 'vet_visit', '', '2026-02-25', '2026-06-15', 0],
      ['A-1', 'vaccination', 'Bovi-Shield', '2026-01-15', '2026-07-01', 16],
    ]);

    // Exactly the open follow-ups of /api/treatments/due up to today + 30 days.
    const due = (await client.get('/api/treatments/due?until=2026-07-15').expect(200)).body;
    assert.deepEqual([...followUps.overdue, ...followUps.upcoming].map((f) => f.id), due.map((t) => t.id));

    // The 30 days include the last one: 2026-08-01 is 30 days after 2026-07-02.
    const later = async (today) => (await health(client, `today=${today}`)).followUps.upcoming.map((f) => f.cattleTag);
    assert.ok(!(await later('2026-07-01')).includes('A-4'));
    assert.ok((await later('2026-07-02')).includes('A-4'));
  });

  test('the period changes the treatment counts but not the current lists', async () => {
    const client = await signedIn('a@example.com');
    await seed(client.user.id);
    const report = await health(client, `from=2030-01-01&to=2030-12-31&today=${TODAY}`);
    assert.equal(report.treatments.count, 0);
    assert.equal(report.treatments.animals, 0);
    assert.deepEqual(report.treatments.byType.map((t) => [t.type, t.count, t.animals]), [
      ['treatment', 0, 0], ['vaccination', 0, 0], ['vet_visit', 0, 0], ['other', 0, 0],
    ]);
    assert.deepEqual(report.treatments.byMonth, []);
    assert.equal(report.underTreatment.length, 1);
    assert.equal(report.quarantine.length, 1);
    assert.equal(report.withdrawal.length, 2);
    assert.equal(report.followUps.overdue.length, 1);
    assert.equal(report.followUps.upcoming.length, 2);
  });

  test('an empty herd', async () => {
    const client = await signedIn('a@example.com');
    const report = await health(client, ALL);
    assert.deepEqual(report.treatments.count, 0);
    assert.deepEqual(report.treatments.byMonth, []);
    assert.equal(report.treatments.byType.length, 4);
    assert.deepEqual(report.herd, { size: 0, healthy: 0, pregnant: 0, underTreatment: 0, quarantine: 0 });
    assert.deepEqual(report.underTreatment, []);
    assert.deepEqual(report.quarantine, []);
    assert.deepEqual(report.withdrawal, []);
    assert.deepEqual(report.followUps, { upcomingDays: 30, overdue: [], upcoming: [] });
  });
});

describe('owner isolation', () => {
  test("another account's records never appear in a report", async () => {
    const alice = await signedIn('alice@example.com');
    const bob = await signedIn('bob@example.com');
    await seed(alice.user.id);

    const p = await performance(bob, ALL);
    assert.equal(p.herd.size, 0);
    assert.deepEqual(p.herd.byMonth, []);
    assert.equal(p.calvings.count, 0);
    assert.equal(p.calvings.breedingFemales, 0);
    assert.equal(p.calvingInterval.intervals, 0);
    assert.equal(p.dailyGain.animals, 0);
    assert.equal(p.breeding.breedings, 0);
    const h = await health(bob, ALL);
    assert.equal(h.treatments.count, 0);
    assert.equal(h.herd.size, 0);
    assert.deepEqual([h.underTreatment, h.quarantine, h.withdrawal, h.followUps.overdue, h.followUps.upcoming], [[], [], [], [], []]);
    assert.ok(!JSON.stringify([p, h]).includes('A-1'));

    // Bob's own animal changes his report and leaves Alice's as it was.
    await bob.post('/api/cattle').send({ tagNumber: 'BOB-1', gender: 'female', healthStatus: 'quarantine' }).expect(201);
    assert.equal((await health(bob, ALL)).quarantine[0].cattleTag, 'BOB-1');
    assert.equal((await performance(bob, ALL)).herd.size, 1);
    assert.equal((await performance(alice, ALL)).herd.size, 6);
    assert.deepEqual((await health(alice, ALL)).quarantine.map((a) => a.cattleTag), ['A-3']);
  });
});
