// Treatments (medical records): API calls plus the pure helpers the Medical Records page, the
// cow details tab and the dashboard use (labels, form checks, filtering, due dates, withdrawal).
// Follows the calving template; see "Event records pattern" in docs/architecture-and-data.md.
//
// Every date here is a local calendar date, `YYYY-MM-DD`, compared with todayISO(). Helpers
// take `today` as a parameter (default: the browser's date) so tests can fix it.
import { api } from "./CattleService.js";
import { parseLocalDate, todayISO } from "../utils/DateHelpers.js";

export const TYPE_LABELS = { treatment: "Treatment", vaccination: "Vaccination", vet_visit: "Vet visit", other: "Other" };
export const ROUTE_SUGGESTIONS = ["Intramuscular", "Subcutaneous", "Intravenous", "Oral", "Topical", "Pour-on", "Intramammary", "Intranasal"];

// The dashboard's "Scheduled Treatments": open follow-ups due today or within this many days,
// plus the overdue ones (which are also shown as alerts).
export const DUE_WINDOW_DAYS = 7;

const TEXT_LIMITS = [["product", 100, "Product"], ["dose", 50, "Dose"], ["route", 50, "Route"], ["givenBy", 100, "Given by"]];

// Turns the form's strings into the request body: trimmed text, dates as typed.
export function treatmentPayload(form) {
  const text = (v) => String(v ?? "").trim();
  return {
    dateGiven: form.dateGiven || "",
    type: form.type || "",
    product: text(form.product),
    dose: text(form.dose),
    route: text(form.route),
    givenBy: text(form.givenBy),
    nextDueDate: form.nextDueDate || "",
    withdrawalUntil: form.withdrawalUntil || "",
    notes: text(form.notes),
  };
}

// Checks a payload before it is sent. Returns the message to show, or null when it is fine.
// The server applies the same rules; this only saves a round trip.
export function validateTreatment(data, today = todayISO()) {
  if (!parseLocalDate(data.dateGiven)) return "Enter the treatment date";
  if (data.dateGiven > today) return "The treatment date cannot be in the future";
  if (!TYPE_LABELS[data.type]) return "Choose a treatment type";
  for (const [field, max, label] of TEXT_LIMITS) {
    if (data[field].length > max) return `${label} must be at most ${max} characters`;
  }
  if (data.nextDueDate) {
    if (!parseLocalDate(data.nextDueDate)) return "Enter a valid next due date";
    if (data.nextDueDate <= data.dateGiven) return "The next due date must be after the date given";
  }
  if (data.withdrawalUntil) {
    if (!parseLocalDate(data.withdrawalUntil)) return "Enter a valid withdrawal date";
    if (data.withdrawalUntil < data.dateGiven) return "The withdrawal date cannot be before the date given";
  }
  if (data.notes.length > 2000) return "Notes are too long";
  return null;
}

// Narrows a list of treatments by free text (cow number or name, product, given by, notes) and
// type. Empty or "all" means no filter. Order is kept.
export function filterTreatments(list, { query = "", type = "all" } = {}) {
  const term = query.toLowerCase().trim();
  return list.filter((t) => {
    if (type !== "all" && t.type !== type) return false;
    if (!term) return true;
    return [t.cattleTag, t.cattleName, t.product, t.givenBy, t.notes].some((v) => (v || "").toLowerCase().includes(term));
  });
}

// Whole calendar days from `today` to a date (0 = today, negative = past); null if not a date.
export function daysFromToday(dateStr, today = todayISO()) {
  const date = parseLocalDate(dateStr);
  const from = parseLocalDate(today);
  if (!date || !from) return null;
  return Math.round((date - from) / 86400000); // rounding absorbs daylight-saving hours
}

// Where a next due date stands: { state, days, label }. state is "overdue", "today", "soon"
// (within DUE_WINDOW_DAYS) or "later"; null when there is no valid date.
export function dueStatus(nextDueDate, today = todayISO()) {
  const days = daysFromToday(nextDueDate, today);
  if (days === null) return null;
  if (days < 0) return { state: "overdue", days, label: days === -1 ? "1 day overdue" : `${-days} days overdue` };
  if (days === 0) return { state: "today", days, label: "Due today" };
  const label = days === 1 ? "Due tomorrow" : `Due in ${days} days`;
  return { state: days <= DUE_WINDOW_DAYS ? "soon" : "later", days, label };
}

// Splits the open follow-ups (GET /api/treatments/due) for the page and the dashboard.
// `scheduled` is the dashboard figure: overdue plus due within the window (today included).
export function summarizeDue(due, today = todayISO()) {
  const overdue = [];
  const upcoming = []; // today and within the window
  const later = [];
  for (const t of due) {
    const status = dueStatus(t.nextDueDate, today);
    if (!status) continue;
    if (status.state === "overdue") overdue.push(t);
    else if (status.state === "later") later.push(t);
    else upcoming.push(t);
  }
  return { overdue, upcoming, later, scheduled: overdue.length + upcoming.length };
}

// True while an animal's meat/milk withdrawal period is running: its latest withdrawal date
// (cattle.withdrawalUntil) is today or later. The last day itself still counts.
export function inWithdrawal(cow, today = todayISO()) {
  return Boolean(cow && parseLocalDate(cow.withdrawalUntil) && cow.withdrawalUntil >= today);
}

// Animals in a withdrawal period, the one whose period ends first at the top.
export function animalsInWithdrawal(cattle, today = todayISO()) {
  return cattle
    .filter((c) => inWithdrawal(c, today))
    .sort((a, b) => a.withdrawalUntil.localeCompare(b.withdrawalUntil) || a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true }));
}

// Form values for recording the follow-up of an open treatment: same animal, type, product,
// dose, route and person, given today. Saving it closes the earlier schedule (see routes/treatments.js).
export function followUpDraft(treatment, today = todayISO()) {
  return {
    cattleId: treatment.cattleId,
    dateGiven: today,
    type: treatment.type,
    product: treatment.product,
    dose: treatment.dose,
    route: treatment.route,
    givenBy: treatment.givenBy,
    nextDueDate: "",
    withdrawalUntil: "",
    notes: "",
  };
}

// Distinct products used before, for the product suggestions in the form.
export function productSuggestions(list) {
  const seen = new Map();
  for (const t of list) {
    const p = (t.product || "").trim();
    if (p && !seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export class TreatmentService {
  constructor() {
    this.treatments = []; // the whole herd's treatments, newest first, as last loaded
    this.due = []; // open follow-ups, soonest first, as last loaded
    this.dueLoaded = false;
  }

  async loadAll() {
    this.treatments = await api("/api/treatments");
    return this.treatments;
  }

  async loadDue() {
    this.due = await api("/api/treatments/due");
    this.dueLoaded = true;
    return this.due;
  }

  // One animal's history, newest first. Always fetched, so the details tab is never stale.
  loadForCattle(cattleId) {
    return api(`/api/cattle/${encodeURIComponent(cattleId)}/treatments`);
  }

  add(cattleId, data) {
    return api(`/api/cattle/${encodeURIComponent(cattleId)}/treatments`, { method: "POST", body: JSON.stringify(data) });
  }

  update(id, data) {
    return api(`/api/treatments/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) });
  }

  remove(id) {
    return api(`/api/treatments/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
