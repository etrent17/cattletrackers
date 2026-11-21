// Offline editing (feature 14): the outbox and its replay, with an in-memory store and a
// stand-in for the server. No browser, no network.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, emptyState } from '../../src/services/OfflineStore.js';
import {
  SyncEngine, applyOutbox, sameAsRequested, newUuid, isUnreachable, DEPENDENT_REASON, MAX_SERVER_ERROR_TRIES,
} from '../../src/services/SyncEngine.js';
import { CattleService } from '../../src/services/CattleService.js';

const fail = (status, message, data) => Object.assign(new Error(message), { status, data: data ?? { error: message } });

// A stand-in for /api/cattle with the rules that matter to replay: client ids, duplicate cow
// numbers, expectedUpdatedAt. `down(n)` makes the next n requests fail without an answer;
// `failing(n, status)` makes them fail with that status.
function fakeServer(initial = []) {
  let clock = 0;
  const stamp = () => `2026-11-21T10:00:${String(++clock).padStart(2, '0')}.000Z`;
  const server = {
    rows: new Map(initial.map((r) => [r.id, { ...r }])),
    calls: [],
    weighings: [],
    outage: 0,
    outageStatus: 0,
    down(n = Infinity) { this.outage = n; this.outageStatus = 0; },
    failing(n, status) { this.outage = n; this.outageStatus = status; },
    up() { this.outage = 0; },
    // Changes a row the way another device would.
    touch(id, fields) {
      const row = { ...this.rows.get(id), ...fields, updatedAt: stamp() };
      this.rows.set(id, row);
      return row;
    },
    request: async (path, options = {}) => {
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      const url = new URL(path, 'http://x');
      server.calls.push({ method, path, body });
      if (server.outage > 0) {
        server.outage -= 1;
        if (server.outageStatus === 0) throw fail(0, "Can't reach the server.", null);
        throw fail(server.outageStatus, 'Internal server error');
      }
      const id = url.pathname.split('/')[3];
      const duplicate = (tag, exceptId) => [...server.rows.values()]
        .some((r) => r.id !== exceptId && r.tagNumber.toLowerCase() === String(tag).toLowerCase());
      if (method === 'POST') {
        if (server.rows.has(body.id)) return server.rows.get(body.id);
        if (duplicate(body.tagNumber)) throw fail(409, 'Duplicate cow number');
        const { weightDate, ...fields } = body;
        const row = { nameBreed: '', notes: '', ...fields, createdAt: stamp(), updatedAt: stamp() };
        if (row.weight != null) server.weighings.push({ cattleId: row.id, date: weightDate, weight: row.weight });
        server.rows.set(row.id, row);
        return row;
      }
      const current = server.rows.get(id);
      const expected = method === 'PUT' ? body.expectedUpdatedAt : url.searchParams.get('expectedUpdatedAt');
      if (!current) throw fail(404, 'Cattle not found');
      if (expected && expected !== current.updatedAt) {
        throw fail(409, 'This record was changed after you last loaded it. Your change was not saved.', { code: 'stale', current });
      }
      if (method === 'DELETE') {
        server.rows.delete(id);
        return { ok: true };
      }
      if (duplicate(body.tagNumber, id)) throw fail(409, 'Duplicate cow number');
      const { weightDate, expectedUpdatedAt, weight, ...fields } = body;
      const row = { ...current, ...fields, updatedAt: stamp() };
      if (weight != null && weight !== current.weight) {
        row.weight = weight;
        server.weighings.push({ cattleId: id, date: weightDate, weight });
      }
      server.rows.set(id, row);
      return row;
    },
  };
  return server;
}

const DAISY = { id: 'a', tagNumber: 'CT-001', nameBreed: 'Daisy', gender: 'female', weight: 800, healthStatus: 'healthy', notes: '', updatedAt: '2026-11-01T08:00:00.000Z' };
const BESSIE = { id: 'b', tagNumber: 'CT-002', nameBreed: 'Bessie', gender: 'female', weight: null, healthStatus: 'healthy', notes: '', updatedAt: '2026-11-02T08:00:00.000Z' };

// An engine over a persistent in-memory store whose herd copy matches the server.
function setup({ herd = [DAISY, BESSIE], online = true } = {}) {
  const server = fakeServer(herd);
  const store = new MemoryStore({ ...emptyState(), user: { id: 1 }, herd, herdSavedAt: '2026-11-20T00:00:00.000Z' });
  store.persistent = true;
  let day = '2026-11-18';
  let ids = 0;
  const env = { online };
  const engine = new SyncEngine({
    store,
    request: server.request,
    today: () => day,
    now: () => `${day}T12:00:00.000Z`,
    newId: () => `new-${++ids}`,
    locks: null,
    isOnline: () => env.online,
  });
  return { server, store, engine, env, setDay: (d) => { day = d; } };
}

