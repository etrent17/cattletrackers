import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateTagNumber, validateWeight, validateBirthDate } from '../../src/utils/validators.js';

describe('validateTagNumber', () => {
  test('accepts 1 to 25 characters', () => {
    assert.equal(validateTagNumber('7'), true);
    assert.equal(validateTagNumber('CT-001'), true);
    assert.equal(validateTagNumber('X'.repeat(25)), true);
  });

  test('ignores surrounding spaces when measuring', () => {
    assert.equal(validateTagNumber(`  ${'X'.repeat(25)}  `), true);
  });

  test('rejects empty, blank, too long and non-text values', () => {
    for (const value of ['', '   ', 'X'.repeat(26), null, undefined, 42, {}]) {
      assert.equal(validateTagNumber(value), false, JSON.stringify(value));
    }
  });
});

describe('validateWeight', () => {
  test('is optional', () => {
    for (const value of [null, undefined, '']) assert.equal(validateWeight(value), true);
  });

  test('accepts numbers and numeric text above 0 up to 5000', () => {
    for (const value of [0.1, 1, 1380.5, 5000, '1200', '0.5']) {
      assert.equal(validateWeight(value), true, String(value));
    }
  });

  test('rejects 0, negatives, values over 5000 and non-numbers', () => {
    for (const value of [0, '0', -1, 5000.1, 6000, 'heavy', NaN]) {
      assert.equal(validateWeight(value), false, String(value));
    }
  });
});

describe('validateBirthDate', () => {
  test('is optional', () => {
    for (const value of [null, undefined, '']) assert.equal(validateBirthDate(value), true);
  });

  test('accepts past dates', () => {
    assert.equal(validateBirthDate('2020-01-15'), true);
    assert.equal(validateBirthDate('1999-12-31'), true);
  });

  test('rejects future dates', () => {
    const nextYear = `${new Date().getFullYear() + 1}-06-15`;
    assert.equal(validateBirthDate(nextYear), false);
  });

  test('rejects text that is not a date', () => {
    assert.equal(validateBirthDate('not a date'), false);
  });
});
