// Browser test for the System Settings screen: account details, changing the password,
// and the demo-account variant. Run with `npm run test:e2e`.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, prepareDatabase, resetDatabase, createUser } = require('../test/helpers/api');
const { startServer, stopServer, newContext, launchBrowser } = require('./helpers');

const ADMIN = { email: 'settings@example.com', password: 'first-password-1' };
const NEW_PASSWORD = 'second-password-2';

describe('settings screen', () => {
  let server;
  let baseUrl;
  let browser;
  let page;
  const pageErrors = [];

  before(async () => {
    await prepareDatabase();
    await resetDatabase();
    await createUser(ADMIN.email, { role: 'admin', password: ADMIN.password });
    ({ server, baseUrl } = await startServer());
    browser = await launchBrowser();
    page = await (await newContext(browser)).newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', (err) => pageErrors.push(err.message));
  });

  after(async () => {
    delete process.env.DEMO_MODE;
    await browser?.close();
    await stopServer(server);
    await pool.end();
  });

  const signIn = async (p, password) => {
    await p.goto(`${baseUrl}/login.html`);
    await p.fill('#email', ADMIN.email);
    await p.fill('#password', password);
    await p.click('#submit-btn');
  };
  const openSettings = async (p) => {
    await p.locator('[data-view="settings"]').click();
    await p.locator('#view-secondary').waitFor({ state: 'visible' });
    await p.locator('#settings-email').waitFor();
  };
  const fillPasswordForm = async (current, next, confirm = next) => {
    await page.fill('#settings-current-password', current);
    await page.fill('#settings-new-password', next);
    await page.fill('#settings-confirm-password', confirm);
    await page.click('#settings-password-submit');
  };
  const message = () => page.locator('#settings-password-message');

  test('shows the signed-in account and no localStorage text', async () => {
    await signIn(page, ADMIN.password);
    await page.waitForURL(`${baseUrl}/`);
    await openSettings(page);

    assert.equal(await page.locator('#secondary-view-title').innerText(), 'System Settings');
    assert.equal(await page.locator('#settings-email').innerText(), ADMIN.email);
    assert.equal(await page.locator('#settings-role').innerText(), 'Administrator');
    assert.equal(await page.locator('#settings-account-type').innerText(), 'Standard account');

    const body = await page.locator('#view-secondary').innerText();
    assert.doesNotMatch(body, /localStorage/i);
    assert.doesNotMatch(body, /Reset to Blueprint/i);
    assert.match(body, /records are kept on the server/);
  });

  test('checks the form before sending it', async () => {
    await fillPasswordForm(ADMIN.password, NEW_PASSWORD, 'something-else-1');
    await message().filter({ hasText: "The new passwords don't match." }).waitFor();
    await fillPasswordForm(ADMIN.password, 'short');
    await message().filter({ hasText: 'The new password must be 10 to 128 characters.' }).waitFor();
  });

  test('a wrong current password is refused', async () => {
    await fillPasswordForm('not-my-password', NEW_PASSWORD);
    await message().filter({ hasText: 'Current password is incorrect' }).waitFor();
    assert.match(await message().getAttribute('class'), /alert-danger/);
    assert.equal(await page.inputValue('#settings-current-password'), '', 'clears the wrong current password');
  });

  test('changing the password signs out another session and keeps this one', async () => {
    // A second browser signed in before the change
    const otherContext = await newContext(browser);
    const other = await otherContext.newPage();
    await signIn(other, ADMIN.password);
    await other.waitForURL(`${baseUrl}/`);

    await fillPasswordForm(ADMIN.password, NEW_PASSWORD);
    await message().filter({ hasText: 'Password changed.' }).waitFor();
    assert.match(await message().getAttribute('class'), /alert-success/);
    await page.locator('#notification.show', { hasText: 'Password changed' }).waitFor();
    assert.equal(await page.inputValue('#settings-new-password'), '', 'the form is cleared');

    // This page is still signed in
    await page.reload();
    await page.locator('#view-dashboard').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).pathname, '/');

    // The other browser is sent to the login page on its next request
    await other.reload();
    await other.waitForURL('**/login.html');
    await otherContext.close();
  });

  test('the old password no longer works and the new one does', async () => {
    await page.click('#logout-btn');
    await page.waitForURL('**/login.html');

    await signIn(page, ADMIN.password);
    await page.locator('#error', { hasText: 'Invalid email or password' }).waitFor();

    await signIn(page, NEW_PASSWORD);
    await page.waitForURL(`${baseUrl}/`);
  });

  test('account details are escaped', async () => {
    const email = '<b id="injected">x</b>@example.com';
    await pool.query('UPDATE users SET email = $1 WHERE email = $2', [email, ADMIN.email]);
    await page.reload();
    await openSettings(page);
    assert.equal(await page.locator('#settings-email').innerText(), email);
    assert.equal(await page.locator('#injected').count(), 0);
  });

  test('a demo account sees its type and no password form', async () => {
    process.env.DEMO_MODE = 'true';
    const demoContext = await newContext(browser);
    const demo = await demoContext.newPage();
    demo.on('pageerror', (err) => pageErrors.push(err.message));
    await demo.goto(`${baseUrl}/login.html`);
    await demo.click('#demo-btn');
    await demo.waitForURL(`${baseUrl}/`);
    await openSettings(demo);

    assert.match(await demo.locator('#settings-account-type').innerText(), /Demo/);
    assert.equal(await demo.locator('#settings-role').innerText(), 'User');
    assert.match(await demo.locator('#settings-password-demo').innerText(), /Demo accounts can't change their password/);
    assert.equal(await demo.locator('#settings-password-form').count(), 0);
    await demoContext.close();
  });

  test('no uncaught JavaScript errors happened along the way', () => {
    assert.deepEqual(pageErrors, []);
  });
});
