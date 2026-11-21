// Browser test for calving records: record a calving from the Calving Records page and from a
// cow's details, add the calf as an animal, edit and delete. Run with `npm run test:e2e`.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { useBrowser } = require('./helpers/browser');

const today = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

describe('calving records in the browser', () => {
  const session = useBrowser();
  let page;
  let daisy;

  const toast = (text) => page.locator('#notification.show', { hasText: text }).waitFor();
  const pageRows = () => page.locator('#calving-body tr');
  const historyRows = () => page.locator('#cow-tab-calvings tbody tr');
  const openDetails = async (tag) => {
    await session.showView('cattle');
    await page.locator('#list-body tr', { hasText: tag }).locator('.btn-view').click();
    await page.locator('#viewCowModal.show').waitFor();
  };
  const closeDetails = async () => {
    await page.locator('#viewCowModal .modal-footer button').click();
    await page.locator('#viewCowModal').waitFor({ state: 'hidden' });
  };

  test('set up: a signed-in user with a pregnant cow, a cow with markup in her name, and a bull', async () => {
    const user = await session.signIn('calving@example.com');
    page = session.page;
    const insert = (tag, name, gender, expected, status) =>
      session.pool.query(
        `INSERT INTO cattle (owner_id, tag_number, name_breed, gender, expected_calving_date, health_status)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [user.id, tag, name, gender, expected, status]
      );
    daisy = (await insert('DAISY-1', 'Daisy Holstein', 'female', daysFromNow(10), 'pregnant')).rows[0].id;
    await insert('XSS-1', '<img src=x onerror="window.__xss=1">', 'female', null, 'healthy');
    await insert('BULL-1', 'Maximus', 'male', null, 'healthy');
    await page.reload();
    await page.locator('#recent-body tr', { hasText: 'DAISY-1' }).waitFor();
  });

  test('the Calving Records page starts empty and lists the expected calving at the top', async () => {
    await session.showView('calving');
    await page.locator('#view-calving').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#view-cattle').isVisible(), false);
    await page.locator('#calving-empty', { hasText: 'No calvings recorded yet' }).waitFor();
    assert.equal(await pageRows().count(), 0);

    const upcoming = page.locator('#calving-upcoming li');
    assert.equal(await upcoming.count(), 1);
    assert.match(await upcoming.innerText(), /DAISY-1[\s\S]*Daisy Holstein[\s\S]*Due in (9|10) days/);
  });

  test('record a calving from the page, adding the calf as a new animal', async () => {
    await page.locator('#calving-upcoming .btn-calving-add').click();
    await page.locator('#calvingModal.show').waitFor();
    assert.equal(await page.locator('#cv-cow').inputValue(), daisy);
    assert.equal(await page.locator('#cv-date').inputValue(), today());
    assert.deepEqual(
      await page.locator('#cv-cow option').allInnerTexts(),
      ['Select a cow', 'DAISY-1 · Daisy Holstein', 'XSS-1 · <img src=x onerror="window.__xss=1">'],
      'bulls are not offered'
    );
    assert.equal(await page.locator('#cv-clear-expected').isChecked(), true);
    assert.match(await page.locator('#cv-clear-expected-label').innerText(), /and Pregnant status/);

    await page.selectOption('#cv-calf-sex', 'female');
    await page.fill('#cv-weight', '84.5');
    await page.selectOption('#cv-ease', 'assisted');
    await page.fill('#cv-notes', 'Up within the hour <b>bold</b>');
    await page.check('#cv-add-calf');

    // The calf number is needed to add the calf; the form says so and stays open.
    await page.click('#calving-form button[type="submit"]');
    await toast('Enter a calf number to add the calf as a new animal');
    // A number that is already in the herd is refused before anything is saved.
    await page.fill('#cv-calf-tag', 'bull-1');
    await page.click('#calving-form button[type="submit"]');
    await toast('That calf number is already used by another animal');
    assert.equal((await session.pool.query('SELECT 1 FROM calving_events')).rowCount, 0);

    await page.fill('#cv-calf-tag', 'CALF-1');
    await page.click('#calving-form button[type="submit"]');
    await toast('Calving recorded and calf CALF-1 added to the herd');
    await page.locator('#calvingModal').waitFor({ state: 'hidden' });
  });

  test('the calving appears on the Calving Records page', async () => {
    const row = pageRows().filter({ hasText: 'DAISY-1' });
    await row.waitFor();
    assert.equal(await pageRows().count(), 1);
    const text = await row.innerText();
    for (const part of [today(), 'Daisy Holstein', 'Heifer', 'CALF-1', '84.5 lbs', 'Assisted', 'Alive', 'Up within the hour <b>bold</b>']) {
      assert.ok(text.includes(part), `row shows ${part}: ${text}`);
    }
    assert.equal(await row.locator('b').count(), 0, 'notes are shown as text, not markup');
    assert.equal(await page.locator('#calving-count').innerText(), 'Showing 1 of 1');
    // Her expected calving was cleared, so nothing is upcoming any more.
    await page.locator('#calving-upcoming', { hasText: 'No upcoming expected calvings' }).waitFor();
  });

  test("the cow's last calving date updated and the calf is in the herd", async () => {
    await session.showView('cattle');
    const cowRow = page.locator('#list-body tr', { hasText: 'DAISY-1' });
    assert.ok((await cowRow.innerText()).includes(`Last: ${today()}`));
    assert.ok((await cowRow.innerText()).includes('Healthy'));
    const calfRow = page.locator('#list-body tr', { hasText: 'CALF-1' });
    assert.match(await calfRow.innerText(), /Female/);
    assert.ok((await calfRow.innerText()).includes(today()), 'birth date is the calving date');

    const { rows } = await session.pool.query(
      "SELECT tag_number, gender, birth_date, weight, notes FROM cattle WHERE tag_number = 'CALF-1'"
    );
    assert.deepEqual(rows, [{ tag_number: 'CALF-1', gender: 'female', birth_date: today(), weight: '84.50', notes: 'Calf of DAISY-1.' }]);
  });

  test("the calving appears in the cow's details, on the Calving history tab", async () => {
    await openDetails('DAISY-1');
    assert.ok((await page.locator('#cow-tab-details').innerText()).includes(`Last Calving: ${today()}`));
    assert.equal(await page.locator('#cow-tab-calvings').isVisible(), false);

    await page.locator('#viewCowModal [data-tab="calvings"]').click();
    await historyRows().first().waitFor();
    assert.equal(await historyRows().count(), 1);
    const text = await historyRows().first().innerText();
    for (const part of [today(), 'CALF-1', '84.5 lbs', 'Assisted', 'Alive']) assert.ok(text.includes(part), `history shows ${part}`);
    assert.ok((await page.locator('#cow-tab-calvings').innerText()).includes('1 calving recorded'));
  });

  test("record an earlier calving from the cow's details; the details reopen on the history tab", async () => {
    await page.locator('#cow-tab-calvings .btn-calving-add').click();
    await page.locator('#calvingModal.show').waitFor();
    await page.locator('#viewCowModal').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#cv-cow').inputValue(), daisy);
    assert.equal(await page.locator('#cv-clear-expected-wrap').isVisible(), false, 'no expected date left to clear');

    await page.fill('#cv-date', '2024-04-02');
    await page.selectOption('#cv-outcome', 'stillborn');
    assert.equal(await page.locator('#cv-add-calf').isDisabled(), true, 'a stillborn calf cannot be added');
    await page.click('#calving-form button[type="submit"]');
    await toast('Calving recorded');

    await page.locator('#viewCowModal.show').waitFor();
    await page.locator('#cow-tab-calvings.active').waitFor();
    await historyRows().nth(1).waitFor();
    assert.deepEqual(
      (await historyRows().allInnerTexts()).map((t) => t.trim().slice(0, 10)),
      [today(), '2024-04-02'],
      'newest first'
    );
    assert.ok((await historyRows().nth(1).innerText()).includes('Stillborn'));
    // An older calving does not move the last calving date.
    await page.locator('#viewCowModal [data-tab="details"]').click();
    assert.ok((await page.locator('#cow-tab-details').innerText()).includes(`Last Calving: ${today()}`));
    await closeDetails();
  });

  test('a bull has no calving history tab', async () => {
    await openDetails('BULL-1');
    assert.equal(await page.locator('#viewCowModal [data-tab="details"]').count(), 1);
    assert.equal(await page.locator('#viewCowModal [data-tab="calvings"]').count(), 0);
    await closeDetails();
  });

  test('filters narrow the herd-wide table', async () => {
    await session.showView('calving');
    await pageRows().nth(1).waitFor();
    assert.deepEqual(await page.locator('#calving-filter-year option').allInnerTexts(), ['All Years', today().slice(0, 4), '2024']);

    await page.selectOption('#calving-filter-outcome', 'stillborn');
    assert.equal(await pageRows().count(), 1);
    assert.ok((await pageRows().first().innerText()).includes('2024-04-02'));
    assert.equal(await page.locator('#calving-count').innerText(), 'Showing 1 of 2');

    await page.selectOption('#calving-filter-outcome', 'all');
    await page.selectOption('#calving-filter-year', today().slice(0, 4));
    assert.equal(await pageRows().count(), 1);
    assert.ok((await pageRows().first().innerText()).includes('CALF-1'));

    await page.selectOption('#calving-filter-year', 'all');
    await page.fill('#calving-search', 'no such calving');
    assert.equal(await pageRows().count(), 0);
    await page.locator('#calving-empty', { hasText: 'No calvings match these filters' }).waitFor();
    await page.fill('#calving-search', 'calf-1');
    assert.equal(await pageRows().count(), 1);
    await page.fill('#calving-search', '');
    assert.equal(await pageRows().count(), 2);
  });

  test('edit a calving from the page', async () => {
    await pageRows().filter({ hasText: '2024-04-02' }).locator('.btn-calving-edit').click();
    await page.locator('#calvingModal.show').waitFor();
    assert.equal(await page.locator('#calvingModalTitle').innerText(), 'Edit Calving Record');
    assert.equal(await page.locator('#cv-cow').isDisabled(), true);
    assert.equal(await page.locator('#cv-date').inputValue(), '2024-04-02');
    assert.equal(await page.locator('#cv-outcome').inputValue(), 'stillborn');
    assert.equal(await page.locator('#cv-create-options').isVisible(), false);

    await page.fill('#cv-date', '2024-04-05');
    await page.selectOption('#cv-ease', 'caesarean');
    await page.click('#calving-form button[type="submit"]');
    await toast('Calving record updated');
    await page.locator('#calvingModal').waitFor({ state: 'hidden' });

    const row = pageRows().filter({ hasText: '2024-04-05' });
    await row.waitFor();
    assert.ok((await row.innerText()).includes('Caesarean'));
    assert.equal(await pageRows().count(), 2);
  });

  test('user data is shown as text everywhere on the page', async () => {
    const xss = (await session.pool.query("SELECT id FROM cattle WHERE tag_number = 'XSS-1'")).rows[0].id;
    await page.locator('#view-calving > div .btn-calving-add').click();
    await page.locator('#calvingModal.show').waitFor();
    await page.selectOption('#cv-cow', xss);
    await page.fill('#cv-calf-tag', '"><script>window.__xss=2</script>');
    await page.fill('#cv-notes', '<img src=x onerror="window.__xss=3">');
    await page.click('#calving-form button[type="submit"]');
    await toast('Calving recorded');
    await page.locator('#calvingModal').waitFor({ state: 'hidden' });

    const row = pageRows().filter({ hasText: 'XSS-1' });
    await row.waitFor();
    assert.ok((await row.innerText()).includes('<img src=x onerror="window.__xss=1">'));
    assert.ok((await row.innerText()).includes('"><scr'));
    assert.equal(await page.locator('#view-calving img, #view-calving script').count(), 0);

    await row.locator('.btn-view').click();
    await page.locator('#viewCowModal.show').waitFor();
    await page.locator('#viewCowModal [data-tab="calvings"]').click();
    await historyRows().first().waitFor();
    assert.equal(await page.locator('#viewCowModal img, #viewCowModal script').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
  });

  test("delete a calving from the cow's details; her last calving date clears", async () => {
    await historyRows().first().locator('.btn-calving-delete').click();
    await toast('Calving record deleted');
    await page.locator('#cow-tab-calvings', { hasText: 'No calvings recorded for this animal' }).waitFor();
    await page.locator('#viewCowModal [data-tab="details"]').click();
    assert.ok((await page.locator('#cow-tab-details').innerText()).includes('Last Calving: N/A'));
    await closeDetails();

    // The page underneath was refreshed too.
    await pageRows().filter({ hasText: 'XSS-1' }).waitFor({ state: 'detached' });
    assert.equal(await pageRows().count(), 2);
  });

  test('delete the newest calving from the page; the last calving date falls back', async () => {
    await pageRows().filter({ hasText: 'CALF-1' }).locator('.btn-calving-delete').click();
    await toast('Calving record deleted');
    await pageRows().filter({ hasText: 'CALF-1' }).waitFor({ state: 'detached' });
    assert.equal(await pageRows().count(), 1);

    const { rows } = await session.pool.query("SELECT last_calving_date FROM cattle WHERE tag_number = 'DAISY-1'");
    assert.equal(rows[0].last_calving_date, '2024-04-05');
    await session.showView('cattle');
    assert.ok((await page.locator('#list-body tr', { hasText: 'DAISY-1' }).innerText()).includes('Last: 2024-04-05'));
    assert.equal(await page.locator('#list-body tr', { hasText: 'CALF-1' }).count(), 1, 'the calf stays in the herd');
  });

  test('the cattle form: last calving date is typed for a new cow and read-only afterwards', async () => {
    await session.showView('dashboard');
    await page.click('#open-add-modal-btn');
    await page.locator('#cattleModal.show').waitFor();
    assert.equal(await page.locator('#f-last-calving').isDisabled(), false);
    await page.fill('#f-tag', 'NEW-1');
    await page.selectOption('#f-gender', 'female');
    await page.fill('#f-last-calving', '2025-05-05');
    await page.click('#cattle-form button[type="submit"]');
    await toast('New cow added to herd');
    await page.locator('#cattleModal').waitFor({ state: 'hidden' });

    await session.showView('calving');
    const row = pageRows().filter({ hasText: 'NEW-1' });
    await row.waitFor();
    assert.ok((await row.innerText()).includes('2025-05-05'));

    await session.showView('cattle');
    await page.locator('#list-body tr', { hasText: 'NEW-1' }).locator('.btn-edit').click();
    await page.locator('#cattleModal.show').waitFor();
    assert.equal(await page.locator('#f-last-calving').isDisabled(), true);
    assert.equal(await page.locator('#f-last-calving').inputValue(), '2025-05-05');
    assert.match(await page.locator('#f-last-calving-help').innerText(), /Set by her calving records/);
    await page.fill('#f-name', 'Newcomer');
    await page.click('#cattle-form button[type="submit"]');
    await toast('Cattle record updated');
    await page.locator('#cattleModal').waitFor({ state: 'hidden' });
    const { rows } = await session.pool.query("SELECT name_breed, last_calving_date FROM cattle WHERE tag_number = 'NEW-1'");
    assert.deepEqual(rows, [{ name_breed: 'Newcomer', last_calving_date: '2025-05-05' }]);
  });

  test('no uncaught JavaScript errors happened along the way', () => {
    assert.deepEqual(session.pageErrors, []);
  });
});
