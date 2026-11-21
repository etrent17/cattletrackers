import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { centsToAmount, formatCents, formatMoney, isValidAmount, sumCents, toCents } from '../../src/utils/money.js';
import { monthLabel, presetRange, totalsInCents, transactionsToCsv } from '../../src/services/FinanceService.js';

describe('money', () => {
  test('toCents parses decimal strings exactly', () => {
    assert.equal(toCents('12.3'), 1230);
    assert.equal(toCents('12.30'), 1230);
    assert.equal(toCents('0.07'), 7);
    assert.equal(toCents('7'), 700);
    assert.equal(toCents(7), 700);
    assert.equal(toCents('-0.30'), -30);
    assert.equal(toCents('-0'), 0);
    assert.equal(toCents('9999999999.99'), 999999999999);
    assert.ok(Number.isNaN(toCents('1.005')));
    assert.ok(Number.isNaN(toCents('1e3')));
    assert.ok(Number.isNaN(toCents('abc')));
    assert.ok(Number.isNaN(toCents('')));
  });

  test('sums without floating-point drift', () => {
    assert.equal(sumCents(['0.10', '0.20']), 30);
    assert.equal(centsToAmount(sumCents(['0.10', '0.20'])), '0.30');
    const many = Array.from({ length: 1000 }, () => '0.10');
    assert.equal(centsToAmount(sumCents(many)), '100.00');
    assert.equal(centsToAmount(sumCents(['9999999999.99', '9999999999.99', '9999999999.99', '0.01'])), '29999999999.98');
  });

  test('centsToAmount and formatting', () => {
    assert.equal(centsToAmount(5), '0.05');
    assert.equal(centsToAmount(-5), '-0.05');
    assert.equal(centsToAmount(0), '0.00');
    assert.equal(formatMoney('1234567.8'), '$1,234,567.80');
    assert.equal(formatMoney('-0.30'), '-$0.30');
    assert.equal(formatMoney('999'), '$999.00');
    assert.equal(formatMoney('not money'), '—');
    assert.equal(formatCents(-123456), '-$1,234.56');
  });

  test('isValidAmount matches the API rule', () => {
    for (const ok of ['0.01', '1', '125.5', '125.50', '9999999999.99', ' 3.20 ']) assert.equal(isValidAmount(ok), true, ok);
    for (const bad of ['0', '0.00', '-1', '1.005', '12345678901', '1e3', '', 'abc', null, undefined]) {
      assert.equal(isValidAmount(bad), false, String(bad));
    }
  });
});

describe('finance helpers', () => {
  const NOW = new Date(2026, 10, 21, 12); // 21 Nov 2026, local time

  test('presetRange gives local calendar dates', () => {
    assert.deepEqual(presetRange('month', NOW), { from: '2026-11-01', to: '2026-11-30' });
    assert.deepEqual(presetRange('year', NOW), { from: '2026-01-01', to: '2026-12-31' });
    assert.deepEqual(presetRange('last-year', NOW), { from: '2025-01-01', to: '2025-12-31' });
    assert.deepEqual(presetRange('12m', NOW), { from: '2025-12-01', to: '2026-11-30' });
    assert.deepEqual(presetRange('all', NOW), { from: '', to: '' });
    assert.deepEqual(presetRange('12m', new Date(2026, 1, 10)), { from: '2025-03-01', to: '2026-02-28' });
  });

  test('totalsInCents adds income and expenses exactly', () => {
    const totals = totalsInCents([
      { kind: 'income', amount: '0.10' },
      { kind: 'income', amount: '0.20' },
      { kind: 'expense', amount: '0.60' },
    ]);
    assert.deepEqual(totals, { income: 30, expenses: 60, net: -30 });
  });

  test('monthLabel', () => {
    assert.equal(monthLabel('2026-03'), 'Mar 2026');
    assert.equal(monthLabel('2025-12'), 'Dec 2025');
  });

  test('transactionsToCsv writes a header and escapes every text field', () => {
    const csv = transactionsToCsv([
      { date: '2026-03-10', kind: 'expense', category: 'Feed', amount: '125.50', cattleTagNumber: 'CT-1', description: 'Hay, 20 bales' },
      { date: '2026-03-11', kind: 'income', category: '=cmd|"/c calc"!A1', amount: '10.00', cattleTagNumber: null, description: '' },
      { date: '2026-03-12', kind: 'expense', category: 'Other', amount: '1.00', cattleTagNumber: '@tag', description: '-3 bags' },
    ]);
    assert.equal(
      csv,
      'Date,Type,Category,Amount,Animal,Description\r\n' +
        '2026-03-10,Expense,Feed,125.50,CT-1,"Hay, 20 bales"\r\n' +
        `2026-03-11,Income,"'=cmd|""/c calc""!A1",10.00,,\r\n` +
        "2026-03-12,Expense,Other,1.00,'@tag,'-3 bags\r\n"
    );
  });
});
