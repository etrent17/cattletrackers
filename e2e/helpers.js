// Shared setup for browser tests (files named *.e2e.js; this file is not a test).
//
// Bootstrap and Font Awesome normally load from CDNs. To keep tests independent of the
// network, CDN requests are answered locally: Bootstrap from node_modules/bootstrap (a dev
// dependency, same version as index.html) and Font Awesome with an empty stylesheet.
// Set E2E_REAL_CDN=true to let the browser fetch the real CDN files instead.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { app } = require('../test/helpers/api');

const BOOTSTRAP_DIST = path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist');
const CONTENT_TYPES = { '.css': 'text/css', '.js': 'application/javascript' };

async function serveCdnLocally(context) {
  if (process.env.E2E_REAL_CDN === 'true') return;
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

// Starts the app on a free port; resolves to { server, baseUrl }.
function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const stopServer = (server) => new Promise((resolve) => (server ? server.close(resolve) : resolve()));

// A fresh browser context (own cookies) with CDNs served locally and service workers blocked.
async function newContext(browser) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await serveCdnLocally(context);
  return context;
}

const launchBrowser = () => chromium.launch();

module.exports = { serveCdnLocally, startServer, stopServer, newContext, launchBrowser };
