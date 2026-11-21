import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkNewPassword } from '../../src/views/SettingsView.js';

describe('checkNewPassword', () => {
  test('accepts a valid change', () => {
    assert.equal(checkNewPassword('old-password', 'new-password', 'new-password'), null);
    assert.equal(checkNewPassword('old', 'x'.repeat(10), 'x'.repeat(10)), null);
    assert.equal(checkNewPassword('old', 'x'.repeat(128), 'x'.repeat(128)), null);
  });

  test('needs the current password', () => {
    assert.equal(checkNewPassword('', 'new-password', 'new-password'), 'Enter your current password.');
  });

  test('applies the 10 to 128 character limit, as the server does', () => {
    const msg = 'The new password must be 10 to 128 characters.';
    assert.equal(checkNewPassword('old', 'x'.repeat(9), 'x'.repeat(9)), msg);
    assert.equal(checkNewPassword('old', 'x'.repeat(129), 'x'.repeat(129)), msg);
    assert.equal(checkNewPassword('old', '', ''), msg);
  });

  test('needs the confirmation to match', () => {
    assert.equal(checkNewPassword('old', 'new-password', 'new-passwore'), "The new passwords don't match.");
  });

  test('refuses the current password as the new one', () => {
    assert.equal(
      checkNewPassword('same-password', 'same-password', 'same-password'),
      'The new password must be different from the current one.'
    );
  });
});
