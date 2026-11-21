// Static files, security headers and the JSON error handler.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, useDatabase } = require('../helpers/api');

useDatabase();

describe('static files', () => {
  test('serves the app page and the login page', async () => {
    const index = await request(app).get('/').expect(200);
    assert.match(index.headers['content-type'], /text\/html/);
    assert.match(index.text, /<title>Cattle Trackers/);
    const login = await request(app).get('/login.html').expect(200);
    assert.match(login.text, /id="auth-form"/);
  });

  test('serves the front-end modules under /src as JavaScript', async () => {
    for (const path of ['/src/app.js', '/src/auth.js', '/src/services/CattleService.js']) {
      const res = await request(app).get(path).expect(200);
      assert.match(res.headers['content-type'], /javascript/, path);
    }
  });

  test('does not serve server-side files', async () => {
    for (const path of ['/server.js', '/app.js', '/db.js', '/package.json', '/routes/auth.js', '/.env']) {
      await request(app).get(path).expect(404);
    }
  });
});

describe('security headers', () => {
  test('sends a content security policy limited to self and the two CDNs', async () => {
    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net(;|$)/);
    // the service worker fetches the CDN files itself, which connect-src governs (offline editing)
    assert.match(csp, /connect-src 'self' https:\/\/cdn\.jsdelivr\.net https:\/\/cdnjs\.cloudflare\.com(;|$)/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  test('does not send HSTS unless HSTS=true', async () => {
    const res = await request(app).get('/');
    assert.equal(res.headers['strict-transport-security'], undefined);
  });
});

describe('unknown API routes', () => {
  test('return 404', async () => {
    await request(app).get('/api/nope').expect(404);
  });
});
