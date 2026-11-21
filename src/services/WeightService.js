// Weighings (feature 10): API calls plus the pure helpers the Weights page and the cow details tab
// use: form checks, average daily gain (ADG), batch rows, filtering and chart geometry. No DOM.
// Weights are in lbs; ADG is lbs per day.
import { api } from "./CattleService.js";
import { parseLocalDate, todayISO } from "../utils/DateHelpers.js";

export const MIN_WEIGHT = 0.01;
export const MAX_WEIGHT = 5000;
export const MAX_NOTES = 2000;

// Same rule as the server (lib/weights.js): a number from 0.01 to 5000.
export function isValidWeight(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= MIN_WEIGHT && n <= MAX_WEIGHT;
}

// Turns the form's strings into the request body.
export function weighingPayload(form) {
  const weight = String(form.weight ?? "").trim();
  return {
    date: form.date || "",
    weight: weight === "" ? null : Number(weight),
    notes: (form.notes || "").trim(),
  };
}

// A real calendar date as `YYYY-MM-DD` (2026-02-30 is not, though Date would roll it over).
export function isCalendarDate(value) {
  const date = parseLocalDate(value);
  return Boolean(date) && todayISO(date) === value;
}

// Checks a payload before it is sent. Returns the message to show, or null when it is fine.
export function validateWeighing(data, today = todayISO()) {
  if (!isCalendarDate(data.date)) return "Enter the weighing date";
  if (data.date > today) return "The weighing date cannot be in the future";
  if (data.weight === null) return "Enter the weight";
  if (!isValidWeight(data.weight)) return "Weight must be more than 0 and at most 5000 lbs";
  if (data.notes.length > MAX_NOTES) return "Notes are too long";
  return null;
}

// Whole days from one `YYYY-MM-DD` to another (negative when `to` is earlier); null if not dates.
// Rounded, so a daylight-saving change in between does not cost a day.
export function daysBetween(from, to) {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

// Oldest first: by date, then by when it was recorded (the same order the server uses for the
// current weight, reversed).
export function oldestFirst(weighings) {
  return [...weighings].sort(
    (a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id))
  );
}

// Gain from one weighing to the next: { from, to, days, gain, adg }. `adg` (lbs/day) is null when
// both are on the same day, since a daily rate over zero days means nothing.
export function gainBetween(from, to) {
  const days = daysBetween(from.date, to.date);
  const gain = round2(to.weight - from.weight);
  return { from, to, days, gain, adg: days > 0 ? gain / days : null };
}

// One animal's consecutive gains, oldest first (one fewer than the weighings).
export function gainSegments(weighings) {
  const sorted = oldestFirst(weighings);
  return sorted.slice(1).map((w, i) => gainBetween(sorted[i], w));
}

// ADG between the first and the last weighing, or null with fewer than two weighings or when they
// are all on one day.
export function averageDailyGain(weighings) {
  if (weighings.length < 2) return null;
  const sorted = oldestFirst(weighings);
  const result = gainBetween(sorted[0], sorted[sorted.length - 1]);
  return result.adg === null ? null : result;
}

// For a list that mixes animals (the herd-wide table): weighing id -> its gain since the same
// animal's previous weighing ({ days, gain, adg }). An animal's first weighing has no entry.
export function changesSincePrevious(weighings) {
  const byAnimal = new Map();
  for (const w of weighings) {
    if (!byAnimal.has(w.cattleId)) byAnimal.set(w.cattleId, []);
    byAnimal.get(w.cattleId).push(w);
  }
  const changes = new Map();
  for (const list of byAnimal.values()) {
    for (const segment of gainSegments(list)) changes.set(segment.to.id, segment);
  }
  return changes;
}

const round2 = (n) => Math.round(n * 100) / 100;

// "1,234.5 lbs"
export function formatWeight(weight) {
  if (weight === null || weight === undefined || weight === "") return "—";
  return `${Number(weight).toLocaleString("en-US", { maximumFractionDigits: 2 })} lbs`;
}

// "+12.5 lbs", "−3 lbs", "0 lbs"
export function formatGain(gain) {
  if (gain === null || gain === undefined) return "—";
  const sign = gain > 0 ? "+" : gain < 0 ? "−" : "";
  return `${sign}${Math.abs(gain).toLocaleString("en-US", { maximumFractionDigits: 2 })} lbs`;
}