const sent = (server) => server.calls.map((c) => `${c.method} ${c.path}`);
const edit = (fields) => ({ tagNumber: DAISY.tagNumber, nameBreed: DAISY.nameBreed, gender: 'female', healthStatus: 'healthy', notes: '', weight: null, ...fields });

describe('applyOutbox', () => {
  const op = (type, cattleId, data = null) => ({ type, cattleId, data, queuedAt: '2026-11-18T12:00:00.000Z' });

  test('adds, changes and removes rows without touching the saved herd', () => {
    const herd = [DAISY, BESSIE];
    const rows = applyOutbox(herd, [
      op('create', 'n1', { tagNumber: 'CT-9', nameBreed: 'New', gender: 'male', lastCalvingDate: '2025-01-01', weight: 300 }),
      op('edit', 'a', edit({ nameBreed: 'Daisy II', weight: 850 })),
      op('delete', 'b'),
    ]);
    assert.deepEqual(rows.map((r) => r.id), ['n1', 'a']);
    assert.equal(rows[0].pendingSync, true);
    assert.equal(rows[0].weight, 300);
    assert.equal(rows[0].lastCalvingDate, '', 'a male has no last calving date');
    assert.equal(rows[1].nameBreed, 'Daisy II');
    assert.equal(rows[1].weight, 850);
    assert.equal(rows[1].pendingSync, true);
    assert.equal(herd[0].nameBreed, 'Daisy');
    assert.equal(herd.length, 2);
  });

  test('a blank weight in an edit keeps the current weight, as the server does', () => {
    const [row] = applyOutbox([DAISY], [op('edit', 'a', edit({ weight: null, notes: 'x' }))]);
    assert.equal(row.weight, 800);
    assert.equal(row.notes, 'x');
  });

  test('later changes apply on top of earlier ones', () => {
    const rows = applyOutbox([], [
      op('create', 'n1', { tagNumber: 'CT-9', nameBreed: 'New' }),
      op('edit', 'n1', { tagNumber: 'CT-9', nameBreed: 'Renamed' }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].nameBreed, 'Renamed');
  });

  test('a queued create whose row is already in the herd is not shown twice', () => {
    const rows = applyOutbox([{ ...DAISY, id: 'n1' }], [op('create', 'n1', { tagNumber: 'CT-001' })]);
    assert.equal(rows.length, 1);
  });

  test('an edit of a row that is gone is ignored', () => {
    assert.deepEqual(applyOutbox([], [op('edit', 'a', edit({}))]), []);
  });
});

describe('enqueue', () => {
  test('remembers the version the change was made on, and the day it was made', async () => {
    const { engine, store } = setup();
    const op = await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'lame' }) });
    assert.equal(op.expectedUpdatedAt, DAISY.updatedAt);
    assert.equal(op.weightDate, '2026-11-18');
    assert.equal(op.label, 'CT-001 Daisy');
    assert.deepEqual((await store.read()).outbox.map((o) => o.seq), [op.seq]);
  });

  test('a delete is labelled from the saved row', async () => {
    const { engine } = setup();
    const op = await engine.enqueue({ type: 'delete', cattleId: 'b' });
    assert.equal(op.label, 'CT-002 Bessie');
    assert.equal(op.expectedUpdatedAt, BESSIE.updatedAt);
  });

  test('deleting an animal that was added here and never sent cancels the whole thing', async () => {
    const { engine, store, server } = setup();
    await engine.enqueue({ type: 'create', cattleId: 'n1', data: { tagNumber: 'CT-9' } });
    await engine.enqueue({ type: 'edit', cattleId: 'n1', data: { tagNumber: 'CT-9', notes: 'x' } });
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'keep me' }) });
    assert.equal(await engine.enqueue({ type: 'delete', cattleId: 'n1' }), null);
    assert.deepEqual((await store.read()).outbox.map((o) => o.cattleId), ['a']);
    await engine.replay();
    assert.deepEqual(sent(server), ['PUT /api/cattle/a']);
  });

  test('once the create may have reached the server, the delete is queued behind it', async () => {
    const { engine, store, server } = setup();
    await engine.enqueue({ type: 'create', cattleId: 'n1', data: { tagNumber: 'CT-9' } });
    server.down(1);
    await engine.replay(); // sent once, no answer
    const op = await engine.enqueue({ type: 'delete', cattleId: 'n1' });
    assert.equal(op.type, 'delete');
    assert.deepEqual((await store.read()).outbox.map((o) => o.type), ['create', 'delete']);
    await engine.replay();
    assert.equal(server.rows.has('n1'), false);
    assert.deepEqual((await store.read()).outbox, []);
  });

  test('a store that cannot keep data refuses to queue', async () => {
    const engine = new SyncEngine({ store: new MemoryStore(), request: async () => ({}), locks: null });
    assert.equal(await engine.mustQueue(), false);
    await assert.rejects(engine.enqueue({ type: 'delete', cattleId: 'a' }), /can't keep changes offline/);
  });

  test('mustQueue: offline, or older changes waiting', async () => {
    const { engine, env } = setup();
    assert.equal(await engine.mustQueue(), false);
    env.online = false;
    assert.equal(await engine.mustQueue(), true);
    env.online = true;
    await engine.enqueue({ type: 'delete', cattleId: 'b' });
    assert.equal(await engine.mustQueue(), true);
  });
});

