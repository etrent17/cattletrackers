// Browser test for the Performance and Health report pages: each shows its own figures for a
// small known herd, the period changes them, every table exports as CSV, and the print layout
// hides the navigation. Run with `npm run test:e2e`.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { useBrowser } = require('./helpers/browser');

// Local calendar dates, as the app uses them.
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const XSS_NAME = '<img src=x onerror="window.__xss=1">';

describe('performance and health reports in the browser', () => {
  const session = useBrowser();
  let page;

  const text = (selector) => page.locator(selector).innerText();
  const rowTexts = async (selector) => (await page.locator(`${selector} tbody tr`).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const exportCsv = async (key) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`.rep-export[data-export="${key}"]`)]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.equal(csv.charCodeAt(0), 0xfeff, 'starts with a byte-order mark for Excel');
    assert.ok(csv.endsWith('\r\n'));
    return { name: download.suggestedFilename(), lines: csv.slice(1).trimEnd().split('\r\n') };
  };

  // The herd: Rosie calved 400 and 30 days ago (370 days apart) and was weighed 400 and 20 days
  // ago; the bull gained 100 lbs in 40 days and is in quarantine; Tess was bred and found
  // pregnant, is under treatment, in a withdrawal period, and one day late for her follow-up.
  test('set up a small herd with records', async () => {
    const user = await session.signIn('reports@example.com');
    page = session.page;
    const db = session.pool;
    const cow = async (tag, name, gender, birth, status) =>
      (await db.query(
        'INSERT INTO cattle (owner_id, tag_number, name_breed, gender, birth_date, health_status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [user.id, tag, name, gender, birth, status]
      )).rows[0].id;
    const rosie = await cow('R-1', 'Rosie', 'female', '2020-01-01', 'healthy');
    const bull = await cow('R-2', XSS_NAME, 'male', null, 'quarantine');
    const tess = await cow('R-3', 'Tess', 'female', null, 'under_treatment');

    const calving = (date) =>
      db.query("INSERT INTO calving_events (cattle_id, owner_id, calving_date, outcome, ease) VALUES ($1,$2,$3,'alive','unassisted')", [rosie, user.id, date]);
    await calving(localDay(-400));
    await calving(localDay(-30));
    const weigh = (id, date, weight) => db.query('INSERT INTO weighings (cattle_id, owner_id, date, weight) VALUES ($1,$2,$3,$4)', [id, user.id, date, weight]);
    await weigh(rosie, localDay(-400), 900);
    await weigh(rosie, localDay(-20), 1000);
    await weigh(bull, localDay(-50), 1000);
    await weigh(bull, localDay(-10), 1100);
    await db.query('INSERT INTO breeding_events (cattle_id, owner_id, breeding_date) VALUES ($1,$2,$3)', [tess, user.id, localDay(-60)]);
    await db.query("INSERT INTO pregnancy_checks (cattle_id, owner_id, check_date, result) VALUES ($1,$2,$3,'pregnant')", [tess, user.id, localDay(-20)]);
    await db.query(
      "INSERT INTO treatments (cattle_id, owner_id, date_given, type, product, next_due_date, withdrawal_until) VALUES ($1,$2,$3,'treatment','Penicillin',$4,$5)",
      [tess, user.id, localDay(-5), localDay(-1), localDay(3)]
    );
    await db.query('UPDATE cattle SET withdrawal_until = $2 WHERE id = $1', [tess, localDay(3)]);
    await db.query("INSERT INTO treatments (cattle_id, owner_id, date_given, type, product) VALUES ($1,$2,$3,'vaccination','=Vax')", [bull, user.id, localDay(-400)]);
    await page.reload();
    await page.locator('#recent-body tr', { hasText: 'R-1' }).waitFor();
  });

  test('Performance Reports shows the herd, calving, gain and conception figures', async () => {
    await session.showView('reports');
    await page.locator('#rep-herd-size').waitFor();
    assert.equal(await text('#secondary-view-title'), 'Performance Reports');
    assert.equal(await page.inputValue('#rep-preset'), '12m');
    assert.match(await text('#rep-period'), /^Period: Last 12 months \(\d{4}-\d{2}-01 to \d{4}-\d{2}-\d{2}\)\. Report date: /);

    assert.equal(await text('#rep-herd-size'), '3');
    assert.equal(await text('#rep-calvings'), '1'); // the calving 400 days ago is outside the period
    assert.equal(await text('#rep-calving-rate'), '50%'); // Rosie of Rosie and Tess
    assert.equal(await text('#rep-calving-interval'), '370 days');
    assert.equal(await text('#rep-daily-gain'), '+2.50 lbs/day'); // the bull: 100 lbs in 40 days
    assert.equal(await text('#rep-conception-rate'), '100%');

    const herd = await rowTexts('#rep-herd-table');
    assert.equal(herd.length, 12);
    assert.match(herd[11], / 3 3$/); // all three joined this month
    assert.match(herd[10], / 0 0$/);
    assert.equal(await page.locator('svg.rep-chart .rep-chart-bar').count(), 1);
    assert.equal(await page.locator('svg.rep-chart .rep-chart-value').textContent(), '3');

    assert.deepEqual(await rowTexts('#rep-outcome-table'), ['Alive 1 100%', 'Stillborn 0 0%', 'Not recorded 0 0%']);
    assert.deepEqual(await rowTexts('#rep-gain-groups-table'), ['Males 1 +2.50 lbs/day']);
    const gain = await rowTexts('#rep-gain-table');
    assert.equal(gain.length, 1);
    assert.equal(gain[0], `R-2 ${XSS_NAME} Males ${localDay(-50)} 1,000 lbs ${localDay(-10)} 1,100 lbs 40 +100 lbs +2.50 lbs/day`);
    assert.match(await text('#rep-definitions'), /Calving rate is the number of cows that calved in the period divided by the breeding-age females/);
  });

  test('changing the period changes the figures', async () => {
    await page.selectOption('#rep-preset', 'all');
    await page.locator('#rep-calvings', { hasText: '2' }).waitFor();
    assert.equal(await page.inputValue('#rep-from'), '');
    assert.equal(await text('#rep-period'), `Period: All time. Report date: ${localDay()}.`);
    assert.equal(await text('#rep-calving-interval'), '370 days');
    // Rosie now has two weighings: 100 lbs in 380 days = 0.263. (2.5 + 0.263) / 2 = 1.38.
    assert.equal(await text('#rep-daily-gain'), '+1.38 lbs/day');
    assert.deepEqual(await rowTexts('#rep-gain-groups-table'), ['Females 1 +0.26 lbs/day', 'Males 1 +2.50 lbs/day']);
    assert.equal((await rowTexts('#rep-herd-table')).length, 1); // starts when the first animal joined

    // A custom range that holds nothing.
    await page.fill('#rep-from', localDay(-200));
    await page.fill('#rep-to', localDay(-100));
    await page.locator('#rep-to').dispatchEvent('change');
    await page.locator('#rep-calvings', { hasText: '0' }).waitFor();
    assert.equal(await page.inputValue('#rep-preset'), 'custom');
    assert.equal(await text('#rep-calving-interval'), '—');
    assert.equal(await text('#rep-daily-gain'), '—');
    assert.equal(await text('#rep-conception-rate'), '—');
    assert.equal(await text('#rep-herd-size'), '3'); // the herd today does not depend on the period
    await page.locator('#rep-calvings-empty').waitFor();
    assert.deepEqual(await rowTexts('#rep-gain-table'), ['No animal has two weighings on different days in this period.']);

    // An impossible range is explained, not sent.
    await page.fill('#rep-from', localDay(-50));
    await page.locator('#rep-from').dispatchEvent('change');
    await page.locator('#rep-content .alert', { hasText: 'The From date must be on or before the To date.' }).waitFor();
    await page.selectOption('#rep-preset', 'all');
    await page.locator('#rep-calvings', { hasText: '2' }).waitFor();
  });

  test('performance tables export as CSV', async () => {
    const gain = await exportCsv('gain');
    assert.equal(gain.name, `daily-gain-by-animal-start-to-${localDay()}.csv`);
    assert.deepEqual(gain.lines, [
      'Cow ID,Name,Group,First weighing,First weight (lbs),Last weighing,Last weight (lbs),Days,Gain (lbs),Daily gain (lbs/day)',
      `R-2,"<img src=x onerror=""window.__xss=1"">",Males,${localDay(-50)},1000,${localDay(-10)},1100,40,100,2.5`,
      `R-1,Rosie,Females,${localDay(-400)},900,${localDay(-20)},1000,380,100,0.26`,
    ]);
    const herd = await exportCsv('herd');
    assert.deepEqual(herd.lines, ['Month,Counted up to,Animals added,Herd size', `${localDay().slice(0, 7)},${localDay()},3,3`]);
    const summary = await exportCsv('summary');
    assert.ok(summary.lines.includes('Calving rate,50,%'), summary.lines.join('\n'));
    assert.ok(summary.lines.includes('Average calving interval,370,days'));
    assert.ok(summary.lines.includes('Herd average daily gain,1.38,lbs/day'));
    assert.ok((await exportCsv('calvings')).lines.includes('Outcome,Alive,2,100'));
    assert.deepEqual((await exportCsv('gain-groups')).lines.slice(1), ['Females,1,0.26', 'Males,1,2.5', 'Whole herd,2,1.38']);
  });

  test('Health Reports shows different content: treatments and animals needing attention', async () => {
    await session.showView('health-reports');
    await page.locator('#rep-treatments').waitFor();
    assert.equal(await text('#secondary-view-title'), 'Health Reports');
    assert.equal(await page.inputValue('#rep-preset'), 'all', 'the period is kept between the two pages');
    assert.equal(await page.locator('#rep-herd-table, #rep-gain-table, #rep-calving-rate').count(), 0);

    assert.equal(await text('#rep-treatments'), '2');
    assert.equal(await text('#rep-animals-treated'), '2');
    assert.equal(await text('#rep-under-treatment'), '1');
    assert.equal(await text('#rep-quarantine'), '1');
    assert.equal(await text('#rep-withdrawal'), '1');
    assert.equal(await text('#rep-overdue'), '1');

    assert.deepEqual(await rowTexts('#rep-types-table'), ['Treatment 1 1 50%', 'Vaccination 1 1 50%', 'Vet visit 0 0 0%', 'Other 0 0 0%']);
    const months = await rowTexts('#rep-months-table');
    assert.equal(months.length, 2);
    assert.match(months[0], / 0 1 0 0 1$/); // the vaccination, 400 days ago
    assert.match(months[1], / 1 0 0 0 1$/);
    assert.deepEqual(await rowTexts('#rep-attention-table'), [
      `R-3 Tess Under Treatment — ${localDay(-5)} · Treatment · Penicillin`,
      `R-2 ${XSS_NAME} In Quarantine — ${localDay(-400)} · Vaccination · =Vax`,
    ]);
    assert.deepEqual(await rowTexts('#rep-withdrawal-table'), [`R-3 Tess ${localDay(3)} 3 days left Penicillin ${localDay(-5)}`]);
    assert.deepEqual(await rowTexts('#rep-followups-table'), [`R-3 Tess Treatment Penicillin ${localDay(-5)} ${localDay(-1)} 1 day overdue`]);
  });

  test('the period changes the treatment counts but not the current lists', async () => {
    await page.selectOption('#rep-preset', '12m');
    await page.locator('#rep-treatments', { hasText: '1' }).waitFor();
    assert.equal(await text('#rep-animals-treated'), '1');
    assert.deepEqual((await rowTexts('#rep-types-table')).slice(0, 2), ['Treatment 1 1 100%', 'Vaccination 0 0 0%']);
    assert.equal((await rowTexts('#rep-months-table')).length, 1);
    assert.equal(await text('#rep-quarantine'), '1');
    assert.equal((await rowTexts('#rep-attention-table')).length, 2);
    assert.equal(await text('#rep-overdue'), '1');
  });

  test('health tables export as CSV', async () => {
    const followUps = await exportCsv('follow-ups');
    assert.equal(followUps.name, `treatment-follow-ups-${localDay()}.csv`);
    assert.deepEqual(followUps.lines, [
      'Cow ID,Name,Type,Product,Last given,Next due,Days until due,Status',
      `R-3,Tess,Treatment,Penicillin,${localDay(-5)},${localDay(-1)},-1,Overdue`,
    ]);
    const types = await exportCsv('types');
    assert.match(types.name, /^treatments-by-type-\d{4}-\d{2}-01-to-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.deepEqual(types.lines, ['Type,Treatments,Animals,Share %', 'Treatment,1,1,100', 'Vaccination,0,0,0', 'Vet visit,0,0,0', 'Other,0,0,0', 'Total,1,1,100']);
    assert.deepEqual((await exportCsv('months')).lines, ['Month,Treatment,Vaccination,Vet visit,Other,Total', `${localDay(-5).slice(0, 7)},1,0,0,0,1`]);
    // Markup in a name is quoted as text, and a product that looks like a formula is defused.
    assert.deepEqual((await exportCsv('attention')).lines.slice(1), [
      `R-3,Tess,Under Treatment,,${localDay(-5)},Treatment,Penicillin`,
      `R-2,"<img src=x onerror=""window.__xss=1"">",In Quarantine,,${localDay(-400)},Vaccination,'=Vax`,
    ]);
    assert.deepEqual((await exportCsv('withdrawal')).lines.slice(1), [`R-3,Tess,${localDay(3)},3,Penicillin,${localDay(-5)}`]);
  });

  test('an empty table says so instead of downloading an empty file', async () => {
    await page.fill('#rep-from', localDay(-200));
    await page.fill('#rep-to', localDay(-100));
    await page.locator('#rep-to').dispatchEvent('change');
    await page.locator('#rep-treatments', { hasText: '0' }).waitFor();
    await page.click('.rep-export[data-export="months"]');
    await page.locator('#notification.show', { hasText: 'This table has no rows to export.' }).waitFor();
    await page.selectOption('#rep-preset', '12m');
    await page.locator('#rep-treatments', { hasText: '1' }).waitFor();
  });

  test('the print layout hides navigation, filter and buttons and keeps the report', async () => {
    await page.emulateMedia({ media: 'print' });
    try {
      for (const hidden of ['aside', 'nav.navbar', '#rep-filter', '#rep-print-btn', '.rep-export']) {
        assert.equal(await page.locator(hidden).first().isVisible(), false, hidden);
      }
      for (const shown of ['#secondary-view-title', '#rep-period', '#rep-treatments', '#rep-types-table', '#rep-followups-table', '#rep-definitions']) {
        assert.equal(await page.locator(shown).isVisible(), true, shown);
      }
      const { main, viewport } = await page.evaluate(() => ({
        main: document.querySelector('main').getBoundingClientRect().width,
        viewport: document.documentElement.clientWidth,
      }));
      assert.ok(main >= viewport - 40, `main is ${main}px of ${viewport}px`);
    } finally {
      await page.emulateMedia({ media: 'screen' });
    }
  });

  test('Financial Reports is a third, different page', async () => {
    await session.showView('financial-reports');
    await page.locator('#fin-report-income').waitFor();
    assert.equal(await text('#secondary-view-title'), 'Financial Reports');
    assert.equal(await page.locator('#rep-content').count(), 0);
  });

  test('names were shown as text and no JavaScript errors happened', async () => {
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.deepEqual(session.pageErrors, []);
  });
});
