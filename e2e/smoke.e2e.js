// Browser smoke test: one pass through the main workflow in headless Chromium.
// Run with `npm run test:e2e`. It starts the app itself on a free port against TEST_DATABASE_URL.
//
// Bootstrap and Font Awesome normally load from CDNs. To keep the test independent of the
// network, CDN requests are answered locally: Bootstrap from node_modules/bootstrap (a dev
// dependency, same version as index.html) and Font Awesome with an empty stylesheet (icons are
// decoration only). Set E2E_REAL_CDN=true to let the browser fetch the real CDN files instead.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { app, pool, prepareDatabase, resetDatabase } = require('../test/helpers/api');

const ADMIN = { email: 'smoke@example.com', password: 'smoke-test-password' };
const COW = { tag: 'SMOKE-1', name: 'Smoke Test Hereford' };
const BOOTSTRAP_DIST = path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist');
const CONTENT_TYPES = { '.css': 'text/css', '.js': 'application/javascript' };

async function serveCdnLocally(context) {
  await context.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, (route) => {
    const { pathname } = new URL(route.request().url());
    const headers = { 'access-control-allow-origin': '*' };
    const match = /^\/npm\/bootstrap@[^/]+\/dist\/(css|js)\/([\w.-]+)$/.exec(pathname);
    const file = match && path.join(BOOTSTRAP_DIST, match[1], match[2]);
    if (file && fs.existsSync(file)) {
      return route.fulfill({ body: fs.readFileSync(file), contentType: CONTENT_TYPES[path.extname(file)], headers });
    }
    return route.fulfill({ body: '', contentType: pathname.endsWith('.js') ? 'application/javascript' : 'text/css', headers });
  });
}

describe('browser smoke test', () => {
  let server;
  let browser;
  let page;
  let baseUrl;
  const pageErrors = [];

  before(async () => {
    await prepareDatabase();
    await resetDatabase();
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    if (process.env.E2E_REAL_CDN !== 'true') await serveCdnLocally(context);
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('dialog', (dialog) => dialog.accept()); // the delete confirmation
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await pool.end();
  });

  const text = (selector) => page.locator(selector).innerText();
  const showView = (name) => page.locator(`[data-view="${name}"]`).click();

  test('a fresh install shows the setup form and creates the admin account', async () => {
    await page.goto(baseUrl);
    await page.waitForURL('**/login.html');
    await page.locator('#confirm-group').waitFor({ state: 'visible' });
    assert.equal(await text('#submit-btn'), 'Create account');

    await page.fill('#email', ADMIN.email);
    await page.fill('#password', ADMIN.password);
    await page.fill('#confirm', ADMIN.password);
    await page.click('#submit-btn');
    await page.waitForURL(`${baseUrl}/`);
    await page.locator('#view-dashboard').waitFor({ state: 'visible' });
  });

  test('sign out returns to the login page', async () => {
    await page.click('#logout-btn');
    await page.waitForURL('**/login.html');
    assert.equal(await text('#submit-btn'), 'Sign in');
    assert.equal(await page.locator('#confirm-group').isVisible(), false);
  });

  test('a wrong password shows an error', async () => {
    await page.fill('#email', ADMIN.email);
    await page.fill('#password', 'not-the-password');
    await page.click('#submit-btn');
    await page.locator('#error', { hasText: 'Invalid email or password' }).waitFor();
    assert.match(page.url(), /login\.html$/);
  });

  test('sign in opens an empty dashboard', async () => {
    await page.fill('#email', ADMIN.email);
    await page.fill('#password', ADMIN.password);
    await page.click('#submit-btn');
    await page.waitForURL(`${baseUrl}/`);
    await page.locator('#recent-body', { hasText: 'No cattle records yet' }).waitFor();
    assert.equal(await text('#stat-total'), '0');
  });

  test('add a cow through the form', async () => {
    await page.click('#open-add-modal-btn');
    await page.locator('#cattleModal.show').waitFor();
    await page.fill('#f-tag', COW.tag);
    await page.fill('#f-name', COW.name);
    await page.selectOption('#f-gender', 'female');
    await page.fill('#f-weight', '1150');
    await page.click('#cattle-form button[type="submit"]');

    await page.locator('#notification.show', { hasText: 'New cow added to herd' }).waitFor();
    await page.locator('#cattleModal').waitFor({ state: 'hidden' });
  });

  test('the cow appears on the dashboard', async () => {
    const row = page.locator('#recent-body tr', { hasText: COW.tag });
    await row.waitFor();
    assert.match(await row.innerText(), new RegExp(COW.name));
    assert.equal(await text('#stat-total'), '1');
    assert.equal(await text('#stat-healthy'), '1');
  });

  test('the cow appears in the cattle list and survives a reload', async () => {
    await showView('cattle');
    await page.locator('#view-cattle').waitFor({ state: 'visible' });
    await page.locator('#list-body tr', { hasText: COW.tag }).waitFor();
    assert.equal(await page.locator('#list-body tr').count(), 1);
    assert.equal(await page.locator('#view-dashboard').isVisible(), false);

    await page.reload();
    await page.locator('#recent-body tr', { hasText: COW.tag }).waitFor();
    const { rows } = await pool.query('SELECT tag_number, name_breed, weight FROM cattle');
    assert.deepEqual(rows, [{ tag_number: COW.tag, name_breed: COW.name, weight: '1150.00' }]);
  });

  test('delete the cow from the list', async () => {
    await showView('cattle');
    const row = page.locator('#list-body tr', { hasText: COW.tag });
    await row.locator('.btn-delete').click();

    await page.locator('#notification.show', { hasText: 'Cattle record deleted' }).waitFor();
    await row.waitFor({ state: 'detached' });
    await page.locator('#list-empty').waitFor({ state: 'visible' });

    await showView('dashboard');
    assert.equal(await text('#stat-total'), '0');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM cattle');
    assert.equal(rows[0].n, 0);
  });

  test('no uncaught JavaScript errors happened along the way', () => {
    assert.deepEqual(pageErrors, []);
  });
});
