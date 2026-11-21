import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  DUE_WINDOW_DAYS,
  TreatmentService,
  animalsInWithdrawal,
  daysFromToday,
  dueStatus,
  filterTreatments,
  followUpDraft,
  inWithdrawal,
  productSuggestions,
  summarizeDue,
  treatmentPayload,
  validateTreatment,
} from '../../src/services/TreatmentService.js';

const TODAY = '2026-06-15';
// Local times on 15 June 2026: just after midnight and just before the next one.
const EARLY = new Date(2026, 5, 15, 0, 5, 0);
const LATE = new Date(2026, 5, 15, 23, 55, 0);

const LIST = [
  { id: '1', cattleId: 'a', cattleTag: 'CT-001', cattleName: 'Daisy Holstein', type: 'vaccination', product: 'Bovi-Shield', givenBy: 'Dr. Patel', notes: 'Annual booster', dateGiven: '2026-06-01' },
  { id: '2', cattleId: 'b', cattleTag: 'CT-002', cattleName: 'Bessie Jersey', type: 'treatment', product: 'Penicillin', givenBy: 'Sam', notes: '', dateGiven: '2026-05-01' },
  { id: '3', cattleId: 'a', cattleTag: 'CT-001', cattleName: 'Daisy Holstein', type: 'vet_visit', product: '', givenBy: '', notes: 'Lameness exam', dateGiven: '2026-04-01' },
];
const ids = (list) => list.map((t) => t.id);

const VALID = {
  dateGiven: '2026-06-10', type: 'treatment', product: 'Meloxicam', dose: '15 mL', route: 'Subcutaneous',
  givenBy: 'Dr. Patel', nextDueDate: '2026-06-20', withdrawalUntil: '2026-06-25', notes: 'Recheck',
};

function stubFetch(status, body) {
  const fetchMock = mock.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }));
  mock.method(globalThis, 'fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
});

describe('treatmentPayload', () => {
  test('trims text and keeps dates as typed', () => {
    assert.deepEqual(
      treatmentPayload({ ...VALID, product: '  Meloxicam ', givenBy: ' Dr. Patel ', notes: '  Recheck  ', dose: ' 15 mL', route: 'Subcutaneous ' }),
      VALID
    );
  });

  test('an empty form gives empty strings', () => {
    assert.deepEqual(treatmentPayload({}), {
      dateGiven: '', type: '', product: '', dose: '', route: '', givenBy: '', nextDueDate: '', withdrawalUntil: '', notes: '',
    });
  });
});

describe('validateTreatment', () => {
  test('accepts a complete treatment, and one with only a date and a type', () => {
    assert.equal(validateTreatment(VALID, TODAY), null);
    assert.equal(validateTreatment(treatmentPayload({ dateGiven: TODAY, type: 'vet_visit' }), TODAY), null);
  });

  for (const [name, fields, message] of [
    ['no date', { dateGiven: '' }, 'Enter the treatment date'],
    ['an impossible date', { dateGiven: '2026-02-30' }, 'Enter the treatment date'],
    ['a date after today', { dateGiven: '2026-06-16', nextDueDate: '', withdrawalUntil: '' }, 'The treatment date cannot be in the future'],
    ['no type', { type: '' }, 'Choose a treatment type'],
    ['an unknown type', { type: 'surgery' }, 'Choose a treatment type'],
    ['a long product', { product: 'x'.repeat(101) }, 'Product must be at most 100 characters'],
    ['a long dose', { dose: 'x'.repeat(51) }, 'Dose must be at most 50 characters'],
    ['a long route', { route: 'x'.repeat(51) }, 'Route must be at most 50 characters'],
    ['a long given-by', { givenBy: 'x'.repeat(101) }, 'Given by must be at most 100 characters'],
    ['an invalid next due date', { nextDueDate: '2026-06-31' }, 'Enter a valid next due date'],
    ['a next due date on the date given', { nextDueDate: '2026-06-10' }, 'The next due date must be after the date given'],
    ['a next due date before the date given', { nextDueDate: '2026-06-01' }, 'The next due date must be after the date given'],
    ['an invalid withdrawal date', { withdrawalUntil: 'soon' }, 'Enter a valid withdrawal date'],
    ['a withdrawal date before the date given', { withdrawalUntil: '2026-06-09' }, 'The withdrawal date cannot be before the date given'],
    ['long notes', { notes: 'x'.repeat(2001) }, 'Notes are too long'],
  ]) {
    test(`rejects ${name}`, () => {
      assert.equal(validateTreatment({ ...VALID, ...fields }, TODAY), message);
    });
  }

  test('allows today, a past next due date, and a withdrawal ending on the date given', () => {
    assert.equal(validateTreatment({ ...VALID, dateGiven: TODAY, nextDueDate: '2026-06-16', withdrawalUntil: TODAY }, TODAY), null);
    assert.equal(validateTreatment({ ...VALID, dateGiven: '2025-01-01', nextDueDate: '2025-02-01', withdrawalUntil: '' }, TODAY), null);
  });

  test("uses the browser's local date by default, late in the evening too", () => {
    mock.timers.enable({ apis: ['Date'], now: LATE });
    assert.equal(validateTreatment({ ...VALID, dateGiven: TODAY, nextDueDate: '', withdrawalUntil: '' }), null);
    assert.equal(validateTreatment({ ...VALID, dateGiven: '2026-06-16', nextDueDate: '', withdrawalUntil: '' }), 'The treatment date cannot be in the future');
  });
});

