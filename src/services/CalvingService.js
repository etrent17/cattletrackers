// Calving events: API calls plus the pure helpers the Calving page uses (labels, form checks,
// filtering). The template for the other event-record services; see "Event records pattern" in
// docs/architecture-and-data.md.
import { api } from "./CattleService.js";
import { parseLocalDate, todayISO } from "../utils/DateHelpers.js";

export const EASE_LABELS = { unassisted: "Unassisted", assisted: "Assisted", caesarean: "Caesarean" };
export const OUTCOME_LABELS = { alive: "Alive", stillborn: "Stillborn" };
export const CALF_SEX_LABELS = { female: "Heifer", male: "Bull" };

// Turns the form's strings into the request body: trimmed text, a numeric weight, and the two
// create-only options as real booleans.
export function calvingPayload(form) {
  const weight = String(form.birthWeight ?? "").trim();
  return {
    calvingDate: form.calvingDate || "",
    calfSex: form.calfSex || "",
    calfTag: (form.calfTag || "").trim(),
    birthWeight: weight === "" ? null : Number(weight),
    ease: form.ease || "",
    outcome: form.outcome || "",
    notes: (form.notes || "").trim(),
    addCalf: Boolean(form.addCalf),
    clearExpected: Boolean(form.clearExpected),
  };
}

// Checks a payload before it is sent. Returns the message to show, or null when it is fine.
// The server applies the same rules; this only saves a round trip.
export function validateCalving(data, today = todayISO()) {
  if (!parseLocalDate(data.calvingDate)) return "Enter the calving date";
  if (data.calvingDate > today) return "The calving date cannot be in the future";
  if (data.birthWeight !== null && !(data.birthWeight > 0 && data.birthWeight <= 500)) return "Invalid birth weight";
  if (data.calfTag.length > 25) return "Invalid calf number";
  if (data.addCalf && !data.calfTag) return "Enter a calf number to add the calf as a new animal";
  if (data.addCalf && data.outcome === "stillborn") return "A stillborn calf cannot be added as a new animal";
  return null;
}

// Narrows a list of events by free text (cow number or name, calf number, notes), outcome and
// calendar year. Empty or "all" means no filter. Order is kept.
export function filterCalvings(events, { query = "", outcome = "all", year = "all" } = {}) {
  const term = query.toLowerCase().trim();
  return events.filter((e) => {
    if (outcome !== "all" && e.outcome !== outcome) return false;
    if (year !== "all" && !e.calvingDate.startsWith(`${year}-`)) return false;
    if (!term) return true;
    return [e.cattleTag, e.cattleName, e.calfTag, e.notes].some((v) => (v || "").toLowerCase().includes(term));
  });
}

// The years that have events, newest first, for the year filter.
export function calvingYears(events) {
  return [...new Set(events.map((e) => e.calvingDate.slice(0, 4)))].sort().reverse();
}

// Whole days from today to a `YYYY-MM-DD` date (0 = today, negative = past); null if not a date.
export function daysUntil(dateStr, today = todayISO()) {
  const date = parseLocalDate(dateStr);
  const from = parseLocalDate(today);
  if (!date || !from) return null;
  return Math.round((date - from) / 86400000);
}

export class CalvingService {
  constructor() {
    this.events = []; // the whole herd's events, newest first, as last loaded
  }

  async loadAll() {
    this.events = await api("/api/calvings");
    return this.events;
  }

  // One animal's history, newest first. Always fetched, so the details tab is never stale.
  loadForCattle(cattleId) {
    return api(`/api/cattle/${encodeURIComponent(cattleId)}/calvings`);
  }

  // Returns the new event; `calf` on it is the new animal when `addCalf` was set.
  add(cattleId, data) {
    return api(`/api/cattle/${encodeURIComponent(cattleId)}/calvings`, { method: "POST", body: JSON.stringify(data) });
  }

  update(id, data) {
    const { addCalf, clearExpected, ...fields } = data; // create-only options
    return api(`/api/calvings/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(fields) });
  }

  remove(id) {
    return api(`/api/calvings/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
