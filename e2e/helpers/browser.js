// Shared setup for browser tests: starts the app on a free port against TEST_DATABASE_URL,
// opens headless Chromium with the CDNs answered locally (see e2e/smoke.e2e.js for why), and
// can sign a user in without going through the login form.
//
//   const session = useBrowser();          // inside describe(); registers before/after hooks
//   await session.signIn('a@example.com'); // creates the user, signs in, opens the dashboard
//   session.page                           // the Playwright page
//   session.openContext()                  // another browser (own cookies and storage), e.g. a second device
//
// Service workers are blocked unless a test asks for them: useBrowser({ serviceWorkers: 'allow' })
// or session.openContext({ serviceWorkers: 'allow' }). Only the offline tests need the real one.
//
// Browser test files run one at a time (`--test-concurrency=1` in `npm run test:e2e`) because
// they share one database; each file empties it when it starts.
const { before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { app, pool, prepareDatabase, resetDatabase, createUser, PASSWORD } = require('../../test/helpers/api');

const BOOTSTRAP_DIST = path.join(__dirname, '..', '..', 'node_modules', 'bootstrap', 'dist');
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

function useBrowser({ serviceWorkers = 'block' } = {}) {
  const session = { page: null, context: null, baseUrl: '', pageErrors: [], dialogs: [], pool };
  let server;
  let browser;

  before(async () => {
    await prepareDatabase();
    await resetDatabase();
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    session.baseUrl = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch();
    session.context = await session.openContext({ serviceWorkers });
    session.page = await session.newPage(session.context);
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await pool.end();
  });

  // A fresh browser context with the CDNs answered locally. Closed with the browser.
  session.openContext = async (options = {}) => {
    const context = await browser.newContext({ serviceWorkers: 'block', ...options });
    if (process.env.E2E_REAL_CDN !== 'true') await serveCdnLocally(context);
    return context;
  };

  // A page that records its errors and accepts dialogs (their text goes to session.dialogs).
  session.newPage = async (context) => {
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', (err) => session.pageErrors.push(err.message));
    page.on('dialog', (dialog) => { // confirm() before a delete
      session.dialogs.push(dialog.message());
      dialog.accept();
    });
    return page;
  };

  // Creates the user in the database, signs in through the API with the page's cookies, and
  // opens the app. Returns the user row.
  session.signIn = async (email, options = {}) => {
    const user = await createUser(email, options);
    await session.signInExisting(email, { password: options.password });
    return user;
  };

  // Signs an existing user in on `page` (default: the session's page) and opens the app.
  session.signInExisting = async (email, { password = PASSWORD, page = session.page } = {}) => {
    const res = await page.request.post(`${session.baseUrl}/api/auth/login`, { data: { email, password } });
    if (!res.ok()) throw new Error(`Sign in failed (${res.status()})`);
    await page.goto(session.baseUrl);
    await page.locator('#view-dashboard').waitFor({ state: 'visible' });
  };

  session.showView = (name) => session.page.locator(`[data-view="${name}"]`).click();

  return session;
}

module.exports = { useBrowser };
