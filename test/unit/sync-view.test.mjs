// Offline editing (feature 14): the wording of the sync banner and the Unsynced changes dialog.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { changedFields, explainRejection, formatWhen, offlineText, opTitle, pendingText, unsyncedText } from '../../src/views/SyncView.js';

describe('banner text', () => {
  test('counts changes in the singular and plural, and says nothing for none', () => {
    assert.equal(pendingText(0), '');
    assert.equal(pendingText(1), '1 change waiting to sync.');
    assert.equal(pendingText(3), '3 changes waiting to sync.');
    assert.equal(unsyncedText(0), '');
    assert.equal(unsyncedText(1), '1 change could not be synced.');
    assert.equal(unsyncedText(2), '2 changes could not be synced.');
  });

  test('the offline notice says when the herd was saved, when that is known', () => {
    assert.match(offlineText('2026-11-21T10:03:00.000Z'), /^You're offline\. Showing the herd saved on this device \(last updated .*2026.*\)\. /);
    assert.match(offlineText(null), /^You're offline\. Showing the herd saved on this device\. You can still view, add, edit and delete cattle/);
  });

  test('formatWhen is empty for a missing or unreadable date', () => {
    assert.equal(formatWhen(null), '');
    assert.equal(formatWhen('not a date'), '');
    assert.match(formatWhen('2026-11-21T10:03:00.000Z'), /2026/);
  });
});

describe('unsynced changes', () => {
  const data = { tagNumber: 'CT-2', nameBreed: 'Bessie (field)', gender: 'female', birthDate: '', weight: null, lastCalvingDate: '', expectedCalvingDate: '', medications: '', healthStatus: 'healthy', notes: 'North pasture' };
  const current = { id: 'b', tagNumber: 'CT-2', nameBreed: 'Bessie (office)', gender: 'female', birthDate: '', weight: 700, lastCalvingDate: '2025-02-02', expectedCalvingDate: '', medications: '', healthStatus: 'pregnant', notes: '' };

  test('titles name the kind of change and the animal', () => {
    assert.equal(opTitle({ type: 'create', label: 'CT-9 New' }), 'New animal CT-9 New');
    assert.equal(opTitle({ type: 'edit', label: 'CT-2 Bessie' }), 'Edit of CT-2 Bessie');
    assert.equal(opTitle({ type: 'delete', label: 'CT-2 Bessie' }), 'Delete of CT-2 Bessie');
    assert.equal(opTitle({ type: 'delete', label: '' }), 'Delete of an animal');
  });

  test('an edit refused as a conflict lists only the fields that differ from the server', () => {
    const rows = changedFields({ op: { type: 'edit', data }, current });
    assert.deepEqual(rows, [
      { label: 'Name / breed', yours: 'Bessie (field)', server: 'Bessie (office)' },
      { label: 'Status', yours: 'Healthy', server: 'Pregnant' },
      { label: 'Notes', yours: 'North pasture', server: '' },
    ]);
  });

  test('a blank weight in an edit is "no change", and the same weight is not a difference', () => {
    assert.equal(changedFields({ op: { type: 'edit', data }, current }).some((r) => r.label === 'Weight (lbs)'), false);
    const same = changedFields({ op: { type: 'edit', data: { ...data, weight: 700 } }, current: { ...current, weight: '700.00' } });
    assert.equal(same.some((r) => r.label === 'Weight (lbs)'), false);
    const differs = changedFields({ op: { type: 'edit', data: { ...data, weight: 750 } }, current });
    assert.deepEqual(differs.find((r) => r.label === 'Weight (lbs)'), { label: 'Weight (lbs)', yours: '750', server: '700' });
  });

  test('without a server version, every value the user entered is listed', () => {
    const rows = changedFields({ op: { type: 'create', data: { ...data, weight: 410, lastCalvingDate: '2025-01-01' } }, current: null });
    assert.deepEqual(rows.map((r) => [r.label, r.yours, r.server]), [
      ['Cow number', 'CT-2', null],
      ['Name / breed', 'Bessie (field)', null],
      ['Gender', 'Female', null],
      ['Weight (lbs)', '410', null],
      ['Last calving', '2025-01-01', null],
      ['Status', 'Healthy', null],
      ['Notes', 'North pasture', null],
    ]);
  });

  test('a delete has no fields', () => {
    assert.deepEqual(changedFields({ op: { type: 'delete', data: null }, current }), []);
  });

  test('reasons are put in the user\'s terms', () => {
    assert.match(explainRejection({ op: { type: 'edit' }, code: 'stale', status: 409 }), /changed somewhere else after you made this change/);
    assert.match(explainRejection({ op: { type: 'delete' }, code: 'stale', status: 409 }), /so it was not deleted/);
    assert.match(explainRejection({ op: { type: 'edit' }, status: 404, reason: 'Cattle not found' }), /deleted somewhere else/);
    assert.equal(explainRejection({ op: { type: 'create' }, status: 409, reason: 'Duplicate cow number' }), 'Another animal already has this cow number.');
    assert.match(explainRejection({ op: { type: 'edit' }, code: 'dependent' }), /earlier change to this animal/);
    assert.equal(explainRejection({ op: { type: 'create' }, status: 403, reason: 'Demo accounts are limited to 25 animals.' }), 'Demo accounts are limited to 25 animals.');
    assert.equal(explainRejection({ op: { type: 'create' } }), 'The server did not accept this change.');
  });
});
