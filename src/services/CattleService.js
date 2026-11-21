import { Cattle } from "../models/Cattle.js";
import { validateTagNumber, validateWeight } from "../utils/validators.js";
import { parseLocalDate, todayISO } from "../utils/DateHelpers.js";
import { GATEWAY_STATUSES, noteApiResult } from "../utils/connectivity.js";
import { applyOutbox, isUnreachable } from "./SyncEngine.js";

// Errors thrown here carry `status` (HTTP status, or 0 when the server could not
// be reached), `data` (the error body, when there was one) and `sessionExpired` (true on
// 401, after the redirect to sign in has started), so callers can skip their own message
// while the page navigates away. Every request also reports whether the server answered
// (src/utils/connectivity.js), which drives the Online/Offline indicator.
export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    noteApiResult(false);
    throw Object.assign(new Error("Can't reach the server. Check your connection and try again."), { status: 0 });
  }
  noteApiResult(!GATEWAY_STATUSES.includes(res.status));
  if (res.status === 401) {
    location.replace("/login.html");
    throw Object.assign(new Error("Your session has expired. Please sign in again."), { status: 401, sessionExpired: true });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || (data.errors && data.errors[0] && data.errors[0].msg))) || `Request failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status, data });
  }
  return data;
}

// The herd in memory, and the calls that change it.
//
// With a `sync` engine (src/services/SyncEngine.js; the app always passes one) the service also
// works without a connection (feature 14):
// - every herd the server returns is saved in the browser, and shown when the server can't be
//   reached (`fromCache` is then true);
// - a change that can't be sent is put in the outbox and applied to the list at once
//   (`lastQueued` is then true), and sent later by SyncEngine.replay().
// Without one (the unit tests of the plain calls) it talks to the server only.
export class CattleService {
  constructor({ sync = null } = {}) {
    this.cattle = [];
    this.sync = sync;
    this.fromCache = false; // the list came from this browser's copy, not from the server
    this.lastQueued = false; // the last add, update or delete went to the outbox
    this.onQueued = null; // called after a change was queued
  }

  async loadData() {
    let rows;
    try {
      rows = await api("/api/cattle");
    } catch (err) {
      if (!this.sync || !isUnreachable(err) || !(await this.sync.state()).herdSavedAt) throw err;
      this.fromCache = true;
      await this.refreshFromStore();
      return true;
    }
    this.fromCache = false;
    if (!this.sync) {
      this.cattle = rows.map((r) => new Cattle(r));
      return true;
    }
    await this.sync.saveHerd(rows);
    await this.refreshFromStore();
    return true;
  }

  // Rebuilds the list from the saved herd plus the changes still waiting in the outbox.
  async refreshFromStore() {
    const state = await this.sync.state();
    this.cattle = applyOutbox(state.herd, state.outbox).map((r) => new Cattle(r));
  }

  // `weightDate` (optional) dates the weighing a weight becomes; the default is today, the
  // user's local date. Re-applying a change made earlier passes the date it was made.
  async addCattle(data, { weightDate = null } = {}) {
    if (!validateTagNumber(data.tagNumber)) throw new Error("Invalid cow number");
    if (!validateWeight(data.weight)) throw new Error("Invalid weight");
    // A weight becomes the animal's first weighing, dated today (the user's local date).
    const body = { ...data, weight: data.weight ? parseFloat(data.weight) : null };
    if (!this.sync) {
      const created = await api("/api/cattle", { method: "POST", body: JSON.stringify({ ...body, weightDate: weightDate || todayISO() }) });
      const cattle = new Cattle(created);
      this.cattle.unshift(cattle);
      return cattle;
    }
    // The id is chosen here so the same request can be sent again safely if its answer is lost.
    const id = this.sync.newId();
    return this.write({ type: "create", cattleId: id, data: body, weightDate }, () =>
      api("/api/cattle", { method: "POST", body: JSON.stringify({ ...body, id, weightDate: weightDate || todayISO() }) }));
  }

  async updateCattle(id, data, { weightDate = null } = {}) {
    const existing = this.getCattleById(id);
    if (!existing) throw new Error("Cattle not found");
    // A weight different from the current one is recorded as a new weighing dated today; the
    // same weight or a blank one records nothing (see PUT /api/cattle/:id).
    const body = { ...data, weight: data.weight ? parseFloat(data.weight) : null };
    const send = () => api(`/api/cattle/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ ...body, weightDate: weightDate || todayISO() }),
    });
    if (!this.sync) {
      existing.update(await send());
      return existing;
    }
    return this.write({ type: "edit", cattleId: id, data: body, weightDate }, send);
  }

  async deleteCattle(id) {
    const index = this.cattle.findIndex((c) => c.id === id);
    if (index === -1) throw new Error("Cattle not found");
    const send = () => api(`/api/cattle/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!this.sync) {
      await send();
      this.cattle.splice(index, 1);
      return true;
    }
    await this.write({ type: "delete", cattleId: id }, send);
    return true;
  }

  // Sends one change to the server, or queues it when the server can't be reached (or older
  // changes are still queued and must go first). Either way the list shows the change afterwards.
  // Rejects, changing nothing, when the server refuses the change or it can't be saved here.
  async write(op, send) {
    this.lastQueued = false;
    let queue = await this.sync.mustQueue();
    let attempted = false;
    if (!queue) {
      let row;
      try {
        row = await send();
      } catch (err) {
        // The request may have got through before the connection dropped. Queueing it is still
        // right: replay recognises a change the server already has.
        if (!isUnreachable(err) || !this.sync.persistent) throw err;
        queue = true;
        attempted = true;
      }
      if (!queue) {
        if (op.type === "delete") await this.sync.cacheRemove(op.cattleId);
        else await this.sync.cacheRow(row);
      }
    }
    if (queue) {
      await this.sync.enqueue({ ...op, attempted });
      this.lastQueued = true;
    }
    await this.refreshFromStore();
    if (queue) this.onQueued?.();
    return this.getCattleById(op.cattleId);
  }

  getCattleById(id) {
    return this.cattle.find((c) => c.id === id) || null;
  }

  getAllCattle() {
    return [...this.cattle];
  }

  getRecentCattle(limit = 5) {
    return this.cattle.slice(0, limit);
  }

  searchCattle(query, statusFilter = "all") {
    const term = (query || "").toLowerCase().trim();
    return this.cattle.filter((c) => {
      const matchesStatus = statusFilter === "all" || c.healthStatus === statusFilter;
      const matchesQuery =
        !term ||
        c.tagNumber.toLowerCase().includes(term) ||
        (c.nameBreed && c.nameBreed.toLowerCase().includes(term)) ||
        (c.medications && c.medications.toLowerCase().includes(term)) ||
        (c.notes && c.notes.toLowerCase().includes(term));
      return matchesStatus && matchesQuery;
    });
  }

  isDuplicateTag(tagNumber, excludeId = null) {
    const normalized = tagNumber.trim().toLowerCase();
    return this.cattle.some(
      (c) => c.tagNumber.trim().toLowerCase() === normalized && c.id !== excludeId
    );
  }

  // Expected calvings due today or later, soonest first.
  getUpcomingCalvings(limit = 5) {
    const today = todayISO();
    return this.cattle
      .filter((cow) => cow.gender !== "male" && parseLocalDate(cow.expectedCalvingDate) && cow.expectedCalvingDate >= today)
      .sort((a, b) => a.expectedCalvingDate.localeCompare(b.expectedCalvingDate))
      .slice(0, limit);
  }

  getStatistics() {
    const now = new Date();
    const calvingThisMonth = this.cattle.filter((cow) => {
      const due = parseLocalDate(cow.expectedCalvingDate);
      return due !== null && due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth();
    }).length;

    return {
      total: this.cattle.length,
      healthy: this.cattle.filter((cow) => cow.healthStatus === "healthy").length,
      calvingThisMonth,
      // Current treatment status is a proxy, not a treatment schedule.
      scheduledTreatments: this.cattle.filter((cow) => cow.healthStatus === "under_treatment").length,
    };
  }
}
