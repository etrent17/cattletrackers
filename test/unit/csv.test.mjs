import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { csvField, toCsv } from '../../src/utils/csv.js';

describe('csvField', () => {
  test('leaves plain values unchanged', () => {
    assert.equal(csvField('Feed'), 'Feed');
    assert.equal(csvField('125.50'), '125.50');
    assert.equal(csvField('2026-03-10'), '2026-03-10');
    assert.equal(csvField("Daisy's calf"), "Daisy's calf");
  });

  test('turns null and undefined into an empty field', () => {
    assert.equal(csvField(null), '');
    assert.equal(csvField(undefined), '');
    assert.equal(csvField(''), '');
  });

  test('quotes fields with commas, quotes or line breaks and doubles inner quotes', () => {
    assert.equal(csvField('Hay, 20 bales'), '"Hay, 20 bales"');
    assert.equal(csvField('The "good" hay'), '"The ""good"" hay"');
    assert.equal(csvField('line 1\nline 2'), '"line 1\nline 2"');
    assert.equal(csvField('line 1\r\nline 2'), '"line 1\r\nline 2"');
    assert.equal(csvField('"'), '""""');
  });

  test('prefixes a quote to values a spreadsheet would read as a formula', () => {
    assert.equal(csvField('=SUM(A1:A9)'), "'=SUM(A1:A9)");
    assert.equal(csvField('+1'), "'+1");
    assert.equal(csvField('-5 bags returned'), "'-5 bags returned");
    assert.equal(csvField('@cmd'), "'@cmd");
    assert.equal(csvField('\t=1+1'), "'\t=1+1");
    assert.equal(csvField('\r=1+1'), "\"'\r=1+1\"");
  });

  test('neutralises a formula and still quotes it when needed', () => {
    assert.equal(csvField('=HYPERLINK("http://x","click")'), `"'=HYPERLINK(""http://x"",""click"")"`);
    assert.equal(csvField('=1,2'), `"'=1,2"`);
  });

  test('only checks the first character', () => {
    assert.equal(csvField('a=b'), 'a=b');
    assert.equal(csvField('Vet - follow up'), 'Vet - follow up');
  });

  test('stringifies numbers', () => {
    assert.equal(csvField(12.5), '12.5');
    assert.equal(csvField(0), '0');
  });
});

describe('toCsv', () => {
  test('joins fields with commas and rows with CRLF, ending with CRLF', () => {
    assert.equal(toCsv([['a', 'b'], ['1', 'x,y']]), 'a,b\r\n1,"x,y"\r\n');
  });

  test('a field with a line break stays in one record', () => {
    const csv = toCsv([['note'], ['first\nsecond']]);
    assert.equal(csv, 'note\r\n"first\nsecond"\r\n');
  });
});
