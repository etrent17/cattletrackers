// Browser test for financial records: add income and an expense, see the totals on
// the records page, the report and the cow details dialog, and export them as CSV.
// Run with `npm run test:e2e`; like smoke.e2e.js it starts the app on a free port
// against TEST_DATABASE_URL and answers CDN requests locally (E2E_REAL_CDN=true to fetch them).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { app, pool, prepareDatabase, resetDatabase, createUser, PASSWORD } = require('../test/helpers/api');

const EMAIL = 'finance@example.com';
const BOOTSTRAP_DIST = path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist');
const CONTENT_TYPES = { '.css': 'text/css', '.js': 'application/javascript' };

// Same as in smoke.e2e.js.
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

// Today's local date, YYYY-MM-DD (the form's default date).
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('financial records in the browser', () => {
  let server;
  let browser;
  let page;
  let baseUrl;
  const pageErrors = [];

  before(async () => {
    await prepareDatabase();
    await resetDatabase();
    const user = await createUser(EMAIL, { role: 'admin' });
    await pool.query("INSERT INTO cattle (owner_id, tag_number, name_breed, gender) VALUES ($1, 'FIN-1', 'Ledger Angus', 'female')", [user.id]);
    await pool.query("INSERT INTO cattle (owner_id, tag_number, name_breed, gender) VALUES ($1, 'FIN-2', 'Second Hereford', 'female')", [user.id]);

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch();
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
    if (process.env.E2E_REAL_CDN !== 'true') await serveCdnLocally(context);
    page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('dialog', (dialog) => dialog.accept());
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await pool.end();
  });

  const text = (selector) => page.locator(selector).innerText();
  const showView = (name) => page.locator(`[data-view="${name}"]`).click();

  async function addTransaction({ kind, category, amount, animal, description }) {
    await page.click('#fin-add-btn');
    await page.locator('#transactionModal.show').waitFor();
    await page.selectOption('#t-kind', kind);
    await page.fill('#t-category', category);
    await page.fill('#t-amount', amount);
    if (animal) await page.selectOption('#t-cattle', { label: animal });
    if (description) await page.fill('#t-description', description);
    await page.click('#transaction-form button[type="submit"]');
    await page.locator('#notification.show', { hasText: 'Transaction added' }).waitFor();
    await page.locator('#transactionModal').waitFor({ state: 'hidden' });
  }

  test('sign in and open an empty Financial Records page', async () => {
    await page.goto(`${baseUrl}/login.html`);
    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.click('#submit-btn');
    await page.waitForURL(`${baseUrl}/`);
    await page.locator('#recent-body tr', { hasText: 'FIN-1' }).waitFor();

    await showView('finance');
    await page.locator('#fin-empty').waitFor();
    assert.equal(await text('#secondary-view-title'), 'Financial Records');
    assert.equal(await text('#fin-total-net'), '$0.00');
  });

  test('add income and an expense through the form', async () => {
    await addTransaction({ kind: 'income', category: 'Sale of animals', amount: '1000.10' });
    await addTransaction({ kind: 'expense', category: 'Feed', amount: '250.20', animal: 'FIN-1 – Ledger Angus', description: '=cmd, "hay"' });
    await addTransaction({ kind: 'expense', category: 'Feed', amount: '0.10' });

    await page.locator('#fin-body tr').nth(2).waitFor();
    assert.equal(await page.locator('#fin-body tr').count(), 3);
    assert.equal(await text('#fin-total-income'), '$1,000.10');
    assert.equal(await text('#fin-total-expenses'), '$250.30');
    assert.equal(await text('#fin-total-net'), '$749.80');

    const { rows } = await pool.query('SELECT kind, amount, date::text FROM transactions ORDER BY amount');
    assert.deepEqual(rows, [
      { kind: 'expense', amount: '0.10', date: today() },
      { kind: 'expense', amount: '250.20', date: today() },
      { kind: 'income', amount: '1000.10', date: today() },
    ]);
  });

  test('the report shows the totals, net and cost per head', async () => {
    await showView('financial-reports');
    await page.locator('#fin-report-income').waitFor();
    assert.equal(await text('#secondary-view-title'), 'Financial Reports');
    assert.equal(await text('#fin-report-income'), '$1,000.10');
    assert.equal(await text('#fin-report-expenses'), '$250.30');
    assert.equal(await text('#fin-report-net'), '$749.80');
    assert.equal(await text('#fin-report-cost-per-head'), '$125.15'); // 250.30 / 2 animals
    assert.equal(await page.locator('#fin-months tbody tr').count(), 1);
    assert.match(await text('#fin-categories-expense'), /Feed\s+2\s+\$250\.30/);
  });

  test('editing a transaction updates the report', async () => {
    await showView('finance');
    const row = page.locator('#fin-body tr', { hasText: '-$0.10' });
    await row.locator('.fin-edit').click();
    await page.locator('#transactionModal.show').waitFor();
    assert.equal(await page.inputValue('#t-amount'), '0.10');
    await page.fill('#t-amount', '0.20');
    await page.click('#transaction-form button[type="submit"]');
    await page.locator('#notification.show', { hasText: 'Transaction updated' }).waitFor();
    await page.locator('#fin-total-expenses', { hasText: '$250.40' }).waitFor();

    await showView('financial-reports');
    await page.locator('#fin-report-net', { hasText: '$749.70' }).waitFor();
  });

  test('a period with no transactions shows zero', async () => {
    await page.selectOption('#fin-preset', 'last-year');
    await page.locator('#fin-empty').waitFor();
    assert.equal(await text('#fin-report-income'), '$0.00');
    await page.selectOption('#fin-preset', '12m');
    await page.locator('#fin-report-income', { hasText: '$1,000.10' }).waitFor();
  });

  test('the cow details dialog lists that animal\'s transactions', async () => {
    await showView('cattle');
    await page.locator('#list-body tr', { hasText: 'FIN-1' }).locator('.btn-view').click();
    const section = page.locator('#cow-transactions');
    await section.locator('table').waitFor();
    assert.equal(await section.locator('tbody tr').count(), 1);
    assert.match(await section.innerText(), /-\$250\.20/);
    await page.click('#viewCowModal .btn-close');
    await page.locator('#viewCowModal').waitFor({ state: 'hidden' });
  });

  test('export the transactions as CSV', async () => {
    await showView('finance');
    await page.locator('#fin-body tr').first().waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#fin-export-btn')]);
    assert.match(download.suggestedFilename(), /^transactions-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
    assert.equal(lines[0], 'Date,Type,Category,Amount,Animal,Description');
    assert.equal(lines.length, 4);
    assert.ok(lines.includes(`${today()},Expense,Feed,250.20,FIN-1,"'=cmd, ""hay"""`), csv);
    assert.ok(lines.includes(`${today()},Income,Sale of animals,1000.10,,`), csv);
  });

  test('deleting the animal keeps its transaction', async () => {
    await showView('cattle');
    await page.locator('#list-body tr', { hasText: 'FIN-1' }).locator('.btn-delete').click();
    await page.locator('#notification.show', { hasText: 'Cattle record deleted' }).waitFor();
    await showView('finance');
    await page.locator('#fin-body tr').nth(2).waitFor();
    const row = page.locator('#fin-body tr', { hasText: '250.20' });
    assert.doesNotMatch(await row.innerText(), /FIN-1/);
    assert.equal(await text('#fin-total-expenses'), '$250.40');
  });

  test('delete a transaction', async () => {
    await page.locator('#fin-body tr', { hasText: '-$0.20' }).locator('.fin-delete').click();
    await page.locator('#notification.show', { hasText: 'Transaction deleted' }).waitFor();
    await page.locator('#fin-total-expenses', { hasText: '$250.20' }).waitFor();
    assert.equal(await page.locator('#fin-body tr').count(), 2);
  });

  test('no uncaught JavaScript errors happened along the way', () => {
    assert.deepEqual(pageErrors, []);
  });
});
