// Runs with the rate limiter on (see test/api/rate-limit.test.js). A separate file because
// the login limiter's in-memory count would otherwise carry over from the login tests.
process.env.RATE_LIMIT_DISABLED = 'false';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signedIn, useDatabase, PASSWORD } = require('../helpers/api');

useDatabase();

test('password changes allow 10 attempts per 15 minutes per user, then answer 429', async () => {
  const farmer = await signedIn('farmer@example.com');
  const neighbour = await signedIn('neighbour@example.com');
  const attempt = (client, currentPassword = 'wrong-password') =>
    client.post('/api/auth/password').send({ currentPassword, newPassword: 'a-brand-new-password' });

  for (let n = 1; n <= 10; n += 1) {
    const res = await attempt(farmer);
    assert.equal(res.status, 400, `attempt ${n} should reach the password check`);
  }
  const blocked = await attempt(farmer, PASSWORD);
  assert.equal(blocked.status, 429, 'blocked even with the right password');
  assert.equal(blocked.body.error, 'Too many password change attempts. Please try again later.');
  assert.ok(blocked.headers['ratelimit'] || blocked.headers['ratelimit-limit'], 'sends a RateLimit header');

  // The count is per user: another account on the same IP is not affected.
  await attempt(neighbour, PASSWORD).expect(200);
});
