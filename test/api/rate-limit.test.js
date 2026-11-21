// The other API tests run with RATE_LIMIT_DISABLED=true. Each test file runs in its own
// process, so this one leaves the limiter on to prove it still works by default.
process.env.RATE_LIMIT_DISABLED = 'false';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { request, app, useDatabase } = require('../helpers/api');

useDatabase();

test('login allows 20 attempts per 15 minutes, then answers 429', async () => {
  const attempt = () => request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'x' });

  for (let n = 1; n <= 20; n += 1) {
    const res = await attempt();
    assert.equal(res.status, 400, `attempt ${n} should reach validation`);
  }
  const blocked = await attempt();
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers['ratelimit'] || blocked.headers['ratelimit-limit'], 'sends a RateLimit header');

  // Setup shares the same limiter.
  await request(app).post('/api/auth/setup').send({ email: 'admin@example.com', password: 'long-enough-password' }).expect(429);
});

test('the limiter does not cover other routes', async () => {
  await request(app).get('/api/auth/status').expect(200);
  await request(app).get('/api/health').expect(200);
});
