import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLocalDate,
  todayISO,
  calculateAge,
  getTimeAgo,
  formatHealthStatus,
} from '../../src/utils/DateHelpers.js';

// Freeze "now" at local noon on 15 June 2026 for the tests that depend on today's date.
const NOW = new Date(2026, 5, 15, 12, 0, 0);
function freezeClock() {
  beforeEach(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
  afterEach(() => mock.timers.reset());
}

describe('parseLocalDate', () => {
  test('reads YYYY-MM-DD as a local calendar date, not UTC', () => {
    const date = parseLocalDate('2026-03-01');
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 2);
    assert.equal(date.getDate(), 1);
    assert.equal(date.getHours(), 0);
  });

  test('returns null for anything that is not YYYY-MM-DD', () => {
    for (const value of ['', null, undefined, '2026-3-1', '03/01/2026', '2026-03-01T00:00:00Z', 'soon']) {
      assert.equal(parseLocalDate(value), null, String(value));
    }
  });
});

describe('todayISO', () => {
  test('formats a date as zero-padded YYYY-MM-DD in local time', () => {
    assert.equal(todayISO(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(todayISO(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
  });

  test('round-trips with parseLocalDate', () => {
    assert.equal(todayISO(parseLocalDate('2024-02-29')), '2024-02-29');
  });

  describe('with no argument', () => {
    freezeClock();
    test('uses the current date', () => {
      assert.equal(todayISO(), '2026-06-15');
    });
  });
});

describe('calculateAge', () => {
  freezeClock();

  test('is "Unknown" without a usable birth date', () => {
    for (const value of [null, undefined, '', 'garbage']) {
      assert.equal(calculateAge(value), 'Unknown');
    }
  });

  test('shows months under one year', () => {
    assert.equal(calculateAge('2026-06-01'), '0 mos');
    assert.equal(calculateAge('2026-01-20'), '5 mos');
    assert.equal(calculateAge('2025-07-01'), '11 mos');
  });

  test('shows whole years, with months when there are any', () => {
    assert.equal(calculateAge('2025-06-15'), '1 yrs');
    assert.equal(calculateAge('2023-06-01'), '3 yrs');
    assert.equal(calculateAge('2023-02-10'), '3y 4m');
  });

  test('never goes negative for a future date', () => {
    assert.equal(calculateAge('2026-09-01'), '0 mos');
  });
});

describe('getTimeAgo', () => {
  freezeClock();
  const ago = (seconds) => new Date(NOW.getTime() - seconds * 1000);

  test('steps through seconds, minutes, hours and days', () => {
    assert.equal(getTimeAgo(ago(5)), 'Just now');
    assert.equal(getTimeAgo(ago(59)), 'Just now');
    assert.equal(getTimeAgo(ago(60)), '1m ago');
    assert.equal(getTimeAgo(ago(59 * 60)), '59m ago');
    assert.equal(getTimeAgo(ago(3 * 3600)), '3h ago');
    assert.equal(getTimeAgo(ago(6 * 86400)), '6d ago');
  });

  test('falls back to a date after a week', () => {
    const old = ago(8 * 86400);
    assert.equal(getTimeAgo(old), old.toLocaleDateString());
  });
});

describe('formatHealthStatus', () => {
  test('maps each known status to a label and badge class', () => {
    assert.deepEqual(formatHealthStatus('healthy'), { label: 'Healthy', badgeClass: 'bg-success' });
    assert.deepEqual(formatHealthStatus('under_treatment'), { label: 'Under Treatment', badgeClass: 'bg-warning text-dark' });
    assert.deepEqual(formatHealthStatus('quarantine'), { label: 'In Quarantine', badgeClass: 'bg-danger' });
    assert.deepEqual(formatHealthStatus('pregnant'), { label: 'Pregnant', badgeClass: 'bg-info text-dark' });
  });

  test('falls back to a neutral badge for unknown or missing statuses', () => {
    assert.deepEqual(formatHealthStatus('retired'), { label: 'retired', badgeClass: 'bg-secondary' });
    assert.deepEqual(formatHealthStatus(undefined), { label: 'Healthy', badgeClass: 'bg-secondary' });
  });
});