describe('filterTreatments', () => {
  test('without filters keeps everything, in order', () => {
    assert.deepEqual(ids(filterTreatments(LIST)), ['1', '2', '3']);
    assert.deepEqual(ids(filterTreatments(LIST, { query: '  ', type: 'all' })), ['1', '2', '3']);
  });

  test('matches cow number, name, product, given by and notes, ignoring case', () => {
    assert.deepEqual(ids(filterTreatments(LIST, { query: 'ct-002' })), ['2']);
    assert.deepEqual(ids(filterTreatments(LIST, { query: 'daisy' })), ['1', '3']);
    assert.deepEqual(ids(filterTreatments(LIST, { query: 'PENICILLIN' })), ['2']);
    assert.deepEqual(ids(filterTreatments(LIST, { query: 'patel' })), ['1']);
    assert.deepEqual(ids(filterTreatments(LIST, { query: 'lameness' })), ['3']);
    assert.deepEqual(ids(filterTreatments(LIST, { query: 'nothing like this' })), []);
  });

  test('filters by type, combined with the search', () => {
    assert.deepEqual(ids(filterTreatments(LIST, { type: 'vet_visit' })), ['3']);
    assert.deepEqual(ids(filterTreatments(LIST, { type: 'vaccination', query: 'bessie' })), []);
  });
});

describe('dates: days from today and due status', () => {
  test('counts calendar days, across a month end and a daylight-saving change', () => {
    assert.equal(daysFromToday('2026-06-15', TODAY), 0);
    assert.equal(daysFromToday('2026-07-01', TODAY), 16);
    assert.equal(daysFromToday('2026-06-01', TODAY), -14);
    assert.equal(daysFromToday('2026-11-02', '2026-10-31'), 2);
    assert.equal(daysFromToday('2026-03-30', '2026-03-28'), 2);
    assert.equal(daysFromToday('', TODAY), null);
    assert.equal(daysFromToday('June', TODAY), null);
  });

  test('labels overdue, today, soon and later', () => {
    assert.deepEqual(dueStatus('2026-06-12', TODAY), { state: 'overdue', days: -3, label: '3 days overdue' });
    assert.deepEqual(dueStatus('2026-06-14', TODAY), { state: 'overdue', days: -1, label: '1 day overdue' });
    assert.deepEqual(dueStatus('2026-06-15', TODAY), { state: 'today', days: 0, label: 'Due today' });
    assert.deepEqual(dueStatus('2026-06-16', TODAY), { state: 'soon', days: 1, label: 'Due tomorrow' });
    assert.deepEqual(dueStatus('2026-06-22', TODAY), { state: 'soon', days: 7, label: 'Due in 7 days' });
    assert.deepEqual(dueStatus('2026-06-23', TODAY), { state: 'later', days: 8, label: 'Due in 8 days' });
    assert.equal(dueStatus('', TODAY), null);
    assert.equal(DUE_WINDOW_DAYS, 7);
  });

  test("uses the browser's local date by default, whatever the time of day", () => {
    for (const now of [EARLY, LATE]) {
      mock.timers.enable({ apis: ['Date'], now });
      assert.equal(dueStatus('2026-06-15').state, 'today');
      assert.equal(dueStatus('2026-06-14').state, 'overdue');
      assert.equal(dueStatus('2026-06-22').state, 'soon');
      mock.timers.reset();
    }
  });
});

describe('summarizeDue', () => {
  const due = [
    { id: 'old', nextDueDate: '2026-05-01' },
    { id: 'yesterday', nextDueDate: '2026-06-14' },
    { id: 'today', nextDueDate: '2026-06-15' },
    { id: 'week', nextDueDate: '2026-06-22' },
    { id: 'later', nextDueDate: '2026-06-23' },
    { id: 'broken', nextDueDate: 'soon' },
  ];

  test('splits overdue, due within 7 days (today included) and later; scheduled counts the first two', () => {
    const s = summarizeDue(due, TODAY);
    assert.deepEqual(ids(s.overdue), ['old', 'yesterday']);
    assert.deepEqual(ids(s.upcoming), ['today', 'week']);
    assert.deepEqual(ids(s.later), ['later']);
    assert.equal(s.scheduled, 4);
  });

  test('is empty for no follow-ups', () => {
    assert.deepEqual(summarizeDue([], TODAY), { overdue: [], upcoming: [], later: [], scheduled: 0 });
  });

  test('moves along with the clock: tomorrow, today becomes overdue', () => {
    mock.timers.enable({ apis: ['Date'], now: new Date(2026, 5, 16, 9, 0, 0) });
    const s = summarizeDue(due);
    assert.deepEqual(ids(s.overdue), ['old', 'yesterday', 'today']);
    assert.deepEqual(ids(s.upcoming), ['week', 'later']);
  });
});