describe('replay', () => {
  test('sends the changes oldest first and empties the outbox', async () => {
    const { engine, store, server } = setup();
    await engine.enqueue({ type: 'create', cattleId: 'n1', data: { tagNumber: 'CT-9', nameBreed: 'New' } });
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'lame' }) });
    await engine.enqueue({ type: 'delete', cattleId: 'b' });

    const summary = await engine.replay();
    assert.deepEqual(summary, { synced: 3, rejected: 0, stopped: null, remaining: 0 });
    assert.deepEqual(sent(server), [
      'POST /api/cattle',
      'PUT /api/cattle/a',
      `DELETE /api/cattle/b?expectedUpdatedAt=${encodeURIComponent(BESSIE.updatedAt)}`,
    ]);
    assert.equal(server.calls[0].body.id, 'n1');
    assert.equal(server.calls[1].body.expectedUpdatedAt, DAISY.updatedAt);

    const state = await store.read();
    assert.deepEqual(state.outbox, []);
    assert.deepEqual(state.unsynced, []);
    // the saved herd now holds the server's rows
    assert.deepEqual(state.herd.map((r) => r.id), ['n1', 'a']);
    assert.deepEqual(state.herd.find((r) => r.id === 'a'), server.rows.get('a'));
  });

  test('a weight is dated the day the change was made, not the day it synced', async () => {
    const { engine, server, setDay } = setup();
    setDay('2026-11-10');
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ weight: 865 }) });
    setDay('2026-11-12');
    await engine.enqueue({ type: 'create', cattleId: 'n1', data: { tagNumber: 'CT-9', weight: 410 } });
    setDay('2026-11-21'); // back in range
    await engine.replay();
    assert.deepEqual(server.calls.map((c) => c.body.weightDate), ['2026-11-10', '2026-11-12']);
    assert.deepEqual(server.weighings, [
      { cattleId: 'a', date: '2026-11-10', weight: 865 },
      { cattleId: 'n1', date: '2026-11-12', weight: 410 },
    ]);
  });

  test('an edit made after an offline create is rebased onto the created row', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'create', cattleId: 'n1', data: { tagNumber: 'CT-9', nameBreed: 'New' } });
    const second = await engine.enqueue({ type: 'edit', cattleId: 'n1', data: { tagNumber: 'CT-9', nameBreed: 'Renamed' } });
    assert.equal(second.expectedUpdatedAt, null);
    const summary = await engine.replay();
    assert.equal(summary.synced, 2);
    const created = server.calls[0];
    assert.equal(created.method, 'POST');
    assert.ok(server.calls[1].body.expectedUpdatedAt, 'the edit carries the version the create returned');
    assert.equal(server.rows.get('n1').nameBreed, 'Renamed');
    assert.deepEqual((await store.read()).unsynced, []);
  });

  test('two edits of one animal both apply, the second on top of the first', async () => {
    const { engine, server } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'first' }) });
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'second' }) });
    const summary = await engine.replay();
    assert.deepEqual([summary.synced, summary.rejected], [2, 0]);
    assert.equal(server.rows.get('a').notes, 'second');
  });

  test('a conflict keeps the server version and moves the change to the unsynced list', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ nameBreed: 'Offline name', weight: 900 }) });
    await engine.enqueue({ type: 'edit', cattleId: 'b', data: { ...edit({}), tagNumber: 'CT-002', nameBreed: 'Bessie B' } });
    const theirs = server.touch('a', { nameBreed: 'Online name' });

    const summary = await engine.replay();
    assert.deepEqual(summary, { synced: 1, rejected: 1, stopped: null, remaining: 0 });

    // the server version stands
    assert.equal(server.rows.get('a').nameBreed, 'Online name');
    assert.equal(server.rows.get('a').weight, 800);
    assert.deepEqual(server.weighings, []);
    // the other animal's change still went through
    assert.equal(server.rows.get('b').nameBreed, 'Bessie B');

    const state = await store.read();
    assert.deepEqual(state.outbox, []);
    assert.equal(state.unsynced.length, 1);
    const [item] = state.unsynced;
    assert.equal(item.op.cattleId, 'a');
    assert.equal(item.op.data.nameBreed, 'Offline name', "the user's values are kept");
    assert.equal(item.op.data.weight, 900);
    assert.equal(item.status, 409);
    assert.equal(item.code, 'stale');
    assert.deepEqual(item.current, theirs);
    // and the list shows the server version
    assert.deepEqual(applyOutbox(state.herd, state.outbox).find((r) => r.id === 'a'), theirs);
  });

  test('changes made on top of a refused change go to the unsynced list with it', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'create', cattleId: 'n1', data: { tagNumber: 'ct-001', nameBreed: 'Clash' } }); // duplicate number
    await engine.enqueue({ type: 'edit', cattleId: 'n1', data: { tagNumber: 'ct-001', nameBreed: 'Clash, edited' } });
    await engine.enqueue({ type: 'delete', cattleId: 'b' });

    const summary = await engine.replay();
    assert.deepEqual(summary, { synced: 1, rejected: 2, stopped: null, remaining: 0 });
    assert.deepEqual(sent(server).map((s) => s.split('?')[0]), ['POST /api/cattle', 'DELETE /api/cattle/b'], 'the dependent edit is never sent');

    const state = await store.read();
    assert.deepEqual(state.unsynced.map((i) => [i.op.type, i.reason, i.code]), [
      ['create', 'Duplicate cow number', null],
      ['edit', DEPENDENT_REASON, 'dependent'],
    ]);
    assert.equal(state.unsynced[1].op.data.nameBreed, 'Clash, edited');
    assert.equal(server.rows.has('n1'), false);
  });

  test('an edit of an animal deleted elsewhere is kept as unsynced and the animal leaves the list', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'offline note' }) });
    server.rows.delete('a');
    const summary = await engine.replay();
    assert.equal(summary.rejected, 1);
    const state = await store.read();
    assert.equal(state.unsynced[0].status, 404);
    assert.equal(state.unsynced[0].op.data.notes, 'offline note');
    assert.deepEqual(state.herd.map((r) => r.id), ['b']);
  });

  test('a delete of an animal changed elsewhere is refused and the animal stays', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'delete', cattleId: 'a' });
    const theirs = server.touch('a', { notes: 'treated today' });
    const summary = await engine.replay();
    assert.equal(summary.rejected, 1);
    assert.equal(server.rows.has('a'), true);
    const state = await store.read();
    assert.equal(state.unsynced[0].op.type, 'delete');
    assert.deepEqual(applyOutbox(state.herd, state.outbox).find((r) => r.id === 'a'), theirs);
  });

  test('a delete of an animal that is already gone counts as done', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'delete', cattleId: 'a' });
    server.rows.delete('a');
    const summary = await engine.replay();
    assert.deepEqual([summary.synced, summary.rejected], [1, 0]);
    assert.deepEqual((await store.read()).unsynced, []);
  });

  test('no connection: replay stops, keeps everything in order, and a later replay sends it all', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'one' }) });
    await engine.enqueue({ type: 'create', cattleId: 'n1', data: { tagNumber: 'CT-9' } });
    await engine.enqueue({ type: 'delete', cattleId: 'b' });

    server.down();
    for (let i = 0; i < 5; i += 1) {
      const summary = await engine.replay();
      assert.deepEqual(summary, { synced: 0, rejected: 0, stopped: 'unreachable', remaining: 3 });
    }
    let state = await store.read();
    assert.deepEqual(state.outbox.map((o) => o.type), ['edit', 'create', 'delete']);
    assert.deepEqual(state.unsynced, []);
    assert.equal(server.calls.length, 5, 'one attempt per replay: it stops at the first op');

    server.up();
    server.calls.length = 0;
    const summary = await engine.replay();
    assert.deepEqual(summary, { synced: 3, rejected: 0, stopped: null, remaining: 0 });
    assert.deepEqual(sent(server).map((s) => s.split('?')[0]), ['PUT /api/cattle/a', 'POST /api/cattle', 'DELETE /api/cattle/b']);
    state = await store.read();
    assert.deepEqual(state.outbox, []);
  });

  test('the connection drops midway: what was sent is done, the rest waits', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'one' }) });
    await engine.enqueue({ type: 'edit', cattleId: 'b', data: { ...edit({}), tagNumber: 'CT-002', nameBreed: 'Bessie', notes: 'two' } });
    const real = server.request;
    let n = 0;
    engine.request = async (...args) => {
      n += 1;
      if (n === 2) throw fail(0, "Can't reach the server.", null);
      return real(...args);
    };
    const summary = await engine.replay();
    assert.deepEqual(summary, { synced: 1, rejected: 0, stopped: 'unreachable', remaining: 1 });
    assert.deepEqual((await store.read()).outbox.map((o) => o.cattleId), ['b']);
    assert.deepEqual((await engine.replay()), { synced: 1, rejected: 0, stopped: null, remaining: 0 });
    assert.equal(server.rows.get('b').notes, 'two');
  });

  for (const status of [401, 408, 429, 502, 503, 504]) {
    test(`a ${status} answer is retried later, not treated as a refusal`, async () => {
      const { engine, server, store } = setup();
      await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'x' }) });
      server.failing(1, status);
      const summary = await engine.replay();
      assert.equal(summary.stopped, 'unreachable');
      assert.equal((await store.read()).outbox.length, 1);
      assert.equal((await engine.replay()).synced, 1);
    });
  }

  test('an edit that got through before its answer was lost is recognised on the retry', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'saved once', weight: 820 }) });
    const real = server.request;
    let first = true;
    engine.request = async (...args) => {
      const result = await real(...args); // the server applies it
      if (first) {
        first = false;
        throw fail(0, "Can't reach the server.", null); // but the answer never arrives
      }
      return result;
    };
    assert.equal((await engine.replay()).stopped, 'unreachable');
    const summary = await engine.replay(); // same expectedUpdatedAt again: the server says "changed"
    assert.deepEqual(summary, { synced: 1, rejected: 0, stopped: null, remaining: 0 });
    const state = await store.read();
    assert.deepEqual(state.unsynced, []);
    assert.equal(state.herd.find((r) => r.id === 'a').notes, 'saved once');
    assert.equal(server.weighings.length, 1, 'the weight was recorded once');
  });

  test('a create that got through before its answer was lost is not created twice', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'create', cattleId: 'n1', data: { tagNumber: 'CT-9', weight: 400 } });
    const real = server.request;
    let first = true;
    engine.request = async (...args) => {
      const result = await real(...args);
      if (first) {
        first = false;
        throw fail(0, "Can't reach the server.", null);
      }
      return result;
    };
    await engine.replay();
    assert.equal((await engine.replay()).synced, 1);
    assert.equal(server.rows.size, 3);
    assert.equal(server.weighings.length, 1);
    assert.deepEqual((await store.read()).unsynced, []);
  });

  test(`a server error is retried, then set aside after ${MAX_SERVER_ERROR_TRIES} tries so the queue moves on`, async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'poison' }) });
    await engine.enqueue({ type: 'delete', cattleId: 'b' });
    server.failing(MAX_SERVER_ERROR_TRIES, 500);

    for (let i = 1; i < MAX_SERVER_ERROR_TRIES; i += 1) {
      const summary = await engine.replay();
      assert.deepEqual(summary, { synced: 0, rejected: 0, stopped: 'error', remaining: 2 });
    }
    const summary = await engine.replay();
    assert.deepEqual(summary, { synced: 1, rejected: 1, stopped: null, remaining: 0 });
    const state = await store.read();
    assert.equal(state.unsynced.length, 1);
    assert.equal(state.unsynced[0].status, 500);
    assert.equal(state.unsynced[0].op.data.notes, 'poison');
    assert.equal(server.rows.has('b'), false);
  });

  test('failed attempts while offline do not count towards the server-error limit', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'x' }) });
    server.down(10);
    for (let i = 0; i < 10; i += 1) await engine.replay();
    server.failing(1, 500);
    assert.equal((await engine.replay()).stopped, 'error');
    assert.equal((await store.read()).unsynced.length, 0);
    assert.equal((await engine.replay()).synced, 1);
  });

  test('every change ends up in exactly one place: accepted, waiting, or unsynced', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'conflict me' }) });
    await engine.enqueue({ type: 'create', cattleId: 'n1', data: { tagNumber: 'CT-002' } }); // duplicate
    await engine.enqueue({ type: 'create', cattleId: 'n2', data: { tagNumber: 'CT-10' } });
    await engine.enqueue({ type: 'edit', cattleId: 'b', data: { ...edit({}), tagNumber: 'CT-002', nameBreed: 'B', notes: 'ok' } });
    server.touch('a', { notes: 'theirs' });
    const queued = (await store.read()).outbox.map((o) => o.seq);

    const real = server.request;
    let n = 0;
    engine.request = async (...args) => {
      n += 1;
      if (n === 4) throw fail(0, "Can't reach the server.", null);
      return real(...args);
    };
    const summary = await engine.replay();
    const state = await store.read();
    const waiting = state.outbox.map((o) => o.seq);
    const unsynced = state.unsynced.map((i) => i.op.seq);
    assert.deepEqual(summary, { synced: 1, rejected: 2, stopped: 'unreachable', remaining: 1 });
    assert.deepEqual([...unsynced, ...waiting].sort(), queued.filter((s) => s !== queued[2]).sort());
    assert.equal(server.rows.has('n2'), true);
  });

  test('calls made while a replay is running share it', async () => {
    const { engine, server } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'x' }) });
    const [one, two] = await Promise.all([engine.replay(), engine.replay()]);
    assert.equal(one, two);
    assert.equal(server.calls.length, 1);
  });

  test('when another tab holds the lock, nothing is sent', async () => {
    const { engine, server } = setup();
    engine.locks = { request: async (name, options, fn) => fn(null) };
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'x' }) });
    assert.deepEqual(await engine.replay(), { synced: 0, rejected: 0, stopped: 'busy', remaining: 1 });
    assert.equal(server.calls.length, 0);
  });

  test('a store failure during replay is reported, not thrown, and loses nothing', async () => {
    const { engine, store } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'x' }) });
    const update = store.update.bind(store);
    store.update = async () => { throw new Error('quota'); };
    mock.method(console, 'error', () => {});
    const summary = await engine.replay();
    assert.equal(summary.stopped, 'error');
    store.update = update;
    assert.equal((await store.read()).outbox.length, 1);
  });

  test('listeners hear about every change to the queue', async () => {
    const { engine } = setup();
    let calls = 0;
    const off = engine.onChange(() => { calls += 1; });
    await engine.enqueue({ type: 'delete', cattleId: 'a' });
    assert.equal(calls, 1);
    await engine.replay();
    assert.equal(calls, 2);
    off();
    await engine.enqueue({ type: 'delete', cattleId: 'b' });
    assert.equal(calls, 2);
  });
});

