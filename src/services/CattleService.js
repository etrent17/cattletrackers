import { Cattle } from "../models/Cattle.js";
import { validateTagNumber, validateWeight } from "../utils/validators.js";
import { parseLocalDate, todayISO } from "../utils/DateHelpers.js";

// Errors thrown here carry `status` (HTTP status, or 0 when the server could not
// be reached) and `sessionExpired` (true on 401, after the redirect to sign in has
// started), so callers can skip their own message while the page navigates away.
export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw Object.assign(new Error("Can't reach the server. Check your connection and try again."), { status: 0 });
  }
  if (res.status === 401) {
    location.replace("/login.html");
    throw Object.assign(new Error("Your session has expired. Please sign in again."), { status: 401, sessionExpired: true });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || (data.errors && data.errors[0] && data.errors[0].msg))) || `Request failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return data;
}

export class CattleService {
  constructor() {
    this.cattle = [];
  }

  async loadData() {
    const rows = await api("/api/cattle");
    this.cattle = rows.map((r) => new Cattle(r));
    return true;
  }

  async addCattle(data) {
    if (!validateTagNumber(data.tagNumber)) throw new Error("Invalid cow number");
    if (!validateWeight(data.weight)) throw new Error("Invalid weight");
    const created = await api("/api/cattle", {
      method: "POST",
      // A weight becomes the animal's first weighing, dated today (the user's local date).
      body: JSON.stringify({ ...data, weight: data.weight ? parseFloat(data.weight) : null, weightDate: todayISO() }),
    });
    const cattle = new Cattle(created);
    this.cattle.unshift(cattle);
    return cattle;
  }

  async updateCattle(id, data) {
    const existing = this.getCattleById(id);
    if (!existing) throw new Error("Cattle not found");
    const updated = await api(`/api/cattle/${encodeURIComponent(id)}`, {
      method: "PUT",
      // A weight different from the current one is recorded as a new weighing dated today; the
      // same weight or a blank one records nothing (see PUT /api/cattle/:id).
      body: JSON.stringify({ ...data, weight: data.weight ? parseFloat(data.weight) : null, weightDate: todayISO() }),
    });
    existing.update(updated);
    return existing;
  }

  async deleteCattle(id) {
    const index = this.cattle.findIndex((c) => c.id === id);
    if (index === -1) throw new Error("Cattle not found");
    await api(`/api/cattle/${encodeURIComponent(id)}`, { method: "DELETE" });
    this.cattle.splice(index, 1);
    return true;
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
