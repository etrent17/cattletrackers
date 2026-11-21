// Browser test for breeding records: record a breeding (the expected calving date is filled in),
// record pregnancy checks from the needs-check list and from a cow's details (Pregnant, then
// open), edit and delete, and markup in user data. Run with `npm run test:e2e`.
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
const plusDays = (date, n) => {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
};

describe('breeding records in the browser', () => {
  const session = useBrowser();
  let page;
  let ids;

  const toast = (text) => page.locator('#notification.show', { hasText: text }).waitFor();
  const breedingRows = () => page.locator('#breeding-body tr');
  const checkRows = () => page.locator('#pregcheck-body tr');
  const needsRows = () => page.locator('#breeding-needs-check li[data-cattle-id]');
  const cowRow = (tag) => page.locator('#list-body tr', { hasText: tag });
  const dbCow = async (tag) =>
    (await session.pool.query('SELECT health_status, expected_calving_date FROM cattle WHERE tag_number = $1', [tag])).rows[0];
  const openDetails = async (tag) => {
    await session.showView('cattle');
    await cowRow(tag).locator('.btn-view').click();
    await page.locator('#viewCowModal.show').waitFor();
  };
  const closeDetails = async () => {
    await page.locator('#viewCowModal .modal-footer button').click();
    await page.locator('#viewCowModal').waitFor({ state: 'hidden' });
  };

  test('set up: a cow to breed, a cow bred 40 days ago, a cow with markup in her name, and a bull', async () => {
    const user = await session.signIn('breeding@example.com');
    page = session.page;
    const insert = async (tag, name, gender) =>
      (await session.pool.query(
        `INSERT INTO cattle (owner_id, tag_number, name_breed, gender, health_status)
         VALUES ($1,$2,$3,$4,'healthy') RETURNING id`,
        [user.id, tag, name, gender]
      )).rows[0].id;
    ids = {
      daisy: await insert('DAISY-1', 'Daisy Holstein', 'female'),
      old: await insert('OLD-1', 'Bessie Jersey', 'female'),
      xss: await insert('XSS-1', '<img src=x onerror="window.__xss=1">', 'female'),
      bull: await insert('BULL-1', 'Maximus', 'male'),
    };
    const res = await page.request.post(`${session.baseUrl}/api/cattle/${ids.old}/breedings`, {
      data: { breedingDate: localDay(-40), method: 'ai', sire: 'ABS 29JE4012' },
    });
    assert.equal(res.status(), 201);
    await page.reload();
    await page.locator('#recent-body tr', { hasText: 'DAISY-1' }).waitFor();
  });

  test('the Breeding History page lists the cow that needs a pregnancy check', async () => {
    await session.showView('breeding');
    await page.locator('#view-breeding').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#view-cattle').isVisible(), false);
    await needsRows().first().waitFor();
    assert.equal(await needsRows().count(), 1);
    const text = await needsRows().first().innerText();
    assert.match(text, /OLD-1[\s\S]*Bessie Jersey/);
    assert.ok(text.includes(`Bred ${localDay(-40)} to ABS 29JE4012`), text);
    assert.ok(text.includes('40 days since breeding'), text);
    assert.match(await page.locator('#breeding-needs-help').innerText(), /more than 35 days/);
    assert.equal(await breedingRows().count(), 1);
    await page.locator('#pregcheck-empty', { hasText: 'No pregnancy checks recorded yet' }).waitFor();
  });

  test('record a breeding to a herd bull: the expected calving date is filled in', async () => {
    await page.locator('#view-breeding .btn-breeding-add').first().click();
    await page.locator('#breedingModal.show').waitFor();
    assert.equal(await page.locator('#br-date').inputValue(), localDay());
    assert.deepEqual(
      await page.locator('#br-cow option').allInnerTexts(),
      ['Select a cow', 'DAISY-1 · Daisy Holstein', 'OLD-1 · Bessie Jersey', 'XSS-1 · <img src=x onerror="window.__xss=1">'],
      'bulls are not offered as cows'
    );
    assert.deepEqual(
      await page.locator('#br-sire-bull option').allInnerTexts(),
      ['Not a bull from the herd (type below)', 'BULL-1 · Maximus'],
      'the sire picker lists the herd bulls'
    );

    // A cow is required.
    await page.click('#breeding-form button[type="submit"]');
    await toast('Choose the cow that was bred');

    const bred = localDay(-10);
    const expected = plusDays(bred, 283);
    await page.selectOption('#br-cow', ids.daisy);
    await page.fill('#br-date', bred);
    await page.locator('#br-expected', { hasText: `Expected calving ${expected} (283 days after breeding)` }).waitFor();
    await page.selectOption('#br-method', 'natural');
    assert.equal(await page.locator('#br-sire-wrap').isVisible(), true);
    await page.selectOption('#br-sire-bull', ids.bull);
    assert.equal(await page.locator('#br-sire-wrap').isVisible(), false, 'no typed sire with a herd bull');
    await page.fill('#br-notes', 'Seen standing <b>twice</b>');
    await page.click('#breeding-form button[type="submit"]');
    await toast(`Breeding recorded. Expected calving ${expected}`);
    await page.locator('#breedingModal').waitFor({ state: 'hidden' });

    const row = breedingRows().filter({ hasText: 'DAISY-1' });
    await row.waitFor();
    const text = await row.innerText();
    for (const part of [bred, 'Daisy Holstein', 'Natural', 'BULL-1 Maximus', expected, 'Seen standing <b>twice</b>']) {
      assert.ok(text.includes(part), `row shows ${part}: ${text}`);
    }
    assert.equal(await row.locator('b').count(), 0, 'notes are shown as text');
    assert.equal(await needsRows().count(), 1, 'bred 10 days ago: not due for a check yet');

    assert.deepEqual(await dbCow('DAISY-1'), { health_status: 'healthy', expected_calving_date: expected });
    await session.showView('cattle');
    assert.ok((await cowRow('DAISY-1').innerText()).includes(`Due: ${expected}`));
  });

  test('record a positive check from the needs-check list: the cow is marked Pregnant', async () => {
    await session.showView('breeding');
    await needsRows().first().waitFor();
    await needsRows().first().locator('.btn-pregcheck-add').click();
    await page.locator('#pregcheckModal.show').waitFor();
    assert.equal(await page.locator('#pc-cow').inputValue(), ids.old);
    assert.equal(await page.locator('#pc-date').inputValue(), localDay());
    await page.locator('#pc-breeding:not([disabled])').waitFor();
    assert.match(await page.locator('#pc-breeding option:checked').innerText(), new RegExp(`${localDay(-40)} · AI · ABS 29JE4012`));

    // A result is required.
    await page.click('#pregcheck-form button[type="submit"]');
    await toast('Choose a result: pregnant, open or unsure');

    await page.selectOption('#pc-result', 'pregnant');
    await page.selectOption('#pc-method', 'ultrasound');
    await page.click('#pregcheck-form button[type="submit"]');
    await toast('Pregnancy check recorded');
    await page.locator('#pregcheckModal').waitFor({ state: 'hidden' });

    await page.locator('#breeding-needs-check', { hasText: 'No cows are waiting for a pregnancy check' }).waitFor();
    const row = checkRows().filter({ hasText: 'OLD-1' });
    await row.waitFor();
    for (const part of [localDay(), 'Pregnant', 'Ultrasound', `Bred ${localDay(-40)}`]) {
      assert.ok((await row.innerText()).includes(part), `check row shows ${part}`);
    }
    assert.ok((await breedingRows().filter({ hasText: 'OLD-1' }).innerText()).includes('Pregnant'), 'the breeding shows its check');

    const expected = plusDays(localDay(-40), 283);
    assert.deepEqual(await dbCow('OLD-1'), { health_status: 'pregnant', expected_calving_date: expected });
    await session.showView('cattle');
    assert.ok((await cowRow('OLD-1').innerText()).includes('Pregnant'));
  });

  test("the cow's details have a Breeding tab with her history; a bull has none", async () => {
    await openDetails('DAISY-1');
    await page.locator('#viewCowModal [data-tab="breeding"]').click();
    const pane = page.locator('#cow-tab-breeding');
    await pane.locator('.breeding-history tr').first().waitFor();
    assert.equal(await pane.locator('.breeding-history tr').count(), 1);
    assert.ok((await pane.innerText()).includes(`Expected calving ${plusDays(localDay(-10), 283)}`));
    assert.ok((await pane.innerText()).includes('No pregnancy checks recorded for this animal'));
    await closeDetails();

    await openDetails('BULL-1');
    assert.equal(await page.locator('#viewCowModal [data-tab="breeding"]').count(), 0);
    await closeDetails();
  });

  test("an open check from the cow's details clears her expected date; the details reopen on the tab", async () => {
    await openDetails('DAISY-1');
    await page.locator('#viewCowModal [data-tab="breeding"]').click();
    await page.locator('#cow-tab-breeding .btn-pregcheck-add').click();
    await page.locator('#pregcheckModal.show').waitFor();
    await page.locator('#viewCowModal').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#pc-cow').inputValue(), ids.daisy);
    assert.equal(await page.locator('#pc-cow').isDisabled(), false);
    await page.locator('#pc-breeding:not([disabled])').waitFor();
    assert.match(await page.locator('#pc-breeding option:checked').innerText(), new RegExp(localDay(-10)), 'her breeding is preselected');

    await page.selectOption('#pc-result', 'open');
    await page.fill('#pc-notes', '<script>window.__xss=4</script>');
    await page.click('#pregcheck-form button[type="submit"]');
    await toast('Pregnancy check recorded');

    await page.locator('#viewCowModal.show').waitFor();
    await page.locator('#cow-tab-breeding.active .pregcheck-history tr').first().waitFor();
    const pane = page.locator('#cow-tab-breeding');
    assert.ok((await pane.innerText()).includes('No expected calving date'));
    assert.ok((await pane.locator('.pregcheck-history').innerText()).includes('<script>window.__xss=4</script>'));
    assert.deepEqual(await dbCow('DAISY-1'), { health_status: 'healthy', expected_calving_date: null });
  });

  test("delete the open check from the cow's details: the expected date comes back from her breeding", async () => {
    await page.locator('#cow-tab-breeding .pregcheck-history .btn-pregcheck-delete').click();
    await toast('Pregnancy check deleted');
    await page.locator('#cow-tab-breeding', { hasText: 'No pregnancy checks recorded for this animal' }).waitFor();
    const expected = plusDays(localDay(-10), 283);
    await page.locator('#cow-tab-breeding', { hasText: `Expected calving ${expected}` }).waitFor();
    assert.equal((await dbCow('DAISY-1')).expected_calving_date, expected);
    await closeDetails();
  });

  test('edit a breeding from the page: the expected date follows', async () => {
    await session.showView('breeding');
    await breedingRows().filter({ hasText: 'DAISY-1' }).locator('.btn-breeding-edit').click();
    await page.locator('#breedingModal.show').waitFor();
    assert.equal(await page.locator('#breedingModalTitle').innerText(), 'Edit Breeding Record');
    assert.equal(await page.locator('#br-cow').isDisabled(), true);
    assert.equal(await page.locator('#br-sire-bull').inputValue(), ids.bull);

    const bred = localDay(-12);
    await page.fill('#br-date', bred);
    await page.selectOption('#br-sire-bull', '');
    await page.fill('#br-sire', 'Neighbour\'s bull "Rex"');
    await page.fill('#br-technician', 'J. Miller');
    await page.click('#breeding-form button[type="submit"]');
    await toast('Breeding record updated');
    await page.locator('#breedingModal').waitFor({ state: 'hidden' });

    const row = breedingRows().filter({ hasText: 'DAISY-1' });
    await row.filter({ hasText: bred }).waitFor();
    assert.ok((await row.innerText()).includes('Neighbour\'s bull "Rex"'));
    assert.ok((await row.innerText()).includes('J. Miller'));
    assert.equal((await dbCow('DAISY-1')).expected_calving_date, plusDays(bred, 283));
  });

  test('the expected date stays editable on the cattle form', async () => {
    await session.showView('cattle');
    await cowRow('DAISY-1').locator('.btn-edit').click();
    await page.locator('#cattleModal.show').waitFor();
    assert.equal(await page.locator('#f-expected-calving').inputValue(), plusDays(localDay(-12), 283));
    assert.equal(await page.locator('#f-expected-calving').isDisabled(), false);
    assert.match(await page.locator('#f-expected-calving-help').innerText(), /Filled in when a breeding is recorded/);
    await page.fill('#f-expected-calving', '2030-01-01');
    await page.click('#cattle-form button[type="submit"]');
    await toast('Cattle record updated');
    await page.locator('#cattleModal').waitFor({ state: 'hidden' });
    assert.equal((await dbCow('DAISY-1')).expected_calving_date, '2030-01-01');
  });

  test('user data is shown as text on the page and in the details', async () => {
    await session.showView('breeding');
    await page.locator('#view-breeding .btn-breeding-add').first().click();
    await page.locator('#breedingModal.show').waitFor();
    await page.selectOption('#br-cow', ids.xss);
    await page.fill('#br-date', localDay(-50));
    await page.fill('#br-sire', '"><img src=x onerror="window.__xss=2">');
    await page.fill('#br-technician', '<script>window.__xss=3</script>');
    await page.click('#breeding-form button[type="submit"]');
    await toast('Breeding recorded');
    await page.locator('#breedingModal').waitFor({ state: 'hidden' });

    const row = breedingRows().filter({ hasText: 'XSS-1' });
    await row.waitFor();
    assert.ok((await row.innerText()).includes('<img src=x onerror="window.__xss=1">'));
    assert.ok((await row.innerText()).includes('"><img src=x'));
    // Bred 50 days ago without a check: she is on the needs-check list too.
    await needsRows().filter({ hasText: 'XSS-1' }).waitFor();
    assert.equal(await page.locator('#view-breeding img, #view-breeding script').count(), 0);

    await row.locator('.btn-view').click();
    await page.locator('#viewCowModal.show').waitFor();
    await page.locator('#viewCowModal [data-tab="breeding"]').click();
    await page.locator('#cow-tab-breeding .breeding-history tr').first().waitFor();
    assert.equal(await page.locator('#viewCowModal img, #viewCowModal script').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    await closeDetails();
  });

  test('delete a breeding from the page', async () => {
    await breedingRows().filter({ hasText: 'XSS-1' }).locator('.btn-breeding-delete').click();
    await toast('Breeding record deleted');
    await breedingRows().filter({ hasText: 'XSS-1' }).waitFor({ state: 'detached' });
    await page.locator('#breeding-needs-check', { hasText: 'No cows are waiting for a pregnancy check' }).waitFor();
    assert.equal(await breedingRows().count(), 2);
    assert.equal((await dbCow('XSS-1')).expected_calving_date, null);
  });

  test('search narrows both tables', async () => {
    await page.fill('#breeding-search', 'rex');
    assert.equal(await breedingRows().count(), 1);
    assert.equal(await checkRows().count(), 0);
    await page.locator('#pregcheck-empty', { hasText: 'No pregnancy checks match this search' }).waitFor();
    assert.equal(await page.locator('#breeding-count').innerText(), 'Showing 1 of 2');
    await page.fill('#breeding-search', 'old-1');
    assert.equal(await breedingRows().count(), 1);
    assert.equal(await checkRows().count(), 1);
    await page.fill('#breeding-search', '');
    assert.equal(await breedingRows().count(), 2);
  });

  test('no uncaught JavaScript errors happened along the way', () => {
    assert.deepEqual(session.pageErrors, []);
  });
});
