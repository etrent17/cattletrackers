// Offline editing (feature 14) in headless Chromium: the herd stays visible without a connection,
// cattle can be added, edited and deleted, the changes sync on reconnect, a conflict lands in
// "Unsynced changes" with the server's version on screen, and the saved copy goes away on sign-out
// and when another account signs in. The last test runs with the real service worker and starts
// the app with the network off. Run with `npm run test:e2e` (needs TEST_DATABASE_URL).
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useBrowser } = require('./helpers/browser');
const { startCdn, launchWithCdn } = require('./helpers/cdn');
const { createUser } = require('../test/helpers/api');

const OWNER = 'offline@example.com';
const OTHER = 'someone-else@example.com';
const MARKUP = '<img src=x onerror="window.__xss=1">';

// Three days ago at noon UTC: the day the offline changes are "made". Noon keeps the local date
// the same in any time zone the tests run in.
const MADE_AT = new Date(Date.now() - 3 * 86400000);
MADE_AT.setUTCHours(12, 0, 0, 0);
const MADE_ON = MADE_AT.toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// The record the app keeps in IndexedDB (src/services/OfflineStore.js), or null when there is none.
const savedState = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('cattle-trackers-offline', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('state');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const get = open.result.transaction('state').objectStore('state').get('state');
    get.onerror = () => reject(get.error);
    get.onsuccess = () => {
      open.result.close();
      resolve(get.result ?? null);
    };
  };
}));

