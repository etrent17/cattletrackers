// Breeding records: API calls for breedings, pregnancy checks and the needs-check list, plus the
// pure helpers the Breeding History page uses (labels, payloads, form checks, date math,
// filtering). See "Event records pattern" in docs/architecture-and-data.md.
import { api } from "./CattleService.js";
import { parseLocalDate, todayISO } from "../utils/DateHelpers.js";

export const METHOD_LABELS = { ai: "AI", natural: "Natural" };
export const RESULT_LABELS = { pregnant: "Pregnant", open: "Open", unsure: "Unsure" };
export const CHECK_METHOD_LABELS = { palpation: "Palpation", ultrasound: "Ultrasound", blood_test: "Blood test", other: "Other" };

// ----- Date math (local calendar dates, 'YYYY-MM-DD') -----

// The date `days` calendar days after `dateStr` (negative goes back), or "" if it is not a date.
// Works on the local calendar, so daylight-saving changes never shift the day.
export function addDays(dateStr, days) {
  const date = parseLocalDate(dateStr);
  if (!date || !Number.isFinite(days)) return "";
  date.setDate(date.getDate() + days);
  return todayISO(date);
}

// ----- Labels -----

// The sire as shown in tables: the linked bull's current number and name, or the typed text.
export function sireLabel(event) {
  if (event.sireCattleId && event.sireTag) return [event.sireTag, event.sireName].filter(Boolean).join(" ");
  return event.sire || "";
}

// "2026-01-10 · AI · ABS 29JE4012": one breeding, for the check form's breeding list.
export function breedingLabel(event) {
  return [event.breedingDate, METHOD_LABELS[event.method], sireLabel(event)].filter(Boolean).join(" · ");
}

// ----- Forms -----

// Breeding form strings to the request body. A bull from the herd replaces the typed sire.
export function breedingPayload(form) {
  const sireCattleId = form.sireCattleId || "";
  return {
    breedingDate: form.breedingDate || "",
    method: form.method || "",
    sire: sireCattleId ? "" : (form.sire || "").trim(),
    sireCattleId: sireCattleId || null,
    technician: (form.technician || "").trim(),
    notes: (form.notes || "").trim(),
  };
}

// Returns the message to show, or null when the payload is fine. The server checks the same.
export function validateBreeding(data, today = todayISO()) {
  if (!parseLocalDate(data.breedingDate)) return "Enter the breeding date";
  if (data.breedingDate > today) return "The breeding date cannot be in the future";
  if (data.sire.length > 100) return "The sire must be 100 characters or fewer";
  if (data.technician.length > 100) return "The technician must be 100 characters or fewer";
  return null;
}

export function checkPayload(form) {
  return {
    checkDate: form.checkDate || "",
    result: form.result || "",
    method: form.method || "",
    breedingId: form.breedingId || null,
    notes: (form.notes || "").trim(),
  };
}

// `breedingDate` is the date of the linked breeding, if any.
export function validateCheck(data, today = todayISO(), breedingDate = "") {
  if (!parseLocalDate(data.checkDate)) return "Enter the check date";
  if (data.checkDate > today) return "The check date cannot be in the future";
  if (!RESULT_LABELS[data.result]) return "Choose a result: pregnant, open or unsure";
  if (breedingDate && data.checkDate < breedingDate) return "The check date cannot be before the breeding date";
  return null;
}

// The breeding a new check most likely belongs to: the newest one on or before the check date.
// `breedings` may be in any order. Returns the breeding or null.
export function breedingForCheck(breedings, checkDate) {
  if (!parseLocalDate(checkDate)) return null;
  return breedings
    .filter((b) => b.breedingDate <= checkDate)
    .reduce((best, b) => (!best || b.breedingDate > best.breedingDate ? b : best), null);
}

// ----- Lists -----

// The herd's bulls (animals recorded as male), by cow number, for the sire picker.
export function herdBulls(cattle) {
  return cattle
    .filter((c) => c.gender === "male")
    .sort((a, b) => a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true }));
}

// Narrows breedings or checks by free text: cow number or name, sire, technician, notes.
export function filterRecords(events, query = "") {
  const term = query.toLowerCase().trim();
  if (!term) return events;
  return events.filter((e) =>
    [e.cattleTag, e.cattleName, sireLabel(e), e.sire, e.technician, e.notes].some((v) => (v || "").toLowerCase().includes(term))
  );
}

export class BreedingService {
  constructor() {
    this.breedings = []; // the whole herd's breedings, newest first, as last loaded
    this.checks = []; // the whole herd's pregnancy checks, newest first
    this.needsCheck = []; // cows bred long enough ago with no check since
    this.checkAfterDays = null; // from the server, with the needs-check list
    this.gestationDays = null;
  }

  async loadAll(today = todayISO()) {
    const [breedings, checks] = await Promise.all([api("/api/breedings"), api("/api/pregnancy-checks"), this.loadNeedsCheck(today)]);
    this.breedings = breedings;
    this.checks = checks;
  }

  // Also learns the gestation length and check delay the server uses.
  async loadNeedsCheck(today = todayISO()) {
    const body = await api(`/api/breedings/needs-check?today=${encodeURIComponent(today)}`);
    this.needsCheck = body.cows;
    this.checkAfterDays = body.checkAfterDays;
    this.gestationDays = body.gestationDays;
    return body;
  }

  loadBreedingsFor(cattleId) {
    return api(`/api/cattle/${encodeURIComponent(cattleId)}/breedings`);
  }

  loadChecksFor(cattleId) {
    return api(`/api/cattle/${encodeURIComponent(cattleId)}/pregnancy-checks`);
  }

  addBreeding(cattleId, data) {
    return api(`/api/cattle/${encodeURIComponent(cattleId)}/breedings`, { method: "POST", body: JSON.stringify(data) });
  }

  updateBreeding(id, data) {
    return api(`/api/breedings/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) });
  }

  removeBreeding(id) {
    return api(`/api/breedings/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  addCheck(cattleId, data) {
    return api(`/api/cattle/${encodeURIComponent(cattleId)}/pregnancy-checks`, { method: "POST", body: JSON.stringify(data) });
  }

  updateCheck(id, data) {
    return api(`/api/pregnancy-checks/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) });
  }

  removeCheck(id) {
    return api(`/api/pregnancy-checks/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
