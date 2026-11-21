// Browser test for the User Management screen: an admin lists, adds, promotes and deletes users;
// a regular user does not see the screen. Run with `npm run test:e2e` (needs TEST_DATABASE_URL).
// CDN requests are answered locally, as in smoke.e2e.js.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { app, pool, request, createUser, prepareDatabase, resetDatabase, PASSWORD } = require('../test/helpers/api');

const ADMIN = 'boss@example.com';
// Quotes and an ampersand are valid in an email address and must display literally.
const HAND = "o'neil&sons@example.com";
const HAND_PASSWORD = 'temporary-password-1';
const REGULAR = 'regular@example.com';

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

describe('user management screen', () => {
  let server;
  let browser;
  let page;
  let baseUrl;
  const pageErrors = [];
  const dialogs = [];
  let answerDialog = true;

  before(async () => {
    await prepareDatabase();
    await resetDatabase();
    await createUser(ADMIN, { role: 'admin' });
    await createUser(REGULAR);
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
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      return answerDialog ? dialog.accept() : dialog.dismiss();
    });
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await pool.end();
  });

  const usersLink = () => page.locator('[data-view="users"]');
  const row = (email) => page.locator('#users-body tr', { hasText: email });
  const toast = (text) => page.locator('#notification.show', { hasText: text }).waitFor();
  const roleOf = async (email) => (await pool.query('SELECT role FROM users WHERE email = $1', [email])).rows[0]?.role;

  async function signIn(email, password = PASSWORD) {
    await page.goto(`${baseUrl}/login.html`);
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('#submit-btn');
    await page.waitForURL(`${baseUrl}/`);
    await page.locator('#view-dashboard').waitFor({ state: 'visible' });
  }

  async function signOut() {
    await page.click('#logout-btn');
    await page.waitForURL('**/login.html');
  }

  test('an admin sees User Management and the list of users', async () => {
    await signIn(ADMIN);
    await usersLink().waitFor({ state: 'visible' });
    await usersLink().click();
    await page.locator('#view-secondary').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#secondary-view-title').innerText(), 'User Management');

    await row(REGULAR).waitFor();
    assert.equal(await page.locator('#users-body tr').count(), 2);
    const me = row(ADMIN);
    assert.match(await me.innerText(), /You/);
    assert.equal(await me.locator('[data-user-action="delete"]').count(), 0, 'no Delete button for yourself');
    assert.equal(await me.locator('select').inputValue(), 'admin');
    assert.equal(await row(REGULAR).locator('select').inputValue(), 'user');
    assert.equal(await row(REGULAR).locator('[data-user-action="delete"]').count(), 1);
  });

  test('the form refuses a short password without calling the server', async () => {
    await page.fill('#new-user-email', 'short@example.com');
    await page.fill('#new-user-password', 'short');
    await page.click('#add-user-btn');
    await page.locator('#add-user-error', { hasText: '10 to 128 characters' }).waitFor();
    assert.equal(await roleOf('short@example.com'), undefined);
  });

  test('an admin adds a user, shown escaped, who can then sign in', async () => {
    await page.fill('#new-user-email', HAND);
    await page.fill('#new-user-password', HAND_PASSWORD);
    await page.selectOption('#new-user-role', 'user');
    await page.click('#add-user-btn');
    await toast(`Added ${HAND}`);
    await row(HAND).waitFor();
    assert.match(await row(HAND).locator('td').first().innerText(), new RegExp(HAND.replace(/[.&']/g, '\\$&')));
    assert.equal(await page.locator('#add-user-error').isVisible(), false);
    assert.equal(await page.inputValue('#new-user-email'), '', 'the form is cleared');
    assert.equal(await roleOf(HAND), 'user');

    await request(app).post('/api/auth/login').send({ email: HAND, password: HAND_PASSWORD }).expect(200);
  });

  test('adding an existing email shows the server error in the form', async () => {
    await page.fill('#new-user-email', REGULAR);
    await page.fill('#new-user-password', HAND_PASSWORD);
    await page.click('#add-user-btn');
    await page.locator('#add-user-error', { hasText: 'That email is already registered' }).waitFor();
  });

  test('an admin promotes and demotes a user from the role menu', async () => {
    await row(HAND).locator('select').selectOption('admin');
    await toast(`${HAND} is now an admin`);
    assert.equal(await roleOf(HAND), 'admin');

    await row(HAND).locator('select').selectOption('user');
    await toast(`${HAND} is now a regular user`);
    assert.equal(await roleOf(HAND), 'user');
  });

  test('deleting asks first, warns about the cattle, and can be cancelled', async () => {
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [HAND]);
    await pool.query("INSERT INTO cattle (owner_id, tag_number) VALUES ($1, 'H-1'), ($1, 'H-2')", [rows[0].id]);
    await usersLink().click(); // reload the list so the cattle count is current
    await row(HAND).filter({ hasText: '2 animals' }).waitFor();

    answerDialog = false;
    dialogs.length = 0;
    await row(HAND).locator('[data-user-action="delete"]').click();
    assert.equal(dialogs.length, 1);
    assert.match(dialogs[0], new RegExp(`Delete the user ${HAND.replace(/[.&']/g, '\\$&')}`));
    assert.match(dialogs[0], /permanently deletes their 2 cattle records/);
    assert.match(dialogs[0], /can't be undone/);
    assert.equal(await roleOf(HAND), 'user', 'cancelling keeps the user');
    answerDialog = true;
  });

  test('an admin deletes a user together with their cattle', async () => {
    await row(HAND).locator('[data-user-action="delete"]').click();
    await toast(`Deleted ${HAND} and 2 cattle records`);
    await row(HAND).waitFor({ state: 'detached' });
    assert.equal(await roleOf(HAND), undefined);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM cattle');
    assert.equal(rows[0].n, 0);
  });

  test('a regular user does not see User Management and gets 403 from the API', async () => {
    await signOut();
    await signIn(REGULAR);
    assert.equal(await usersLink().isVisible(), false);
    const status = await page.evaluate(() => fetch('/api/users').then((r) => r.status));
    assert.equal(status, 403);
  });

  test('an admin who removes their own admin access leaves the screen and loses the menu item', async () => {
    await signOut();
    await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", [REGULAR]); // a second admin
    await signIn(ADMIN);
    await usersLink().click();
    await row(REGULAR).waitFor();

    dialogs.length = 0;
    await row(ADMIN).locator('select').selectOption('user');
    assert.match(dialogs[0], /Remove your own admin access/);
    await toast(`${ADMIN} is now a regular user`);
    await page.locator('#view-dashboard').waitFor({ state: 'visible' });
    assert.equal(await usersLink().isVisible(), false);
    assert.equal(await roleOf(ADMIN), 'user');
  });

  test('no uncaught JavaScript errors happened along the way', () => {
    assert.deepEqual(pageErrors, []);
  });
});