// "+2.41 lbs/day", "−0.50 lbs/day"; "—" when there is no rate (same day, or one weighing).
export function formatAdg(adg) {
  if (adg === null || adg === undefined || !Number.isFinite(adg)) return "—";
  const value = Math.round(adg * 100) / 100;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)} lbs/day`;
}

// Narrows the herd-wide list by free text (cow number or name, notes). Order is kept.
export function filterWeighings(weighings, { query = "" } = {}) {
  const term = query.toLowerCase().trim();
  if (!term) return weighings;
  return weighings.filter((w) => [w.cattleTag, w.cattleName, w.notes].some((v) => (v || "").toLowerCase().includes(term)));
}

// Sorts the batch form's rows into what to send. `rows` are { cattleId, weight, notes } as typed
// (strings), in screen order. Blank rows (nothing typed or chosen) are skipped; rows that cannot be
// saved are reported by position, the same way the server reports its own failures.
// Returns { send: [{ position, cattleId, weight, notes }], invalid: [{ position, error }] }.
export function batchRows(rows) {
  const send = [];
  const invalid = [];
  const seen = new Set();
  rows.forEach((row, position) => {
    const cattleId = row.cattleId || "";
    const weightText = String(row.weight ?? "").trim();
    const notes = (row.notes || "").trim();
    if (!cattleId && !weightText && !notes) return;
    let error = null;
    if (!cattleId) error = "Choose an animal";
    else if (!weightText) error = "Enter the weight";
    else if (!isValidWeight(weightText)) error = "Weight must be more than 0 and at most 5000 lbs";
    else if (notes.length > MAX_NOTES) error = "Notes are too long";
    else if (seen.has(cattleId)) error = "This animal is already in the batch";
    if (error) {
      invalid.push({ position, error });
      return;
    }
    seen.add(cattleId);
    send.push({ position, cattleId, weight: Number(weightText), notes });
  });
  return { send, invalid };
}

// Geometry for the weight chart: weighings oldest first placed on a width x height box, x by date
// and y by weight, inside `pad`. Returns null without weighings. The y range is padded so the line
// does not touch the edges, and widened to at least 20 lbs so a flat line sits mid-chart.
export function chartGeometry(weighings, { width = 600, height = 220, pad = { top: 16, right: 20, bottom: 30, left: 56 } } = {}) {
  if (!weighings.length) return null;
  const sorted = oldestFirst(weighings);
  const first = sorted[0].date;
  const span = daysBetween(first, sorted[sorted.length - 1].date) || 0;
  const weights = sorted.map((w) => w.weight);
  let min = Math.min(...weights);
  let max = Math.max(...weights);
  const margin = Math.max((max - min) * 0.1, 10);
  min = Math.max(0, min - margin);
  max += margin;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (date) => (span === 0 ? pad.left + innerW / 2 : pad.left + (daysBetween(first, date) / span) * innerW);
  const y = (weight) => pad.top + (1 - (weight - min) / (max - min)) * innerH;
  return {
    width, height, pad, min, max,
    points: sorted.map((w) => ({ x: round2(x(w.date)), y: round2(y(w.weight)), weighing: w })),
    yTicks: [min, (min + max) / 2, max].map((value) => ({ value, y: round2(y(value)) })),
  };
}

export class WeightService {
  constructor() {
    this.weighings = []; // the whole herd's weighings, newest first, as last loaded
  }

  async loadAll() {
    this.weighings = await api("/api/weighings");
    return this.weighings;
  }

  // One animal's history, newest first. Always fetched, so the details tab is never stale.
  loadForCattle(cattleId) {
    return api(`/api/cattle/${encodeURIComponent(cattleId)}/weighings`);
  }

  add(cattleId, data) {
    return api(`/api/cattle/${encodeURIComponent(cattleId)}/weighings`, { method: "POST", body: JSON.stringify(data) });
  }

  update(id, data) {
    return api(`/api/weighings/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) });
  }

  remove(id) {
    return api(`/api/weighings/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  // rows: [{ cattleId, weight, notes }]. Resolves to { date, saved: [{ index, weighing }],
  // failed: [{ index, cattleId, error }] }, `index` being the position in `rows`.
  saveBatch(date, rows) {
    return api("/api/weighings/batch", { method: "POST", body: JSON.stringify({ date, rows }) });
  }
}