afterEach(() => mock.restoreAll());

describe('unsynced list and accounts', () => {
  test('discarding removes only that entry', async () => {
    const { engine, server, store } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'x' }) });
    await engine.enqueue({ type: 'delete', cattleId: 'b' });
    server.touch('a', {});
    server.touch('b', {});
    await engine.replay();
    const [first, second] = (await store.read()).unsynced;
    await engine.discardUnsynced(first.key);
    assert.deepEqual((await store.read()).unsynced.map((i) => i.key), [second.key]);
  });

  test('the same account keeps its copy; a different account gets a clean one', async () => {
    const { engine, store } = setup();
    await engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'x' }) });
    assert.equal(await engine.setUser({ id: 1, email: 'a@example.com', role: 'user' }), 0);
    assert.equal((await store.read()).outbox.length, 1);
    assert.equal((await store.read()).herd.length, 2);

    assert.equal(await engine.setUser({ id: 2, email: 'b@example.com', role: 'user' }), 1);
    const state = await store.read();
    assert.deepEqual([state.herd, state.outbox, state.unsynced, state.herdSavedAt], [[], [], [], null]);
    assert.deepEqual(state.user, { id: 2, email: 'b@example.com', role: 'user', isDemo: false });
  });

  test('clear empties everything', async () => {
    const { engine, store } = setup();
    await engine.enqueue({ type: 'delete', cattleId: 'a' });
    await engine.clear();
    assert.deepEqual(await store.read(), emptyState());
  });
});

