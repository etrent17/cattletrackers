import { Cattle } from "../models/Cattle.js";
import { validateTagNumber, validateWeight } from "../utils/validators.js";

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) {
    location.replace("/login.html");
    throw new Error("Session expired");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || (data.errors && data.errors[0] && data.errors[0].msg))) || "Request failed";
    throw new Error(msg);
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
      body: JSON.stringify({ ...data, weight: data.weight ? parseFloat(data.weight) : null }),
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
      body: JSON.stringify({ ...data, weight: data.weight ? parseFloat(data.weight) : null }),
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

  getStatistics() {
    const now = new Date();
    const calvingThisMonth = this.cattle.filter((cow) => {
      if (!cow.expectedCalvingDate) return false;
      const due = new Date(cow.expectedCalvingDate);
      return (
        !Number.isNaN(due.getTime()) &&
        due.getUTCFullYear() === now.getFullYear() &&
        due.getUTCMonth() === now.getMonth()
      );
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
