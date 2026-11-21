// The outbox: cattle changes made without a connection, and how they reach the server
// (feature 14, offline editing). No DOM here; the store and the request function are passed in,
// so the unit tests run it with a MemoryStore and a stubbed request.
//
// An outbox entry ("op"):
//   seq                order in the queue
//   type               "create" | "edit" | "delete"
//   cattleId           the animal's id (chosen in the browser for a create)
//   data               the form's fields (null for a delete)
//   expectedUpdatedAt  the server row's `updatedAt` the change was made on top of, or null
//   weightDate         the user's local date when the change was made; dates the weighing a
//                      changed weight becomes, whenever the op is finally sent
//   queuedAt           when the change was made (ISO)
//   tries              how many times the op has been sent
//   serverErrors       how many of those ended in a server error
//   label              "CT-001 Daisy", for lists
//
// Replay sends the ops oldest first, one at a time. For each op the server's answer decides:
//
//   accepted           the op leaves the outbox and the cached row takes the server's version.
//                      Later ops for the same animal are rebased onto that version.
//   no answer          (network error, 502/503/504, 401, 408, 429) replay STOPS. The op and
//                      everything after it stay queued, in order, for the next attempt.
//   refused            (409 changed elsewhere, duplicate cow number, validation, 404, demo limit,
//                      ...) the server's version stands. The op moves to the `unsynced` list
//                      together with any later ops for the same animal (they were made on top of
//                      it), and replay CONTINUES with the other animals.
//   server error       (500 and the like) treated as "no answer" twice; refused the third time,
//                      so one bad record cannot block the queue forever.
//
// An op only ever leaves the outbox in the same store transaction that either records the
// server's answer or adds it to `unsynced`. Nothing is dropped anywhere else.
import { todayISO } from "../utils/DateHelpers.js";
import { GATEWAY_STATUSES } from "../utils/connectivity.js";

export const MAX_SERVER_ERROR_TRIES = 3;
export const DEPENDENT_REASON = "An earlier change to this animal could not be synced, so this one was not sent.";

const RETRY_LATER = new Set([0, 401, 408, 429, ...GATEWAY_STATUSES]);

// True for an error that means "the server never handled this" (see CattleService.api()).
export const isUnreachable = (err) => Boolean(err) && (err.status === 0 || GATEWAY_STATUSES.includes(err.status));

const blank = (v) => v === undefined || v === null || v === "";
const text = (v) => (blank(v) ? "" : String(v));
const sameWeight = (a, b) => !blank(a) && !blank(b) && Math.round(Number(a) * 100) === Math.round(Number(b) * 100);

// The fields PUT /api/cattle/:id writes from the form. lastCalvingDate and withdrawalUntil follow
// the animal's records and are not among them; weight is handled apart.
const EDIT_FIELDS = ["tagNumber", "nameBreed", "gender", "birthDate", "expectedCalvingDate", "medications", "healthStatus", "notes"];

const normalised = (field, value) => {
  if (field === "healthStatus") return text(value) || "healthy";
  if (field === "tagNumber") return text(value).trim();
  return text(value);
};

// Whether the server row already holds everything an edit asked for. A sent edit whose answer
// was lost comes back as "changed since" on the retry; this recognises it as done.
export function sameAsRequested(data, current) {
  if (!data || !current) return false;
  if (!EDIT_FIELDS.every((f) => normalised(f, data[f]) === normalised(f, current[f]))) return false;
  return blank(data.weight) || sameWeight(data.weight, current.weight);
}

// The herd as the user should see it: the server's rows with the queued changes applied on top.
// Rows touched by a queued change carry `pendingSync: true`.
export function applyOutbox(herd, outbox) {
  let rows = herd.map((row) => ({ ...row }));
  for (const op of outbox) {
    const index = rows.findIndex((row) => row.id === op.cattleId);
    if (op.type === "delete") {
      rows = rows.filter((row) => row.id !== op.cattleId);
    } else if (op.type === "create") {
      if (index !== -1) continue; // already on the server (the answer was lost); replay settles it
      const data = op.data || {};
      rows.unshift({
        ...data,
        id: op.cattleId,
        lastCalvingDate: data.gender === "male" ? "" : text(data.lastCalvingDate),
        weight: blank(data.weight) ? null : Number(data.weight),
        withdrawalUntil: "",
        createdAt: op.queuedAt,
        updatedAt: op.queuedAt,
        pendingSync: true,
      });
    } else if (op.type === "edit" && index !== -1) {
      const data = op.data || {};
      const next = { ...rows[index], pendingSync: true };
      for (const field of EDIT_FIELDS) if (data[field] !== undefined) next[field] = data[field];
      if (!blank(data.weight)) next.weight = Number(data.weight);
      rows[index] = next;
    }
  }
  return rows;
}

