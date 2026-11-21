// Browser test for weight tracking: batch-enter weights on the Weights page (with rows that fail),
// see the current weight and average daily gain in the cow's details, record from the details,
// edit, delete, and change the weight from the cattle form. Run with `npm run test:e2e`.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { useBrowser } = require('./helpers/browser');

// Local calendar dates, as the app uses them.
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const today = () => localDay(0);

describe('weight tracking in the browser', () => {
  const session = useBrowser();
  let page;
  let ids;

  const toast = (text) => page.locator('#notification.show', { hasText: text }).waitFor();
  const batchRows = () => page.locator('#weight-batch-body tr');
  const pageRows = () => page.locator('#weights-body tr');
  const historyRows = () => page.locator('#cow-tab-weights tbody tr');
  const currentWeight = async (tag) =>
    (await session.pool.query('SELECT weight FROM cattle WHERE tag_number = $1', [tag])).rows[0].weight;
  const openDetails = async (tag) => {
    await session.showView('cattle');
    await page.locator('#list-body tr', { hasText: tag }).locator('.btn-view').click();
    await page.locator('#viewCowModal.show').waitFor();
  };
  const openWeightTab = async () => {
    await page.locator('#viewCowModal [data-tab="weights"]').click();
    await page.locator('#cow-tab-weights [data-weight-current]').waitFor();
  };
  const closeDetails = async () => {
    await page.locator('#viewCowModal .modal-footer button').click();
    await page.locator('#viewCowModal').waitFor({ state: 'hidden' });
  };

  test('set up: a cow weighed 30 days ago, one never weighed, and one with markup in her name', async () => {
    const user = await session.signIn('weights@example.com');
    page = session.page;
    const insert = async (tag, name, weight) =>
      (await session.pool.query(
        'INSERT INTO cattle (owner_id, tag_number, name_breed, weight) VALUES ($1,$2,$3,$4) RETURNING id',
        [user.id, tag, name, weight]
      )).rows[0].id;
    ids = {
      daisy: await insert('DAISY-1', 'Daisy Holstein', 1000),
      bess: await insert('BESS-1', 'Bess Angus', null),
      xss: await insert('XSS-1', '<img src=x onerror="window.__xss=1">', null),
    };
    await session.pool.query(
      'INSERT INTO weighings (cattle_id, owner_id, date, weight) VALUES ($1, $2, $3, 1000)',
      [ids.daisy, user.id, localDay(-30)]
    );
    await page.reload();
    await page.locator('#recent-body tr', { hasText: 'DAISY-1' }).waitFor();
  });

  test('the Weights page lists the history and offers three empty batch rows dated today', async () => {
    await session.showView('weights');
    await page.locator('#view-weights').waitFor({ state: 'visible' });
    await pageRows().first().waitFor();
    assert.equal(await pageRows().count(), 1);
    assert.match(await pageRows().first().innerText(), /DAISY-1[\s\S]*1,000 lbs[\s\S]*First weighing/);
    assert.equal(await page.locator('#weight-batch-date').inputValue(), today());
    assert.equal(await batchRows().count(), 3);
    assert.deepEqual(
      await batchRows().first().locator('.wb-cow option').allInnerTexts(),
      ['Select an animal', 'BESS-1 · Bess Angus', 'DAISY-1 · Daisy Holstein (1,000 lbs)', 'XSS-1 · <img src=x onerror="window.__xss=1">']
    );
  });

  test('batch entry saves the valid rows and keeps the failed ones with the reason', async () => {
    const row = (n) => batchRows().nth(n);
    await row(0).locator('.wb-cow').selectOption(ids.daisy);
    await row(0).locator('.wb-weight').fill('1060');
    await row(0).locator('.wb-notes').fill('Monthly weigh-in');
    await row(1).locator('.wb-cow').selectOption(ids.bess);
    await row(1).locator('.wb-weight').fill('0');
    await row(2).locator('.wb-cow').selectOption(ids.xss);
    await row(2).locator('.wb-weight').fill('700');
    await row(2).locator('.wb-notes').fill('<b>calm</b>');
    await page.click('#weight-batch-add-row');
    assert.equal(await batchRows().count(), 4);
    await row(3).locator('.wb-weight').fill('500');
    await page.click('#weight-batch-add-row'); // a fifth, empty row: skipped

    await page.click('#weight-batch-form button[type="submit"]');
    await toast('Saved 2 weights; 2 not saved');
    await page.locator('#weight-batch-result', { hasText: `Saved 2 weights for ${today()}. 2 rows not saved` }).waitFor();

    // The saved rows left the form; the failed ones stayed, marked, plus the empty one.
    assert.equal(await batchRows().count(), 3);
    assert.equal(await row(0).locator('.wb-cow').inputValue(), ids.bess);
    assert.equal(await row(0).locator('.wb-error').innerText(), 'Weight must be more than 0 and at most 5000 lbs');
    assert.equal(await row(1).locator('.wb-error').innerText(), 'Choose an animal');
    assert.equal(await row(2).locator('.wb-error').isVisible(), false);

    assert.equal(await currentWeight('DAISY-1'), '1060.00');
    assert.equal(await currentWeight('XSS-1'), '700.00');
    assert.equal(await currentWeight('BESS-1'), null);
  });

  test('fix the failed row, remove the other, and save again', async () => {
    await batchRows().nth(0).locator('.wb-weight').fill('640.5');
    await batchRows().nth(1).locator('.btn-weight-batch-remove').click();
    await page.click('#weight-batch-form button[type="submit"]');
    await toast('Saved 1 weight');
    await page.locator('#weight-batch-result', { hasText: `Saved 1 weight for ${today()}.` }).waitFor();
    assert.equal(await currentWeight('BESS-1'), '640.50');
    assert.equal(await batchRows().count(), 1, 'only the empty row is left');
    assert.equal(await page.locator('#weight-batch-body .is-invalid').count(), 0);
  });

  test('the history shows each weighing with its gain since the previous one', async () => {
    await pageRows().nth(3).waitFor();
    assert.equal(await pageRows().count(), 4);
    const daisy = pageRows().filter({ hasText: 'Monthly weigh-in' });
    const text = await daisy.innerText();
    for (const part of [today(), 'DAISY-1', '1,060 lbs', '+60 lbs', '+2.00 lbs/day over 30 days']) {
      assert.ok(text.includes(part), `row shows ${part}: ${text}`);
    }
    const xssRow = pageRows().filter({ hasText: 'XSS-1' });
    assert.ok((await xssRow.innerText()).includes('<b>calm</b>'));
    assert.equal(await page.locator('#view-weights b, #view-weights img').count(), 0, 'markup is shown as text');

    await page.fill('#weight-search', 'bess');
    assert.equal(await pageRows().count(), 1);
    assert.equal(await page.locator('#weights-count').innerText(), 'Showing 1 of 4');
    await page.fill('#weight-search', '');
    assert.equal(await pageRows().count(), 4);
  });

  test("the cow's details show the current weight and the average daily gain, with a chart", async () => {
    await openDetails('DAISY-1');
    assert.ok((await page.locator('#cow-tab-details').innerText()).includes('Weight: 1060 lbs'));
    await openWeightTab();
    const pane = page.locator('#cow-tab-weights');
    assert.equal(await pane.locator('[data-weight-current]').innerText(), '1,060 lbs');
    assert.match(await pane.locator('[data-weight-adg]').innerText(), /^\+2\.00 lbs\/day\s+\+60 lbs in 30 days$/);
    assert.match(await pane.innerText(), new RegExp(`Average daily gain, ${localDay(-30)} to ${today()}`));
    assert.equal(await pane.locator('svg.weight-chart .weight-chart-dot').count(), 2);
    assert.equal(await historyRows().count(), 2);
    assert.deepEqual((await historyRows().allInnerTexts()).map((t) => t.trim().slice(0, 10)), [today(), localDay(-30)]);
  });

  test("record an earlier weighing from the details; the details reopen on the weight tab", async () => {
    await page.locator('#cow-tab-weights .btn-weight-add').click();
    await page.locator('#weighingModal.show').waitFor();
    await page.locator('#viewCowModal').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#wt-cow').inputValue(), ids.daisy);
    assert.equal(await page.locator('#wt-date').inputValue(), today());

    await page.fill('#wt-weight', '0');
    await page.click('#weighing-form button[type="submit"]');
    await toast('Weight must be more than 0 and at most 5000 lbs');

    await page.fill('#wt-date', localDay(-15));
    await page.fill('#wt-weight', '1020');
    await page.click('#weighing-form button[type="submit"]');
    await toast('Weight recorded');
    await page.locator('#viewCowModal.show').waitFor();
    await page.locator('#cow-tab-weights.active').waitFor();
    await historyRows().nth(2).waitFor();
    assert.deepEqual((await historyRows().allInnerTexts()).map((t) => t.trim().slice(0, 10)), [today(), localDay(-15), localDay(-30)]);
    assert.ok((await historyRows().nth(0).innerText()).includes('+2.67 lbs/day over 15 days'), 'gain since the previous weighing');
    assert.equal(await page.locator('#cow-tab-weights [data-weight-current]').innerText(), '1,060 lbs', 'an older weighing does not change it');
    assert.equal(await page.locator('#cow-tab-weights svg .weight-chart-dot').count(), 3);
    await closeDetails();
  });

  test('edit the newest weighing from the page; the current weight and ADG follow', async () => {
    await session.showView('weights');
    await pageRows().filter({ hasText: 'Monthly weigh-in' }).locator('.btn-weight-edit').click();
    await page.locator('#weighingModal.show').waitFor();
    assert.equal(await page.locator('#weighingModalTitle').innerText(), 'Edit Weighing');
    assert.equal(await page.locator('#wt-cow').isDisabled(), true);
    assert.equal(await page.locator('#wt-weight').inputValue(), '1060');
    await page.fill('#wt-weight', '1090');
    await page.click('#weighing-form button[type="submit"]');
    await toast('Weighing updated');
    await page.locator('#weighingModal').waitFor({ state: 'hidden' });
    await pageRows().filter({ hasText: '1,090 lbs' }).waitFor();
    assert.equal(await currentWeight('DAISY-1'), '1090.00');

    await openDetails('DAISY-1');
    await openWeightTab();
    assert.match(await page.locator('#cow-tab-weights [data-weight-adg]').innerText(), /^\+3\.00 lbs\/day/);
  });

  test('delete the newest weighing from the details; the weight falls back', async () => {
    await historyRows().first().locator('.btn-weight-delete').click();
    await toast('Weighing deleted');
    await page.locator('#cow-tab-weights [data-weight-current]', { hasText: '1,020 lbs' }).waitFor();
    assert.equal(await historyRows().count(), 2);
    assert.equal(await currentWeight('DAISY-1'), '1020.00');
    await closeDetails();
  });

  test('the cattle form: a changed weight is saved as a weighing dated today', async () => {
    await session.showView('cattle');
    await page.locator('#list-body tr', { hasText: 'DAISY-1' }).locator('.btn-edit').click();
    await page.locator('#cattleModal.show').waitFor();
    assert.equal(await page.locator('#f-weight').inputValue(), '1020');
    assert.match(await page.locator('#f-weight-help').innerText(), /saved as a weighing dated today/);
    await page.fill('#f-weight', '1075');
    await page.click('#cattle-form button[type="submit"]');
    await toast('Cattle record updated');
    await page.locator('#cattleModal').waitFor({ state: 'hidden' });

    const { rows } = await session.pool.query(
      'SELECT date, weight FROM weighings WHERE cattle_id = $1 ORDER BY date DESC, created_at DESC',
      [ids.daisy]
    );
    assert.deepEqual(rows.map((r) => [r.date, r.weight]), [[today(), '1075.00'], [localDay(-15), '1020.00'], [localDay(-30), '1000.00']]);
    assert.equal(await currentWeight('DAISY-1'), '1075.00');

    // Saving again without touching the weight records nothing new.
    await page.locator('#list-body tr', { hasText: 'DAISY-1' }).locator('.btn-edit').click();
    await page.locator('#cattleModal.show').waitFor();
    await page.fill('#f-name', 'Daisy II');
    await page.click('#cattle-form button[type="submit"]');
    await toast('Cattle record updated');
    await page.locator('#cattleModal').waitFor({ state: 'hidden' });
    assert.equal((await session.pool.query('SELECT 1 FROM weighings WHERE cattle_id = $1', [ids.daisy])).rowCount, 3);
  });

  test('a new animal with a weight gets its first weighing', async () => {
    await session.showView('dashboard');
    await page.click('#open-add-modal-btn');
    await page.locator('#cattleModal.show').waitFor();
    assert.match(await page.locator('#f-weight-help').innerText(), /first weighing, dated today/);
    await page.fill('#f-tag', 'NEW-1');
    await page.fill('#f-weight', '450');
    await page.click('#cattle-form button[type="submit"]');
    await toast('New cow added to herd');
    await page.locator('#cattleModal').waitFor({ state: 'hidden' });
    await session.showView('weights');
    const row = pageRows().filter({ hasText: 'NEW-1' });
    await row.waitFor();
    assert.match(await row.innerText(), new RegExp(`${today()}[\\s\\S]*450 lbs[\\s\\S]*First weighing`));
  });

  test('"Add All Animals" offers a row for every animal not in the form yet', async () => {
    await page.click('#weight-batch-fill');
    const chosen = await batchRows().locator('.wb-cow').evaluateAll((selects) => selects.map((s) => s.value));
    assert.deepEqual(new Set(chosen), new Set([ids.bess, ids.daisy, ids.xss, (await session.pool.query("SELECT id FROM cattle WHERE tag_number='NEW-1'")).rows[0].id]));
    assert.equal(chosen.length, 4, 'the empty row was filled first');
  });

  test("the marked-up animal's details show its name and notes as text", async () => {
    await pageRows().filter({ hasText: 'XSS-1' }).locator('.btn-view').click();
    await page.locator('#viewCowModal.show').waitFor();
    await openWeightTab();
    assert.ok((await historyRows().first().innerText()).includes('<b>calm</b>'));
    assert.equal(await page.locator('#viewCowModal img, #viewCowModal b, #viewCowModal script').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    await closeDetails();
  });

  test('no uncaught JavaScript errors happened along the way', () => {
    assert.deepEqual(session.pageErrors, []);
  });
});