describe('offline editing', () => {
  const session = useBrowser();
  let page;
  let owner;
  let second; // the same account in another browser (the "barn office" computer)

  const api = (p, method, url, data) => p.request[method](`${session.baseUrl}${url}`, data ? { data } : undefined);
  const herd = async (ownerId = owner.id) =>
    (await session.pool.query('SELECT * FROM cattle WHERE owner_id = $1 ORDER BY tag_number', [ownerId])).rows;
  const cow = async (tag) => (await herd()).find((c) => c.tag_number === tag);
  const weighings = async (cattleId) =>
    (await session.pool.query('SELECT date::text, weight::float AS weight FROM weighings WHERE cattle_id = $1 ORDER BY date', [cattleId])).rows;

  const statusText = (p = page) => p.locator('#status-text');
  const goOffline = async (p = page) => {
    await p.context().setOffline(true);
    await statusText(p).filter({ hasText: 'Offline' }).waitFor();
  };
  const goOnline = async (p = page) => {
    await p.context().setOffline(false);
    await statusText(p).filter({ hasText: 'Online' }).waitFor();
  };
  const toast = (text, p = page) => p.locator('#notification.show').filter({ hasText: text }).waitFor();
  const showView = (name, p = page) => p.locator(`.nav-link[data-view="${name}"]`).click();
  const row = (tag, p = page) =>
    p.locator('#list-body tr').filter({ has: p.locator('.badge-cow', { hasText: new RegExp(`^${tag}$`) }) });
  const tags = async (p = page) => (await p.locator('#list-body .badge-cow').allInnerTexts()).sort();
  const bannerText = async (p = page) => (await p.locator('#sync-banner').innerText()).replace(/\s+/g, ' ').trim();

  async function fillAndSave(fields, p = page) {
    const modal = p.locator('#cattleModal');
    await modal.waitFor({ state: 'visible' });
    for (const [id, value] of Object.entries(fields)) await p.locator(`#${id}`).fill(value);
    await p.locator('#cattle-form button[type="submit"]').click();
    await modal.waitFor({ state: 'hidden' });
  }
  async function addCow(fields, p = page) {
    await showView('dashboard', p);
    await p.locator('#open-add-modal-btn').click();
    await fillAndSave(fields, p);
  }
  async function editCow(tag, fields, p = page) {
    await showView('cattle', p);
    await row(tag, p).locator('.btn-edit').click();
    await fillAndSave(fields, p);
  }
  async function openReview() {
    await page.locator('#unsynced-review-btn').click();
    await page.locator('#unsyncedModal').waitFor({ state: 'visible' });
  }

  before(async () => {
    page = session.page;
    owner = await session.signIn(OWNER);
    await api(page, 'post', '/api/cattle', { tagNumber: 'CT-1', nameBreed: 'Daisy', gender: 'female', weight: 800, weightDate: daysAgo(30) });
    await api(page, 'post', '/api/cattle', { tagNumber: 'CT-2', nameBreed: 'Bessie', gender: 'female' });
    await page.reload();
    await page.locator('#view-dashboard').waitFor({ state: 'visible' });
    await page.locator('#stat-total').filter({ hasText: '2' }).waitFor();

    const context = await session.openContext();
    second = await session.newPage(context);
  });

  test('online: the indicator says Online, no banner, and the herd is saved on the device', async () => {
    assert.equal(await statusText().innerText(), 'Online');
    assert.equal(await page.locator('#sync-banner').isHidden(), true);
    const state = await savedState(page);
    assert.equal(state.user.email, OWNER);
    assert.deepEqual(state.herd.map((c) => c.tagNumber).sort(), ['CT-1', 'CT-2']);
    assert.deepEqual(state.outbox, []);
  });

  test('with the network off the herd is still visible, with a clear offline banner', async () => {
    await goOffline();
    assert.equal(await statusText().innerText(), 'Offline');
    assert.match(await bannerText(), /You're offline\. Showing the herd saved on this device \(last updated .+\)/);

    assert.equal(await page.locator('#stat-total').innerText(), '2');
    await showView('cattle');
    assert.deepEqual(await tags(), ['CT-1', 'CT-2']);
    assert.equal(await page.locator('#error-banner').isHidden(), true);

    // the cow's details open from the saved copy; the record tabs need the server
    await row('CT-1').locator('.btn-view').click();
    await page.locator('#viewCowModal').waitFor({ state: 'visible' });
    assert.match(await page.locator('#cow-tab-details').innerText(), /Daisy/);
    assert.deepEqual(await page.locator('#viewCowModalBody .nav-link').allInnerTexts(), ['Details']);
    assert.match(await page.locator('#cow-details-offline-note').innerText(), /need a connection/);
    await page.locator('#viewCowModal .modal-footer button').click();
    await page.locator('#viewCowModal').waitFor({ state: 'hidden' });
  });

  test('pages that need the server say so instead of failing', async () => {
    for (const [view, title] of [
      ['calving', 'Calving Records'], ['weights', 'Weights'], ['medical', 'Medical Records'], ['breeding', 'Breeding History'],
      ['finance', 'Financial Records'], ['reports', 'Performance Reports'], ['health-reports', 'Health Reports'],
      ['financial-reports', 'Financial Reports'],
    ]) {
      await showView(view);
      await page.locator('#view-needs-connection').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#needs-connection-title').innerText(), title);
      assert.match(await page.locator('#view-needs-connection').innerText(), /This page needs a connection/);
      assert.equal(await page.locator('.app-view.active').count(), 1, `${view}: only the notice is shown`);
      // none of the page's own buttons can be reached
      assert.equal(await page.locator('.btn-calving-add, .btn-weight-add, .btn-treatment-add, .btn-breeding-add, .btn-pregcheck-add').locator('visible=true').count(), 0);
    }

    await page.locator('#needs-connection-retry').click();
    await toast('Still no connection to the server.');

    // System Settings opens, with the password form locked
    await showView('settings');
    await page.locator('#settings-password-offline').waitFor();
    assert.equal(await page.locator('#settings-current-password').isDisabled(), true);
    assert.equal(await page.locator('#settings-password-form button[type="submit"]').isDisabled(), true);
    assert.equal(await page.locator('#settings-email').innerText(), OWNER);
  });

  test('offline, a new cow can be added and an existing one edited', async () => {
    await page.clock.setFixedTime(MADE_AT); // the changes are made three days before they sync

    await addCow({ 'f-tag': 'CT-3', 'f-name': 'Clover', 'f-weight': '450' });
    await toast('New cow added to herd. Saved on this device.');
    await editCow('CT-1', { 'f-name': 'Daisy (field)', 'f-weight': '825', 'f-notes': 'Limping, left hind' });
    await toast('Cattle record updated. Saved on this device.');

    assert.deepEqual(await tags(), ['CT-1', 'CT-2', 'CT-3']);
    assert.match(await row('CT-3').innerText(), /Clover/);
    assert.match(await row('CT-1').innerText(), /Daisy \(field\)/);
    assert.equal(await row('CT-3').locator('.badge-pending-sync').count(), 1);
    assert.equal(await row('CT-1').locator('.badge-pending-sync').count(), 1);
    assert.equal(await row('CT-2').locator('.badge-pending-sync').count(), 0);
    assert.match(await bannerText(), /2 changes waiting to sync\./);
    assert.equal(await page.locator('#sync-now-btn').isVisible(), true);

    // a number already used by a queued animal is caught on the device
    await addCowExpectingRefusal({ 'f-tag': 'ct-3', 'f-name': 'Copy' });

    // nothing has reached the server
    assert.deepEqual((await herd()).map((c) => [c.tag_number, c.name_breed]), [['CT-1', 'Daisy'], ['CT-2', 'Bessie']]);
    const state = await savedState(page);
    assert.deepEqual(state.outbox.map((o) => o.type), ['create', 'edit']);

    // "Sync now" while still offline keeps everything and says why
    await page.locator('#sync-now-btn').click();
    await toast("Still can't reach the server. Your changes are safe on this device.");
    assert.equal((await savedState(page)).outbox.length, 2);
  });

  async function addCowExpectingRefusal(fields) {
    await showView('dashboard');
    await page.locator('#open-add-modal-btn').click();
    await page.locator('#cattleModal').waitFor({ state: 'visible' });
    for (const [id, value] of Object.entries(fields)) await page.locator(`#${id}`).fill(value);
    await page.locator('#cattle-form button[type="submit"]').click();
    await toast('Cow number already exists');
    await page.locator('#cattleModal .btn-secondary').click();
    await page.locator('#cattleModal').waitFor({ state: 'hidden' });
  }

  test('reconnecting syncs both changes, dated the day they were made', async () => {
    await page.clock.setFixedTime(new Date());
    await goOnline();
    await toast('2 changes synced.');
    await page.locator('#sync-banner').waitFor({ state: 'hidden' });

    const clover = await cow('CT-3');
    assert.equal(clover.name_breed, 'Clover');
    assert.deepEqual(await weighings(clover.id), [{ date: MADE_ON, weight: 450 }]);

    const daisy = await cow('CT-1');
    assert.equal(daisy.name_breed, 'Daisy (field)');
    assert.equal(daisy.notes, 'Limping, left hind');
    assert.equal(Number(daisy.weight), 825);
    assert.deepEqual(await weighings(daisy.id), [{ date: daysAgo(30), weight: 800 }, { date: MADE_ON, weight: 825 }]);

    // the list is the server's again: same animals, nothing marked as waiting
    await showView('cattle');
    assert.deepEqual(await tags(), ['CT-1', 'CT-2', 'CT-3']);
    assert.equal(await page.locator('.badge-pending-sync').count(), 0);
    const state = await savedState(page);
    assert.deepEqual(state.outbox, []);
    assert.deepEqual(state.unsynced, []);
    assert.equal(state.herd.find((c) => c.tagNumber === 'CT-3').id, clover.id, 'the id chosen offline is the id on the server');

    // the cow added offline is a normal record now: its record tabs are back
    await row('CT-3').locator('.btn-view').click();
    await page.locator('#viewCowModal').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#viewCowModalBody .nav-link').count()) > 1);
    await page.locator('#viewCowModal .modal-footer button').click();
    await page.locator('#viewCowModal').waitFor({ state: 'hidden' });
  });

  test('a conflict keeps the server version and lists the change under Unsynced changes', async () => {
    await goOffline();

    // meanwhile, the same cow is changed on another computer that is online
    await session.signInExisting(OWNER, { page: second });
    await editCow('CT-2', { 'f-name': 'Bessie (barn office)' }, second);
    await toast('Cattle record updated', second);

    // and here, offline, on top of the old version
    await editCow('CT-2', { 'f-name': 'Bessie (field)', 'f-notes': 'Moved to the north pasture' });
    await toast('Saved on this device.');
    assert.match(await row('CT-2').innerText(), /Bessie \(field\)/);

    await goOnline();
    await toast('1 change could not be synced.');
    assert.match(await bannerText(), /1 change could not be synced\./);

    // the server's version stands, on the server and on screen
    const bessie = await cow('CT-2');
    assert.equal(bessie.name_breed, 'Bessie (barn office)');
    assert.equal(bessie.notes, null);
    await showView('cattle');
    await row('CT-2').filter({ hasText: 'Bessie (barn office)' }).waitFor();
    assert.equal(await row('CT-2').locator('.badge-pending-sync').count(), 0);

    // the user's change is there to look at
    await openReview();
    const item = page.locator('.unsynced-item');
    assert.equal(await item.count(), 1);
    assert.equal(await item.locator('.unsynced-title').innerText(), 'Edit of CT-2 Bessie (field)');
    assert.match(await item.locator('.unsynced-reason').innerText(), /changed somewhere else after you made this change/);
    const table = await item.locator('tbody tr').allInnerTexts();
    assert.deepEqual(table.map((t) => t.split('\t')), [
      ['Name / breed', 'Bessie (field)', 'Bessie (barn office)'],
      ['Notes', 'Moved to the north pasture', '—'],
    ]);
    await page.locator('#unsyncedModal .modal-footer button').click();
    await page.locator('#unsyncedModal').waitFor({ state: 'hidden' });
  });

  test('the unsynced change survives a reload and can be applied again as a new edit', async () => {
    await page.reload();
    await page.locator('#view-dashboard').waitFor({ state: 'visible' });
    await page.locator('#unsynced-review-btn').waitFor({ state: 'visible' });
    assert.match(await bannerText(), /1 change could not be synced\./);

    await openReview();
    await page.locator('.btn-unsynced-apply').click();
    // the cattle form opens with the user's values on the current record
    await page.locator('#cattleModal').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#cattleModalTitle').innerText(), 'Edit Cattle Record');
    assert.equal(await page.locator('#f-name').inputValue(), 'Bessie (field)');
    assert.equal(await page.locator('#f-notes').inputValue(), 'Moved to the north pasture');
    await page.locator('#cattle-form button[type="submit"]').click();
    await toast('Cattle record updated');
    await page.locator('#sync-banner').waitFor({ state: 'hidden' });

    const bessie = await cow('CT-2');
    assert.equal(bessie.name_breed, 'Bessie (field)');
    assert.equal(bessie.notes, 'Moved to the north pasture');
    assert.deepEqual((await savedState(page)).unsynced, []);
  });

  test('closing the form without saving keeps the unsynced change; a duplicate number is reported and can be discarded', async () => {
    await goOffline();
    await addCow({ 'f-tag': 'CT-50', 'f-name': MARKUP });
    await api(second, 'post', '/api/cattle', { tagNumber: 'CT-50', nameBreed: 'Added in the office' });
    await goOnline();
    await toast('1 change could not be synced.');

    const mine = (await herd()).filter((c) => c.tag_number === 'CT-50');
    assert.deepEqual(mine.map((c) => c.name_breed), ['Added in the office']);

    await openReview();
    const item = page.locator('.unsynced-item');
    assert.equal(await item.locator('.unsynced-title').innerText(), `New animal CT-50 ${MARKUP}`);
    assert.equal(await item.locator('.unsynced-reason').innerText(), 'Another animal already has this cow number.');
    assert.equal(await item.locator('img').count(), 0, 'markup in a name is shown as text');
    assert.equal(await page.evaluate(() => window.__xss), undefined);

    // "Add again" opens the form; cancelling it loses nothing
    await page.locator('.btn-unsynced-apply').click();
    await page.locator('#cattleModal').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#cattleModalTitle').innerText(), 'Add New Cattle Record');
    assert.equal(await page.locator('#f-tag').inputValue(), 'CT-50');
    assert.equal(await page.locator('#f-name').inputValue(), MARKUP);
    await page.locator('#cattleModal .btn-secondary').click();
    await page.locator('#cattleModal').waitFor({ state: 'hidden' });
    assert.equal((await savedState(page)).unsynced.length, 1);

    // discarding asks first, then removes it
    session.dialogs.length = 0;
    await openReview();
    await page.locator('.btn-unsynced-discard').click();
    await toast('Change discarded.');
    assert.match(session.dialogs[0], /Discard this change\?/);
    await page.locator('#sync-banner').waitFor({ state: 'hidden' });
    await page.locator('#unsyncedModal').waitFor({ state: 'hidden' });
    assert.deepEqual((await savedState(page)).unsynced, []);
  });

  test('a delete made offline syncs; a delete of a cow changed elsewhere is refused and she stays', async () => {
    await goOffline();
    await showView('cattle');
    await row('CT-3').locator('.btn-delete').click();
    await toast('Cattle record deleted. Saved on this device.');
    await row('CT-1').locator('.btn-delete').click();
    await toast('Cattle record deleted. Saved on this device.');
    assert.deepEqual(await tags(), ['CT-2', 'CT-50']);
    assert.match(await bannerText(), /2 changes waiting to sync\./);

    // CT-1 is treated in the office while the delete is still waiting
    const daisy = await cow('CT-1');
    const res = await api(second, 'put', `/api/cattle/${daisy.id}`, { tagNumber: 'CT-1', nameBreed: 'Daisy (field)', notes: 'Vet visit booked' });
    assert.equal(res.status(), 200);

    await goOnline();
    await toast('1 change could not be synced.');
    assert.equal(await cow('CT-3'), undefined, 'the uncontested delete went through');
    assert.equal((await cow('CT-1')).notes, 'Vet visit booked', 'the contested one did not');
    await showView('cattle');
    await row('CT-1').waitFor();
    assert.deepEqual(await tags(), ['CT-1', 'CT-2', 'CT-50']);

    await openReview();
    assert.equal(await page.locator('.unsynced-title').innerText(), 'Delete of CT-1 Daisy (field)');
    assert.match(await page.locator('.unsynced-reason').innerText(), /changed somewhere else after you deleted it here, so it was not deleted/);
    await page.locator('.btn-unsynced-apply', { hasText: 'Delete anyway' }).click();
    await toast('Cattle record deleted');
    await page.locator('#sync-banner').waitFor({ state: 'hidden' });
    assert.equal(await cow('CT-1'), undefined);
    assert.deepEqual((await savedState(page)).unsynced, []);
    if (await page.locator('#unsyncedModal').isVisible()) {
      await page.locator('#unsyncedModal .modal-footer button').click();
      await page.locator('#unsyncedModal').waitFor({ state: 'hidden' });
    }
  });

  test('signing out warns about changes that have not synced and removes the offline copy', async () => {
    // leave one refused change on the device
    await goOffline();
    await addCow({ 'f-tag': 'CT-60', 'f-name': 'Never synced' });
    await api(second, 'post', '/api/cattle', { tagNumber: 'CT-60', nameBreed: 'Office' });
    await goOnline();
    await toast('1 change could not be synced.');
    assert.equal((await savedState(page)).unsynced.length, 1);

    session.dialogs.length = 0;
    await page.locator('#logout-btn').click();
    await page.waitForURL('**/login.html');
    assert.equal(session.dialogs.length, 1);
    assert.match(session.dialogs[0], /1 change has not been synced to the server\. Signing out deletes it from this device\./);

    assert.equal(await savedState(page), null, 'nothing of the herd is left in the browser');
    assert.deepEqual((await herd()).map((c) => c.tag_number), ['CT-2', 'CT-50', 'CT-60']);
  });

  test("a different account never sees, or receives, the previous account's copy", async () => {
    // the owner is back, makes a change offline, and leaves the page open
    await session.signInExisting(OWNER);
    await goOffline();
    await addCow({ 'f-tag': 'CT-70', 'f-name': 'Still waiting' });
    assert.equal((await savedState(page)).outbox.length, 1);

    // the session now belongs to someone else (signed in from another tab of this browser)
    const other = await createUser(OTHER);
    await page.context().clearCookies();
    const login = await api(page, 'post', '/api/auth/login', { email: OTHER, password: 'correct-horse-battery' });
    assert.equal(login.status(), 200);

    // when the connection returns, the waiting change must not be sent as the new account
    await page.context().setOffline(false);
    await toast('1 unsynced change left on this device by another account was removed.');
    await page.locator('#view-dashboard').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#stat-total').innerText(), '0');
    await showView('cattle');
    assert.deepEqual(await tags(), []);

    const state = await savedState(page);
    assert.equal(state.user.email, OTHER);
    assert.deepEqual([state.herd, state.outbox, state.unsynced], [[], [], []]);
    assert.deepEqual(await herd(other.id), []);
    assert.equal(await cow('CT-70'), undefined);
    assert.equal(await page.locator('#sync-banner').isHidden(), true);
  });

  // The app shell comes from the real service worker here, so the page can be loaded with the
  // network off. The worker fetches Bootstrap from the CDN when it installs; a local HTTPS server
  // stands in for the CDN (helpers/cdn.js), so the worker's own requests, its cache and the app's
  // content security policy are all exercised as in production.
  test('with the service worker: the app starts offline from the saved copy and says Offline', async () => {
    const cdn = await startCdn();
    const browser = await launchWithCdn(cdn.port);
    try {
      const context = await browser.newContext({ serviceWorkers: 'allow', ignoreHTTPSErrors: true });
      const p = await session.newPage(context);
      await session.signInExisting(OWNER, { page: p });
      await p.evaluate(() => navigator.serviceWorker.ready.then(() => true));

      // the worker keeps every file it promises to, the three CDN files, and no API answer
      const cachedUrls = () => p.evaluate(async () => {
        const names = await caches.keys();
        const cache = names.length ? await caches.open(names[0]) : null;
        return cache ? (await cache.keys()).map((r) => r.url) : [];
      });
      const cdnFiles = [
        'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
        'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
      ];
      const worker = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');
      const promised = [...worker.matchAll(/^\s+'(\/[^']*)',$/gm)].map((m) => m[1]);
      assert.ok(promised.length > 40);
      const wanted = [...promised.map((u) => `${session.baseUrl}${u}`), ...cdnFiles];
      let cached = [];
      for (let i = 0; i < 50 && !wanted.every((u) => cached.includes(u)); i += 1) {
        await p.waitForTimeout(100);
        cached = await cachedUrls();
      }
      assert.deepEqual(wanted.filter((u) => !cached.includes(u)), [], 'every promised file is cached');
      assert.deepEqual(cached.filter((u) => new URL(u).pathname.startsWith('/api/')), []);
      for (const url of promised) {
        const file = url === '/' ? 'index.html' : url.slice(1);
        assert.ok(
          fs.existsSync(path.join(__dirname, '..', 'public', file)) || fs.existsSync(path.join(__dirname, '..', file)),
          `${url} exists`
        );
      }

      // online, with the worker now in charge of the page, everything still loads
      await p.reload();
      await p.locator('#stat-total').filter({ hasText: '3' }).waitFor();
      assert.equal(await statusText(p).innerText(), 'Online');
      assert.equal(await p.evaluate(() => typeof bootstrap), 'object');

      // start with the network off
      const cdnRequests = cdn.requests.length;
      await context.setOffline(true);
      await p.reload();
      await p.locator('#stat-total').filter({ hasText: '3' }).waitFor();
      assert.equal(await statusText(p).innerText(), 'Offline', 'the indicator is right when the app starts offline');
      assert.match(await bannerText(p), /You're offline\. Showing the herd saved on this device/);
      assert.equal(await p.locator('#error-banner').isHidden(), true);
      assert.equal(await p.evaluate(() => typeof bootstrap), 'object');
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.navbar')).display), 'flex', 'Bootstrap styles came from the cache');
      await showView('cattle', p);
      assert.deepEqual(await tags(p), ['CT-2', 'CT-50', 'CT-60']);

      // a cow added now survives another offline start
      await addCow({ 'f-tag': 'CT-80', 'f-name': 'Added in the barn' }, p);
      await toast('Saved on this device.', p);
      await p.reload();
      await p.locator('#stat-total').filter({ hasText: '4' }).waitFor();
      assert.equal(await statusText(p).innerText(), 'Offline');
      assert.match(await bannerText(p), /1 change waiting to sync\./);
      await showView('cattle', p);
      assert.equal(await row('CT-80', p).locator('.badge-pending-sync').count(), 1);
      assert.equal(await cow('CT-80'), undefined);
      assert.equal(cdn.requests.length, cdnRequests, 'nothing was fetched from the CDN while offline');

      // and syncs when the connection returns
      await goOnline(p);
      await toast('1 change synced.', p);
      assert.equal((await cow('CT-80')).name_breed, 'Added in the barn');

      // after signing out there is nothing to show offline
      await p.locator('#logout-btn').click();
      await p.waitForURL('**/login.html');
      await context.setOffline(true);
      await p.goto(session.baseUrl);
      await p.locator('#error-banner').waitFor({ state: 'visible' });
      assert.match(await p.locator('#error-banner-text').innerText(), /Can't reach the server/);
      assert.equal(await statusText(p).innerText(), 'Offline');
      assert.equal(await p.locator('#list-body tr').count(), 0);
      assert.equal(await p.locator('#stat-total').innerText(), '0');
    } finally {
      await browser.close();
      await cdn.close();
    }
  });

  test('no page errors', () => {
    assert.deepEqual(session.pageErrors, []);
  });
});