// A random (version 4) UUID. crypto.randomUUID only exists on HTTPS and localhost, and the app
// may be served over plain HTTP on a farm network, so fall back to getRandomValues.
export function newUuid(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === "function") return cryptoImpl.randomUUID();
  const b = cryptoImpl.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const upsert = (herd, row) => {
  const index = herd.findIndex((r) => r.id === row.id);
  if (index === -1) herd.unshift(row);
  else herd[index] = row;
};

const labelOf = (data, fallback = "") => {
  const label = [text(data?.tagNumber).trim(), text(data?.nameBreed).trim()].filter(Boolean).join(" ");
  return label || fallback;
};

export class SyncEngine {
  // request(path, options) resolves to the parsed JSON body, or rejects with an Error carrying
  // `status` (0 = no answer) and `data` (the error body): CattleService.api.
  constructor({ store, request, today = todayISO, now = () => new Date().toISOString(), newId = newUuid, locks = globalThis.navigator?.locks, isOnline = () => true }) {
    this.store = store;
    this.request = request;
    this.today = today;
    this.now = now;
    this.newId = newId;
    this.locks = locks;
    this.isOnline = isOnline;
    this.running = null;
    this.listeners = new Set();
  }

  get persistent() {
    return this.store.persistent;
  }

  // `listener()` runs after the outbox or the unsynced list changed.
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed() {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (err) {
        console.error("Sync listener failed:", err);
      }
    }
  }

  state() {
    return this.store.read();
  }

  // ----- the cached herd -----

  async saveHerd(rows) {
    await this.store.update((s) => {
      s.herd = rows;
      s.herdSavedAt = this.now();
    });
  }

  async cacheRow(row) {
    await this.store.update((s) => upsert(s.herd, row));
  }

  async cacheRemove(id) {
    await this.store.update((s) => {
      s.herd = s.herd.filter((r) => r.id !== id);
    });
  }

  // Records whose copy this is. A copy left by a different account is wiped first; resolves to
  // how many of that account's unsent or refused changes went with it (so the caller can say so).
  async setUser(user) {
    let dropped = 0;
    await this.store.update((s) => {
      if (s.user && s.user.id !== user.id) {
        dropped = s.outbox.length + s.unsynced.length;
        s.herd = [];
        s.herdSavedAt = null;
        s.outbox = [];
        s.unsynced = [];
      }
      s.user = { id: user.id, email: user.email, role: user.role, isDemo: Boolean(user.isDemo) };
    });
    if (dropped) this.changed();
    return dropped;
  }

  async clear() {
    await this.store.clear();
    this.changed();
  }

  // ----- the outbox -----

  // Whether a change must go through the outbox instead of straight to the server: there is no
  // connection, or older changes are still waiting and must go first.
  async mustQueue() {
    if (!this.persistent) return false;
    if (!this.isOnline()) return true;
    return (await this.state()).outbox.length > 0;
  }

  // Adds a change to the outbox. Resolves to the op, or to null when the change cancelled out:
  // deleting an animal that was added here and never sent removes it from the queue instead.
  async enqueue({ type, cattleId, data = null, weightDate = null }) {
    if (!this.persistent) throw new Error("This browser can't keep changes offline. Reconnect and try again.");
    let op = null;
    await this.store.update((s) => {
      const earlier = s.outbox.filter((o) => o.cattleId === cattleId);
      const create = earlier.find((o) => o.type === "create");
      if (type === "delete" && create && !create.tries) {
        s.outbox = s.outbox.filter((o) => o.cattleId !== cattleId);
        return;
      }
      const base = s.herd.find((r) => r.id === cattleId);
      op = {
        seq: s.nextSeq++,
        type,
        cattleId,
        data,
        // After another queued op for the same animal this is rebased when that op is accepted.
        expectedUpdatedAt: type === "create" || earlier.length ? null : base?.updatedAt ?? null,
        weightDate: weightDate || this.today(),
        queuedAt: this.now(),
        tries: 0,
        label: labelOf(data, labelOf(earlier.findLast((o) => o.data)?.data, labelOf(base))),
      };
      s.outbox.push(op);
    });
    this.changed();
    return op;
  }

  async discardUnsynced(key) {
    await this.store.update((s) => {
      s.unsynced = s.unsynced.filter((item) => item.key !== key);
    });
    this.changed();
  }

  // ----- replay -----

  // Sends the outbox. Never rejects. Resolves to
  //   { synced, rejected, remaining, stopped }
  // where `stopped` is null when the queue was worked through, "unreachable" when the server gave
  // no answer, "error" on a server error or a local failure, and "busy" when another tab is
  // already replaying. Calls made while a replay is running share its result.
  replay() {
    this.running ??= this.exclusive().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async exclusive() {
    try {
      if (this.locks?.request) {
        return await this.locks.request("cattle-trackers-sync", { ifAvailable: true }, (lock) =>
          lock ? this.drain() : this.summary({ stopped: "busy" }));
      }
      return await this.drain();
    } catch (err) {
      console.error("Sync failed:", err);
      return this.summary({ stopped: "error" }).catch(() => ({ synced: 0, rejected: 0, remaining: 0, stopped: "error" }));
    }
  }

  async summary(fields) {
    return { synced: 0, rejected: 0, stopped: null, ...fields, remaining: (await this.state()).outbox.length };
  }

  async drain() {
    const counts = { synced: 0, rejected: 0, stopped: null };
    for (;;) {
      // Mark the op as sent before sending it: from here on the server may have it.
      let op = null;
      await this.store.update((s) => {
        if (!s.outbox.length) return;
        s.outbox[0].tries = (s.outbox[0].tries || 0) + 1;
        op = { ...s.outbox[0] };
      });
      if (!op) break;

      let outcome;
      try {
        outcome = { kind: "accepted", row: await this.send(op) };
      } catch (err) {
        outcome = this.classify(op, err);
      }

      if (outcome.kind === "stop") {
        counts.stopped = outcome.reason;
        if (outcome.reason === "error") {
          await this.store.update((s) => {
            const queued = s.outbox.find((o) => o.seq === op.seq);
            if (queued) queued.serverErrors = (queued.serverErrors || 0) + 1;
          });
        }
        break;
      }
      if (outcome.kind === "accepted") {
        await this.accept(op, outcome.row);
        counts.synced += 1;
      } else {
        counts.rejected += await this.refuse(op, outcome.error);
      }
      this.changed();
    }
    return this.summary(counts);
  }

  send(op) {
    const path = `/api/cattle/${encodeURIComponent(op.cattleId)}`;
    if (op.type === "create") {
      return this.request("/api/cattle", {
        method: "POST",
        body: JSON.stringify({ ...op.data, id: op.cattleId, weightDate: op.weightDate }),
      });
    }
    if (op.type === "edit") {
      const body = { ...op.data, weightDate: op.weightDate };
      if (op.expectedUpdatedAt) body.expectedUpdatedAt = op.expectedUpdatedAt;
      return this.request(path, { method: "PUT", body: JSON.stringify(body) });
    }
    const query = op.expectedUpdatedAt ? `?expectedUpdatedAt=${encodeURIComponent(op.expectedUpdatedAt)}` : "";
    return this.request(`${path}${query}`, { method: "DELETE" });
  }

  classify(op, err) {
    const status = err?.status;
    // Deleting something that is already gone: the user has what they asked for.
    if (op.type === "delete" && status === 404) return { kind: "accepted", row: null };
    // The edit got through on an earlier try whose answer was lost.
    if (op.type === "edit" && status === 409 && err.data?.code === "stale" && sameAsRequested(op.data, err.data.current)) {
      return { kind: "accepted", row: err.data.current };
    }
    if (RETRY_LATER.has(status)) return { kind: "stop", reason: "unreachable" };
    if (typeof status !== "number" || status >= 500) {
      if ((op.serverErrors || 0) + 1 < MAX_SERVER_ERROR_TRIES) return { kind: "stop", reason: "error" };
    }
    return { kind: "refused", error: err };
  }

  // The server took the op: drop it from the outbox and keep the server's row.
  async accept(op, row) {
    await this.store.update((s) => {
      s.outbox = s.outbox.filter((o) => o.seq !== op.seq);
      if (op.type === "delete") s.herd = s.herd.filter((r) => r.id !== op.cattleId);
      else if (row && row.id) upsert(s.herd, row);
      // Later changes to this animal were made on top of this one.
      for (const later of s.outbox) {
        if (later.cattleId === op.cattleId && later.type !== "create") later.expectedUpdatedAt = row?.updatedAt ?? null;
      }
    });
  }

  // The server refused the op: move it, and later ops for the same animal, to `unsynced`.
  // Resolves to how many ops were moved.
  async refuse(op, err) {
    let moved = 0;
    const current = err?.data?.current ?? null;
    await this.store.update((s) => {
      if (!s.outbox.some((o) => o.seq === op.seq)) return; // another tab already dealt with it
      const mine = s.outbox.filter((o) => o.cattleId === op.cattleId);
      s.outbox = s.outbox.filter((o) => o.cattleId !== op.cattleId);
      for (const o of mine) {
        const first = o.seq === op.seq;
        s.unsynced.push({
          key: s.nextSeq++,
          op: o,
          status: first ? err?.status ?? null : null,
          code: first ? err?.data?.code ?? null : "dependent",
          reason: first ? err?.message || "The server refused this change." : DEPENDENT_REASON,
          current,
          rejectedAt: this.now(),
        });
        moved += 1;
      }
      // Show the server's version from now on.
      if (current) upsert(s.herd, current);
      else if (op.type !== "create" && err?.status === 404) s.herd = s.herd.filter((r) => r.id !== op.cattleId);
    });
    return moved;
  }
}