describe('whose session it is', () => {
  const queued = async (whoAmI) => {
    const ctx = setup();
    ctx.engine.whoAmI = whoAmI;
    await ctx.engine.enqueue({ type: 'edit', cattleId: 'a', data: edit({ notes: 'mine' }) });
    return ctx;
  };

  test('the same account: the outbox is sent', async () => {
    const { engine } = await queued(async () => 1);
    assert.deepEqual(await engine.replay(), { synced: 1, rejected: 0, stopped: null, remaining: 0 });
  });

  test('a different account is signed in: nothing is sent, nothing is dropped', async () => {
    const { engine, server, store } = await queued(async () => 2);
    assert.deepEqual(await engine.replay(), { synced: 0, rejected: 0, stopped: 'account', remaining: 1 });
    assert.equal(server.calls.length, 0);
    assert.equal((await store.read()).outbox.length, 1);
  });

  test('nobody is signed in: nothing is sent, nothing is dropped', async () => {
    const { engine, server, store } = await queued(async () => null);
    assert.deepEqual(await engine.replay(), { synced: 0, rejected: 0, stopped: 'signed-out', remaining: 1 });
    assert.equal(server.calls.length, 0);
    assert.equal((await store.read()).outbox.length, 1);
  });

  test('the check itself cannot reach the server: try again later', async () => {
    const { engine, server } = await queued(async () => { throw fail(0, 'offline', null); });
    assert.equal((await engine.replay()).stopped, 'unreachable');
    engine.whoAmI = async () => { throw fail(500, 'boom'); };
    assert.equal((await engine.replay()).stopped, 'error');
    assert.equal(server.calls.length, 0);
  });

  test('with an empty outbox nobody is asked', async () => {
    const ctx = setup();
    let asked = 0;
    ctx.engine.whoAmI = async () => { asked += 1; return 1; };
    await ctx.engine.replay();
    assert.equal(asked, 0);
  });
});

