// The copy of the herd kept in this browser (feature 14, offline editing).
//
// Everything lives in ONE IndexedDB record, the "state":
//
//   user         the account the copy belongs to ({ id, email, role, isDemo }), or null
//   herd         the cattle rows exactly as the server last returned them (GET /api/cattle order)
//   herdSavedAt  when `herd` was last written from a server answer (ISO string), or null
//   outbox       changes made here and not yet accepted by the server, oldest first
//   unsynced     changes the server refused, kept until the user re-applies or discards them
//   nextSeq      counter for outbox `seq` and unsynced `key`
//
// One record keeps every change atomic: update(fn) reads the state, lets fn change it, and
// writes it back inside a single read-write transaction. IndexedDB runs such transactions one
// after another, across tabs too, so two tabs cannot overwrite each other's queued changes, and
// a change is never half-moved (for example out of the outbox but not yet into `unsynced`).
//
// A store has: persistent (boolean), read(), update(fn), clear().
// fn must be synchronous and must only touch the state it is given.

const DB_NAME = "cattle-trackers-offline";
const STORE = "state";
const KEY = "state";

export const emptyState = () => ({
  user: null,
  herd: [],
  herdSavedAt: null,
  outbox: [],
  unsynced: [],
  nextSeq: 1,
});

// Fills in anything missing, so a record written by an older version still works.
const normalise = (state) => ({ ...emptyState(), ...(state && typeof state === "object" ? state : {}) });

const clone = (value) => JSON.parse(JSON.stringify(value));

// Keeps the state in memory only. Used by the unit tests, and in a browser where IndexedDB is
// not available (some private windows). `persistent` is false, and the app then does not queue
// changes offline at all: a change that would vanish with the tab is refused instead.
export class MemoryStore {
  constructor(state) {
    this.persistent = false;
    this.state = normalise(state);
  }

  async read() {
    return clone(this.state);
  }

  async update(fn) {
    const next = clone(this.state);
    fn(next);
    this.state = clone(next);
    return next;
  }

  async clear() {
    this.state = emptyState();
  }
}

export class IndexedDbStore {
  constructor(db) {
    this.persistent = true;
    this.db = db;
  }

  read() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, "readonly");
      const get = tx.objectStore(STORE).get(KEY);
      get.onsuccess = () => resolve(normalise(get.result));
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Couldn't read the offline copy"));
    });
  }

  update(fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, "readwrite");
      const os = tx.objectStore(STORE);
      let next;
      let failure = null;
      const get = os.get(KEY);
      get.onsuccess = () => {
        try {
          next = normalise(get.result);
          fn(next);
          os.put(next, KEY);
        } catch (err) {
          failure = err;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(next);
      tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error("Couldn't save on this device"));
    });
  }

  clear() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Couldn't clear the offline copy"));
    });
  }
}

// Opens the browser's store. Falls back to a MemoryStore when IndexedDB is missing or refuses
// to open, so the app still works online.
export function openOfflineStore(idb = globalThis.indexedDB) {
  return new Promise((resolve) => {
    const fallback = (why) => {
      console.warn("Offline copy unavailable; cattle records need a connection in this browser.", why || "");
      resolve(new MemoryStore());
    };
    if (!idb) return fallback("IndexedDB is not available");
    let request;
    try {
      request = idb.open(DB_NAME, 1);
    } catch (err) {
      return fallback(err);
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab is upgrading the database: let go so it is not blocked.
      db.onversionchange = () => db.close();
      resolve(new IndexedDbStore(db));
    };
    request.onerror = () => fallback(request.error);
    request.onblocked = () => fallback("blocked by another tab");
  });
}
