// Browser test for medical records: record a treatment with a next-due date and a withdrawal
// period, see it under Upcoming, on the dashboard and in the cattle tables; record an overdue one
// from a cow's details and see the dashboard alert; record the follow-up, edit and delete.
// Run with `npm run test:e2e`.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { useBrowser } = require('./helpers/browser');

// Local calendar dates, as the browser (same machine) sees them.
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('medical records in the browser', () => {
  const session = useBrowser();
  let page;
  let daisy;
  let bull;

  const toast = (text) => page.locator('#notification.show', { hasText: text }).waitFor();
  const pageRows = () => page.locator('#treatment-body tr');
  const dueItems = () => page.locator('#treatment-due li[data-treatment-id]');
  const historyRows = () => page.locator('#cow-tab-treatments tbody tr');
  const text = (selector) => page.locator(selector).innerText();
  const openDetails = async (tag) => {
    await session.showView('cattle');
    await page.locator('#list-body tr', { hasText: tag }).locator('.btn-view').click();
    await page.locator('#viewCowModal.show').waitFor();
  };
  const closeDetails = async () => {
    await page.locator('#viewCowModal .modal-footer button').click();
    await page.locator('#viewCowModal').waitFor({ state: 'hidden' });
  };
  const save = async (message) => {
    await page.click('#treatment-form button[type="submit"]');
    await toast(message);
    await page.locator('#treatmentModal').waitFor({ state: 'hidden' });
  };
  const dashboard = async () => {
    await session.showView('dashboard');
    await page.locator('#view-dashboard').waitFor({ state: 'visible' });
  };

  test('set up: a signed-in user with a cow, a bull, and an animal with markup in its name', async () => {
    const user = await session.signIn('medical@example.com');
    page = session.page;
    const insert = (tag, name, gender) =>
      session.pool.query('INSERT INTO cattle (owner_id, tag_number, name_breed, gender) VALUES ($1,$2,$3,$4) RETURNING id', [user.id, tag, name, gender]);
    daisy = (await insert('DAISY-1', 'Daisy Holstein', 'female')).rows[0].id;
    bull = (await insert('BULL-1', 'Maximus', 'male')).rows[0].id;
    await insert('XSS-1', '<img src=x onerror="window.__xss=1">', 'female');
    await page.reload();
    await page.locator('#recent-body tr', { hasText: 'DAISY-1' }).waitFor();
  });

  test('the dashboard starts with no scheduled treatments and no alerts', async () => {
    await page.locator('#stat-treatments', { hasText: '0' }).waitFor();
    assert.equal(await text('#stat-treatments-note'), 'Due within 7 days, incl. overdue');
    assert.equal(await text('#alerts-list'), 'No alerts.');
  });

  test('the Medical Records page replaces the filtered cattle list and starts empty', async () => {
    await session.showView('medical');
    await page.locator('#view-medical').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#view-cattle').isVisible(), false);
    await page.locator('#treatment-empty', { hasText: 'No treatments recorded yet' }).waitFor();
    assert.equal(await text('#treatment-due'), 'No upcoming or overdue treatments.');
    assert.equal(await text('#treatment-withdrawals'), 'No animals are in a withdrawal period.');
  });

  test('record a treatment with a next-due date and a withdrawal period from the page', async () => {
    await page.locator('#view-medical > div .btn-treatment-add').click();
    await page.locator('#treatmentModal.show').waitFor();
    assert.equal(await text('#treatmentModalTitle'), 'Record Treatment');
    assert.equal(await page.locator('#tr-date').inputValue(), localDay(0));
    assert.equal(await page.locator('#tr-type').inputValue(), 'treatment');
    assert.deepEqual(await page.locator('#tr-cow option').allInnerTexts(), [
      'Select an animal', 'BULL-1 · Maximus', 'DAISY-1 · Daisy Holstein', 'XSS-1 · <img src=x onerror="window.__xss=1">',
    ]);

    // Checked before anything is sent.
    await page.click('#treatment-form button[type="submit"]');
    await toast('Choose the animal that was treated');
    await page.selectOption('#tr-cow', daisy);
    await page.fill('#tr-next-due', localDay(0));
    await page.click('#treatment-form button[type="submit"]');
    await toast('The next due date must be after the date given');
    assert.equal((await session.pool.query('SELECT 1 FROM treatments')).rowCount, 0);

    await page.fill('#tr-product', 'Meloxicam');
    await page.fill('#tr-dose', '15 mL');
    await page.fill('#tr-route', 'Subcutaneous');
    await page.fill('#tr-given-by', 'Dr. Patel');
    await page.fill('#tr-next-due', localDay(3));
    await page.fill('#tr-withdrawal', localDay(5));
    await page.fill('#tr-notes', 'Recheck the hoof <b>bold</b>');
    await save('Treatment recorded');
  });

  test('it appears in the history and under Upcoming, and the cow is marked as in withdrawal', async () => {
    const row = pageRows().filter({ hasText: 'DAISY-1' });
    await row.waitFor();
    const rowText = await row.innerText();
    for (const part of [localDay(0), 'Daisy Holstein', 'Treatment', 'Meloxicam', '15 mL', 'Subcutaneous', 'Dr. Patel', localDay(3), 'Due in 3 days', localDay(5), 'Running', 'Recheck the hoof <b>bold</b>']) {
      assert.ok(rowText.includes(part), `row shows ${part}: ${rowText}`);
    }
    assert.equal(await row.locator('b').count(), 0, 'notes are shown as text');

    assert.equal(await dueItems().count(), 1);
    assert.match(await dueItems().first().innerText(), /DAISY-1[\s\S]*Meloxicam[\s\S]*Due in 3 days/);
    assert.match(await text('#treatment-withdrawals'), new RegExp(`DAISY-1[\\s\\S]*Withdrawal until ${localDay(5)}`));
  });

  test('the dashboard counts it and the cattle tables show the withdrawal badge', async () => {
    await dashboard();
    await page.locator('#stat-treatments', { hasText: '1' }).waitFor();
    assert.equal(await text('#alerts-list'), 'No alerts.', 'not overdue, so no alert');
    const recent = page.locator('#recent-body tr', { hasText: 'DAISY-1' });
    assert.ok((await recent.innerText()).includes(`Withdrawal until ${localDay(5)}`));
    assert.equal(await page.locator('#recent-body tr', { hasText: 'BULL-1' }).locator('.badge-withdrawal').count(), 0);

    await session.showView('cattle');
    assert.ok((await page.locator('#list-body tr', { hasText: 'DAISY-1' }).innerText()).includes(`Withdrawal until ${localDay(5)}`));
    await openDetails('DAISY-1');
    assert.ok((await text('#cow-tab-details')).includes(`Withdrawal Period: Withdrawal until ${localDay(5)}`));
    await closeDetails();
  });

  test("record an overdue vaccination from the bull's details; the details reopen on the Treatments tab", async () => {
    await openDetails('BULL-1');
    assert.equal(await page.locator('#viewCowModal [data-tab="calvings"]').count(), 0);
    await page.locator('#viewCowModal [data-tab="treatments"]').click();
    await page.locator('#cow-tab-treatments', { hasText: 'No treatments recorded for this animal' }).waitFor();

    await page.locator('#cow-tab-treatments .btn-treatment-add').click();
    await page.locator('#treatmentModal.show').waitFor();
    await page.locator('#viewCowModal').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#tr-cow').inputValue(), bull);
    await page.fill('#tr-date', localDay(-30));
    await page.selectOption('#tr-type', 'vaccination');
    await page.fill('#tr-product', 'Ultrabac 7');
    await page.fill('#tr-next-due', localDay(-2));
    await save('Treatment recorded');

    await page.locator('#viewCowModal.show').waitFor();
    await page.locator('#cow-tab-treatments.active').waitFor();
    await historyRows().first().waitFor();
    assert.match(await historyRows().first().innerText(), /Vaccination[\s\S]*Ultrabac 7[\s\S]*2 days overdue/);
    await closeDetails();
  });

  test('the overdue vaccination is a dashboard alert and counts as scheduled', async () => {
    await dashboard();
    await page.locator('#stat-treatments', { hasText: '2' }).waitFor();
    assert.equal(await text('#stat-treatments-note'), 'Due within 7 days, incl. 1 overdue');
    const alert = page.locator('#alerts-list li', { hasText: 'Treatment overdue' });
    assert.equal(await alert.count(), 1);
    assert.match(await alert.innerText(), /Ultrabac 7 for BULL-1 Maximus[\s\S]*2 days overdue/);

    // View opens the bull's details on the Treatments tab.
    await alert.locator('.btn-treatment-open').click();
    await page.locator('#viewCowModal.show').waitFor();
    await page.locator('#cow-tab-treatments.active').waitFor();
    assert.equal(await text('#viewCowModalTitle'), 'Maximus (BULL-1)');
    await closeDetails();
  });

  test('recording the follow-up from Upcoming closes the overdue one and clears the alert', async () => {
    await session.showView('medical');
    await dueItems().nth(1).waitFor();
    assert.match(await dueItems().first().innerText(), /BULL-1[\s\S]*Ultrabac 7[\s\S]*2 days overdue/, 'overdue first');
    await dueItems().filter({ hasText: 'BULL-1' }).locator('.btn-treatment-followup').click();
    await page.locator('#treatmentModal.show').waitFor();
    assert.equal(await text('#treatmentModalTitle'), 'Record Follow-up');
    assert.equal(await page.locator('#tr-cow').inputValue(), bull);
    assert.equal(await page.locator('#tr-type').inputValue(), 'vaccination');
    assert.equal(await page.locator('#tr-product').inputValue(), 'Ultrabac 7');
    assert.equal(await page.locator('#tr-date').inputValue(), localDay(0));
    assert.equal(await page.locator('#tr-next-due').inputValue(), '');
    await page.fill('#tr-next-due', localDay(365));
    await save('Treatment recorded');

    await dueItems().filter({ hasText: 'Due in 365 days' }).waitFor();
    assert.equal(await dueItems().filter({ hasText: 'overdue' }).count(), 0);
    const old = pageRows().filter({ hasText: localDay(-30) });
    assert.ok((await old.innerText()).includes('Done'), 'the earlier record shows its follow-up was done');

    await dashboard();
    await page.locator('#stat-treatments', { hasText: '1' }).waitFor();
    assert.equal(await text('#alerts-list'), 'No alerts.');
  });

  test('edit a treatment: clearing the withdrawal date removes the badge, clearing the next due date removes it from Upcoming', async () => {
    await session.showView('medical');
    await pageRows().filter({ hasText: 'DAISY-1' }).locator('.btn-treatment-edit').click();
    await page.locator('#treatmentModal.show').waitFor();
    assert.equal(await text('#treatmentModalTitle'), 'Edit Treatment');
    assert.equal(await page.locator('#tr-cow').isDisabled(), true);
    assert.equal(await page.locator('#tr-product').inputValue(), 'Meloxicam');
    assert.equal(await page.locator('#tr-withdrawal').inputValue(), localDay(5));
    await page.fill('#tr-withdrawal', '');
    await page.fill('#tr-next-due', '');
    await page.fill('#tr-dose', '20 mL');
    await save('Treatment updated');

    await pageRows().filter({ hasText: '20 mL' }).waitFor();
    assert.equal(await dueItems().filter({ hasText: 'DAISY-1' }).count(), 0);
    assert.equal(await text('#treatment-withdrawals'), 'No animals are in a withdrawal period.');
    await session.showView('cattle');
    assert.equal(await page.locator('#list-body tr', { hasText: 'DAISY-1' }).locator('.badge-withdrawal').count(), 0);
  });

  test('filters narrow the history table', async () => {
    await session.showView('medical');
    await pageRows().nth(2).waitFor();
    assert.equal(await text('#treatment-count'), 'Showing 3 of 3');
    await page.selectOption('#treatment-filter-type', 'vaccination');
    assert.equal(await pageRows().count(), 2);
    await page.selectOption('#treatment-filter-type', 'all');
    await page.fill('#treatment-search', 'patel');
    assert.equal(await pageRows().count(), 1);
    await page.fill('#treatment-search', 'nothing like this');
    await page.locator('#treatment-empty', { hasText: 'No treatments match these filters' }).waitFor();
    await page.fill('#treatment-search', '');
    assert.equal(await pageRows().count(), 3);
  });

  test('user data is shown as text everywhere, the dashboard alert included', async () => {
    const xss = (await session.pool.query("SELECT id FROM cattle WHERE tag_number = 'XSS-1'")).rows[0].id;
    await page.locator('#view-medical > div .btn-treatment-add').click();
    await page.locator('#treatmentModal.show').waitFor();
    await page.selectOption('#tr-cow', xss);
    await page.fill('#tr-date', localDay(-10));
    await page.fill('#tr-product', '"><script>window.__xss=2</script>');
    await page.fill('#tr-given-by', '<img src=x onerror="window.__xss=3">');
    await page.fill('#tr-next-due', localDay(-1));
    await page.fill('#tr-withdrawal', localDay(2));
    await page.fill('#tr-notes', '<img src=x onerror="window.__xss=4">');
    await save('Treatment recorded');

    const row = pageRows().filter({ hasText: 'XSS-1' });
    await row.waitFor();
    assert.ok((await row.innerText()).includes('"><script>window.__xss=2</script>'));
    assert.ok((await text('#treatment-due')).includes('<img src=x onerror="window.__xss=1">'));
    assert.equal(await page.locator('#view-medical img, #view-medical script').count(), 0);

    await row.locator('.btn-treatment-open').click();
    await page.locator('#viewCowModal.show').waitFor();
    await historyRows().first().waitFor();
    assert.equal(await page.locator('#viewCowModal img, #viewCowModal script').count(), 0);
    await closeDetails();

    await dashboard();
    const alert = page.locator('#alerts-list li', { hasText: 'Treatment overdue' });
    await alert.waitFor();
    assert.ok((await alert.innerText()).includes('"><script>window.__xss=2</script> for XSS-1'));
    assert.equal(await page.locator('#view-dashboard img, #view-dashboard script').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
  });

  test('deleting the animal removes its overdue alert from the dashboard', async () => {
    await session.showView('cattle');
    await page.locator('#list-body tr', { hasText: 'XSS-1' }).locator('.btn-delete').click();
    await toast('Cattle record deleted');
    await dashboard();
    await page.locator('#alerts-list', { hasText: 'No alerts.' }).waitFor();
    assert.equal(await text('#stat-treatments'), '0', "the bull's next booster is a year away");
  });

  test("delete treatments from the cow's details and from the page", async () => {
    await openDetails('BULL-1');
    await page.locator('#viewCowModal [data-tab="treatments"]').click();
    await historyRows().nth(1).waitFor();
    await historyRows().filter({ hasText: localDay(-30) }).locator('.btn-treatment-delete').click();
    await toast('Treatment deleted');
    await page.locator('#cow-tab-treatments', { hasText: '1 treatment recorded' }).waitFor();
    assert.equal(await historyRows().count(), 1);
    await closeDetails();

    await session.showView('medical');
    await pageRows().filter({ hasText: 'DAISY-1' }).locator('.btn-treatment-delete').click();
    await toast('Treatment deleted');
    await pageRows().filter({ hasText: 'DAISY-1' }).waitFor({ state: 'detached' });
    assert.equal(await pageRows().count(), 1);
    assert.equal((await session.pool.query('SELECT 1 FROM treatments')).rowCount, 1);
  });

  test('the cattle form keeps the free-text current medications', async () => {
    await session.showView('cattle');
    await page.locator('#list-body tr', { hasText: 'DAISY-1' }).locator('.btn-edit').click();
    await page.locator('#cattleModal.show').waitFor();
    assert.match(await text('#f-meds-help'), /Medical Records/);
    await page.fill('#f-meds', 'Vitamin B12');
    await page.click('#cattle-form button[type="submit"]');
    await toast('Cattle record updated');
    await page.locator('#cattleModal').waitFor({ state: 'hidden' });
    assert.ok((await page.locator('#list-body tr', { hasText: 'DAISY-1' }).innerText()).includes('Vitamin B12'));
    await openDetails('DAISY-1');
    await page.locator('#viewCowModal [data-tab="treatments"]').click();
    await page.locator('#cow-tab-treatments', { hasText: 'Current medications: Vitamin B12' }).waitFor();
    await closeDetails();
  });

  test('no uncaught JavaScript errors happened along the way', () => {
    assert.deepEqual(session.pageErrors, []);
  });
});