describe('helpers', () => {
  test('sameAsRequested compares what an edit writes', () => {
    const current = { ...DAISY, notes: null, medications: '' };
    assert.equal(sameAsRequested(edit({}), current), true);
    assert.equal(sameAsRequested(edit({ weight: 800 }), current), true);
    assert.equal(sameAsRequested(edit({ weight: '800.00' }), current), true);
    assert.equal(sameAsRequested(edit({ weight: 801 }), current), false);
    assert.equal(sameAsRequested(edit({ notes: 'x' }), current), false);
    assert.equal(sameAsRequested(edit({ healthStatus: '' }), current), true, 'a blank status is saved as healthy');
    assert.equal(sameAsRequested(edit({}), null), false);
  });

  test('isUnreachable: no answer or a gateway error', () => {
    for (const status of [0, 502, 503, 504]) assert.equal(isUnreachable({ status }), true);
    for (const status of [400, 401, 404, 409, 500]) assert.equal(isUnreachable({ status }), false);
    assert.equal(isUnreachable(null), false);
  });

  test('newUuid makes version 4 UUIDs, also without crypto.randomUUID', () => {
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    assert.match(newUuid(), v4);
    const plainHttp = { getRandomValues: (a) => globalThis.crypto.getRandomValues(a) };
    const ids = new Set(Array.from({ length: 50 }, () => newUuid(plainHttp)));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, v4);
  });
});