describe('withdrawal periods', () => {
  const herd = [
    { id: 'a', tagNumber: 'CT-10', withdrawalUntil: '2026-06-20' },
    { id: 'b', tagNumber: 'CT-2', withdrawalUntil: '2026-06-15' },
    { id: 'c', tagNumber: 'CT-3', withdrawalUntil: '2026-06-14' },
    { id: 'd', tagNumber: 'CT-4', withdrawalUntil: '' },
    { id: 'e', tagNumber: 'CT-1', withdrawalUntil: '2026-06-20' },
  ];

  test('runs up to and including its last day', () => {
    assert.equal(inWithdrawal(herd[0], TODAY), true);
    assert.equal(inWithdrawal(herd[1], TODAY), true, 'the last day still counts');
    assert.equal(inWithdrawal(herd[2], TODAY), false);
    assert.equal(inWithdrawal(herd[3], TODAY), false);
    assert.equal(inWithdrawal({ withdrawalUntil: 'later' }, TODAY), false);
    assert.equal(inWithdrawal(null, TODAY), false);
  });

  test('lists the animals in withdrawal, ending soonest first, then by number', () => {
    assert.deepEqual(ids(animalsInWithdrawal(herd, TODAY)), ['b', 'e', 'a']);
  });

  test("uses the browser's local date by default", () => {
    mock.timers.enable({ apis: ['Date'], now: LATE });
    assert.equal(inWithdrawal(herd[1]), true);
    mock.timers.reset();
    mock.timers.enable({ apis: ['Date'], now: new Date(2026, 5, 16, 0, 1, 0) });
    assert.equal(inWithdrawal(herd[1]), false);
  });
});

describe('followUpDraft and productSuggestions', () => {
  test('a follow-up repeats the animal, type, product, dose, route and person, given today', () => {
    const open = { id: 'x', cattleId: 'a', type: 'vaccination', product: 'Ultrabac 7', dose: '5 mL', route: 'Subcutaneous', givenBy: 'Sam', nextDueDate: '2026-06-10', withdrawalUntil: '2026-06-01', notes: 'Booster' };
    assert.deepEqual(followUpDraft(open, TODAY), {
      cattleId: 'a', dateGiven: TODAY, type: 'vaccination', product: 'Ultrabac 7', dose: '5 mL', route: 'Subcutaneous',
      givenBy: 'Sam', nextDueDate: '', withdrawalUntil: '', notes: '',
    });
  });

  test('suggests each product once, ignoring case, sorted', () => {
    assert.deepEqual(productSuggestions([{ product: 'Penicillin' }, { product: '' }, { product: ' penicillin ' }, { product: 'Bovi-Shield' }]), ['Bovi-Shield', 'Penicillin']);
  });
});

describe('TreatmentService requests', () => {
  let service;
  beforeEach(() => {
    service = new TreatmentService();
  });

  test('loadAll and loadDue keep what they loaded', async () => {
    const fetchMock = stubFetch(200, [{ id: '1' }]);
    assert.deepEqual(await service.loadAll(), [{ id: '1' }]);
    assert.deepEqual(service.treatments, [{ id: '1' }]);
    assert.equal(service.dueLoaded, false);
    await service.loadDue();
    assert.deepEqual(service.due, [{ id: '1' }]);
    assert.equal(service.dueLoaded, true);
    assert.deepEqual(fetchMock.mock.calls.map((c) => c.arguments[0]), ['/api/treatments', '/api/treatments/due']);
  });

  test('loadForCattle, add, update and remove send the right request', async () => {
    const fetchMock = stubFetch(200, {});
    await service.loadForCattle('a/b');
    await service.add('cow 1', VALID);
    await service.update('t?1', VALID);
    await service.remove('t1');
    const calls = fetchMock.mock.calls.map((c) => [c.arguments[0], c.arguments[1].method || 'GET', c.arguments[1].body]);
    assert.deepEqual(calls, [
      ['/api/cattle/a%2Fb/treatments', 'GET', undefined],
      ['/api/cattle/cow%201/treatments', 'POST', JSON.stringify(VALID)],
      ['/api/treatments/t%3F1', 'PUT', JSON.stringify(VALID)],
      ['/api/treatments/t1', 'DELETE', undefined],
    ]);
  });

  test('errors carry the status and the message from the server', async () => {
    stubFetch(404, { error: 'Treatment not found' });
    await assert.rejects(service.remove('x'), (err) => err.status === 404 && err.message === 'Treatment not found');
  });
});