// CattleService with a sync engine: where a change goes, and what the list shows.
describe('CattleService with the outbox', () => {
  let ctx;
  let service;

  // Routes the service's fetch calls to the fake server.
  function connect(server) {
    mock.method(globalThis, 'fetch', async (path, options = {}) => {
      try {
        const body = await server.request(path, options);
        return { status: 200, ok: true, json: async () => body };
      } catch (err) {
        if (err.status === 0) throw new TypeError('Failed to fetch');
        return { status: err.status, ok: false, json: async () => err.data };
      }
    });
  }

  beforeEach(async () => {
    ctx = setup();
    connect(ctx.server);
    // GET /api/cattle for the fake server
    const request = ctx.server.request;
    ctx.server.request = async (path, options = {}) => {
      if (path === '/api/cattle' && (!options.method || options.method === 'GET')) {
        ctx.server.calls.push({ method: 'GET', path });
        if (ctx.server.outage > 0) {
          ctx.server.outage -= 1;
          throw fail(0, "Can't reach the server.", null);
        }
        return [...ctx.server.rows.values()];
      }
      return request(path, options);
    };
    service = new CattleService({ sync: ctx.engine });
    await service.loadData();
  });

  const form = (fields) => ({ tagNumber: 'CT-9', nameBreed: 'New', gender: '', birthDate: '', weight: '', lastCalvingDate: '', expectedCalvingDate: '', medications: '', healthStatus: 'healthy', notes: '', ...fields });

  test('online: a new animal goes straight to the server with a client id and is saved here', async () => {
    const cow = await service.addCattle(form({ weight: '500' }));
    assert.equal(service.lastQueued, false);
    assert.equal(cow.id, 'new-1');
    assert.equal(cow.pendingSync, false);
    assert.equal(ctx.server.rows.get('new-1').weight, 500);
    const state = await ctx.store.read();
    assert.deepEqual(state.outbox, []);
    assert.equal(state.herd[0].id, 'new-1');
    assert.equal(service.getAllCattle()[0].id, 'new-1');
  });

  test('online: an edit carries no expectedUpdatedAt, as before', async () => {
    await service.updateCattle('a', form({ tagNumber: 'CT-001', nameBreed: 'Daisy II' }));
    const put = ctx.server.calls.find((c) => c.method === 'PUT');
    assert.equal('expectedUpdatedAt' in put.body, false);
    assert.equal(service.getCattleById('a').nameBreed, 'Daisy II');
    assert.equal((await ctx.store.read()).herd.find((r) => r.id === 'a').nameBreed, 'Daisy II');
  });

  test('offline: add, edit and delete are queued and shown at once', async () => {
    ctx.env.online = false;
    ctx.server.down();
    const calls = ctx.server.calls.length;
    let queued = 0;
    service.onQueued = () => { queued += 1; };

    const cow = await service.addCattle(form({ tagNumber: 'CT-9' }));
    assert.equal(service.lastQueued, true);
    assert.equal(cow.pendingSync, true);
    await service.updateCattle('a', form({ tagNumber: 'CT-001', nameBreed: 'Daisy II', weight: '830' }));
    await service.deleteCattle('b');

    assert.equal(ctx.server.calls.length, calls, 'nothing is sent while offline');
    assert.equal(queued, 3);
    assert.deepEqual(service.getAllCattle().map((c) => c.id), ['new-1', 'a']);
    assert.equal(service.getCattleById('a').nameBreed, 'Daisy II');
    assert.equal(service.getCattleById('a').weight, 830);
    assert.equal(service.getCattleById('a').pendingSync, true);
    assert.equal(service.isDuplicateTag('CT-9'), true, 'the queued animal counts for the duplicate check');

    // a reload of the page while still offline shows the same list
    const reloaded = new CattleService({ sync: ctx.engine });
    await reloaded.loadData();
    assert.equal(reloaded.fromCache, true);
    assert.deepEqual(reloaded.getAllCattle().map((c) => c.id), ['new-1', 'a']);

    // back online
    ctx.env.online = true;
    ctx.server.up();
    const summary = await ctx.engine.replay();
    assert.deepEqual([summary.synced, summary.rejected, summary.remaining], [3, 0, 0]);
    await service.loadData();
    assert.equal(service.fromCache, false);
    assert.deepEqual(service.getAllCattle().map((c) => c.id).sort(), ['a', 'new-1']);
    assert.equal(service.getAllCattle().some((c) => c.pendingSync), false);
    assert.deepEqual(ctx.server.weighings, [{ cattleId: 'a', date: '2026-11-18', weight: 830 }]);
  });

  test('the connection drops during a save: the change is queued, not lost', async () => {
    ctx.server.down(1);
    await service.updateCattle('a', form({ tagNumber: 'CT-001', nameBreed: 'Daisy II' }));
    assert.equal(service.lastQueued, true);
    const [op] = (await ctx.store.read()).outbox;
    assert.equal(op.type, 'edit');
    assert.equal(op.expectedUpdatedAt, DAISY.updatedAt);
    assert.equal(service.getCattleById('a').nameBreed, 'Daisy II');
    await ctx.engine.replay();
    assert.equal(ctx.server.rows.get('a').nameBreed, 'Daisy II');
  });

  test('while older changes wait, a new change queues behind them even when online', async () => {
    await ctx.engine.enqueue({ type: 'delete', cattleId: 'b' });
    const calls = ctx.server.calls.length;
    await service.updateCattle('a', form({ tagNumber: 'CT-001', nameBreed: 'Daisy II' }));
    assert.equal(service.lastQueued, true);
    assert.equal(ctx.server.calls.length, calls);
    assert.deepEqual((await ctx.store.read()).outbox.map((o) => o.type), ['delete', 'edit']);
  });

  test('a change the server refuses while online is an error, and is not queued', async () => {
    await assert.rejects(service.addCattle(form({ tagNumber: 'ct-001' })), /Duplicate cow number/);
    assert.equal(service.lastQueued, false);
    assert.deepEqual((await ctx.store.read()).outbox, []);
    assert.equal(service.getAllCattle().length, 2);
  });

  test('re-applying a change can pass the day it was first made', async () => {
    await service.updateCattle('a', form({ tagNumber: 'CT-001', nameBreed: 'Daisy', weight: '845' }), { weightDate: '2026-11-03' });
    assert.deepEqual(ctx.server.weighings, [{ cattleId: 'a', date: '2026-11-03', weight: 845 }]);
  });

  test('with no saved herd, a failed load is still an error', async () => {
    const engine = setup({ herd: [] }).engine;
    await engine.clear();
    ctx.server.down(1);
    const fresh = new CattleService({ sync: engine });
    await assert.rejects(fresh.loadData(), /Can't reach the server/);
  });

  test('a load that fails for another reason does not fall back to the saved herd', async () => {
    mock.method(globalThis, 'fetch', async () => ({ status: 500, ok: false, json: async () => ({ error: 'Internal server error' }) }));
    await assert.rejects(service.loadData(), /Internal server error/);
    assert.equal(service.fromCache, false);
  });
});
