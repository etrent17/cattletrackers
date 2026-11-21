// Performance and health reports: the two API calls, plus the pure helpers the pages use
// (labels, chart geometry, CSV tables). No DOM. Every figure comes from the server
// (routes/reports.js); nothing here recalculates a rate or an average.
import { api } from "./CattleService.js";
import { monthLabel, RANGE_PRESETS } from "./FinanceService.js";
import { TYPE_LABELS } from "./TreatmentService.js";
import { csvField } from "../utils/csv.js";
import { todayISO } from "../utils/DateHelpers.js";

export const TREATMENT_TYPES = Object.keys(TYPE_LABELS); // in the order the API lists them
export const GROUP_LABELS = { female: "Females", male: "Males", unknown: "Sex not recorded" };
export const OUTCOME_LABELS = { alive: "Alive", stillborn: "Stillborn", unknown: "Not recorded" };
export const EASE_LABELS = { unassisted: "Unassisted", assisted: "Assisted", caesarean: "Caesarean", unknown: "Not recorded" };
export const STATUS_LABELS = { under_treatment: "Under Treatment", quarantine: "In Quarantine" };

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return `?${search}`;
}

// `today` is sent so the server uses the user's calendar date, not its own (UTC).
export class ReportsService {
  performance({ from, to } = {}, today = todayISO()) {
    return api(`/api/reports/performance${query({ from, to, today })}`);
  }

  health({ from, to } = {}, today = todayISO()) {
    return api(`/api/reports/health${query({ from, to, today })}`);
  }
}

// ----- Labels -----------------------------------------------------------------------------------

// 50 -> "50%", 66.7 -> "66.7%", null -> "—".
export function formatPercent(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}%` : "—";
}

// 345 -> "345 days", 1 -> "1 day", null -> "—".
export function formatDays(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-US")} ${value === 1 ? "day" : "days"}`;
}

// 3 -> "3 animals", 1 -> "1 animal".
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "Last 12 months (2025-12-01 to 2026-11-30)", "All time", "From 2026-01-01", "Up to 2026-06-30".
export function periodLabel({ preset, from, to } = {}) {
  const dates = from && to ? `${from} to ${to}` : from ? `From ${from}` : to ? `Up to ${to}` : "All time";
  const name = preset && preset !== "custom" && preset !== "all" ? RANGE_PRESETS[preset] : "";
  return name ? `${name} (${dates})` : dates;
}

// "3 days overdue", "Due today", "Due in 16 days".
export function dueLabel(daysUntil) {
  if (daysUntil < 0) return daysUntil === -1 ? "1 day overdue" : `${-daysUntil} days overdue`;
  if (daysUntil === 0) return "Due today";
  return daysUntil === 1 ? "Due tomorrow" : `Due in ${daysUntil} days`;
}

// "Ends today", "1 day left", "5 days left".
export function daysLeftLabel(daysLeft) {
  if (daysLeft <= 0) return "Ends today";
  return daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
}

// "A-1 – Daisy" or "A-1".
export const animalLabel = (a) => (a.cattleName ? `${a.cattleTag} – ${a.cattleName}` : a.cattleTag);

// ----- Chart geometry -----------------------------------------------------------------------------

// A share of a whole as a rounded percentage, 0 when the whole is 0.
export function sharePercent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// The top of a count axis: the smallest of 1, 2, 5, 10, 20, 50, ... that is at least `max`
// (so the axis ends on a round number and a herd of 0 still has a scale).
export function niceCeiling(max) {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) if (step * power >= max) return step * power;
  return 10 * power;
}

// Geometry of a column chart for `values` (counts, >= 0) in a width x height viewBox.
// Returns { top, plot: { left, right, top, bottom }, bars: [{ index, x, y, width, height, value }] }.
// Columns share the plot width with a gap between them and are never wider than maxBarWidth.
export function columnChart(values, { width = 900, height = 220, left = 36, right = 12, top = 18, bottom = 24, maxBarWidth = 48 } = {}) {
  const plot = { left, right: width - right, top, bottom: height - bottom };
  const axisTop = niceCeiling(Math.max(0, ...values));
  const slot = values.length ? (plot.right - plot.left) / values.length : 0;
  const barWidth = Math.max(1, Math.min(maxBarWidth, slot - Math.min(4, slot * 0.25)));
  const bars = values.map((value, index) => {
    const barHeight = (Math.max(0, value) / axisTop) * (plot.bottom - plot.top);
    return {
      index,
      value,
      x: plot.left + slot * index + (slot - barWidth) / 2,
      y: plot.bottom - barHeight,
      width: barWidth,
      height: barHeight,
    };
  });
  return { top: axisTop, plot, bars };
}

// Which of `count` axis labels to draw so that at most `max` are shown: every n-th one, counted
// back from the last (the newest month is always labelled), so the labels are evenly spaced.
export function labelIndexes(count, max = 8) {
  const step = Math.max(1, Math.ceil(count / max));
  const indexes = [];
  for (let i = count - 1; i >= 0; i -= step) indexes.unshift(i);
  return indexes;
}

// ----- CSV ----------------------------------------------------------------------------------------

// Like toCsv(), but JavaScript numbers are written as they are: csvField() would put a quote in
// front of a negative number (its guard against spreadsheet formulas), turning -1.5 into text.
// Text still goes through csvField(). null and undefined become empty cells.
export function reportCsv(rows) {
  const cell = (value) => (typeof value === "number" && Number.isFinite(value) ? String(value) : csvField(value));
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

const breakdown = (title, labels, counts, total) =>
  Object.keys(labels).map((key) => [title, labels[key], counts[key], sharePercent(counts[key], total)]);

// One entry per exportable table: key -> { file, rows(report), current? }. `rows` returns the header row
// followed by the data rows, mirroring the table on the page.
export const PERFORMANCE_TABLES = {
  herd: {
    file: "herd-size",
    rows: (r) => [["Month", "Counted up to", "Animals added", "Herd size"], ...r.herd.byMonth.map((m) => [m.month, m.asOf, m.added, m.size])],
  },
  summary: {
    file: "performance-summary",
    rows: (r) => [
      ["Measure", "Value", "Unit"],
      ["Herd size now", r.herd.size, "animals"],
      ["Calvings in period", r.calvings.count, "calvings"],
      ["Cows that calved", r.calvings.cowsCalved, "cows"],
      ["Breeding-age females", r.calvings.breedingFemales, "animals"],
      ["Calving rate", r.calvings.calvingRate, "%"],
      ["Average birth weight", r.calvings.averageBirthWeight, "lbs"],
      ["Calving intervals measured", r.calvingInterval.intervals, "intervals"],
      ["Average calving interval", r.calvingInterval.averageDays, "days"],
      ["Shortest calving interval", r.calvingInterval.minDays, "days"],
      ["Longest calving interval", r.calvingInterval.maxDays, "days"],
      ["Breedings in period", r.breeding.breedings, "breedings"],
      ["Breedings with a pregnant or open check", r.breeding.checked, "breedings"],
      ["Checked pregnant", r.breeding.pregnant, "breedings"],
      ["Checked open", r.breeding.open, "breedings"],
      ["Conception rate", r.breeding.conceptionRate, "%"],
      ["Animals with a daily gain", r.dailyGain.animals, "animals"],
      ["Herd average daily gain", r.dailyGain.herdAverage, "lbs/day"],
    ],
  },
  calvings: {
    file: "calving-breakdown",
    rows: (r) => [
      ["Breakdown", "Category", "Calvings", "Share %"],
      ...breakdown("Outcome", OUTCOME_LABELS, r.calvings.byOutcome, r.calvings.count),
      ...breakdown("Ease", EASE_LABELS, r.calvings.byEase, r.calvings.count),
    ],
  },
  "gain-groups": {
    file: "daily-gain-by-group",
    rows: (r) => [
      ["Group", "Animals", "Average daily gain (lbs/day)"],
      ...r.dailyGain.byGroup.map((g) => [GROUP_LABELS[g.group] || g.group, g.animals, g.average]),
      ["Whole herd", r.dailyGain.animals, r.dailyGain.herdAverage],
    ],
  },
  gain: {
    file: "daily-gain-by-animal",
    rows: (r) => [
      ["Cow ID", "Name", "Group", "First weighing", "First weight (lbs)", "Last weighing", "Last weight (lbs)", "Days", "Gain (lbs)", "Daily gain (lbs/day)"],
      ...r.dailyGain.byAnimal.map((a) => [
        a.cattleTag, a.cattleName, GROUP_LABELS[a.group] || a.group, a.firstDate, a.firstWeight, a.lastDate, a.lastWeight, a.days, a.gain, a.dailyGain,
      ]),
    ],
  },
};

export const HEALTH_TABLES = {
  types: {
    file: "treatments-by-type",
    rows: (r) => [
      ["Type", "Treatments", "Animals", "Share %"],
      ...r.treatments.byType.map((t) => [TYPE_LABELS[t.type] || t.type, t.count, t.animals, sharePercent(t.count, r.treatments.count)]),
      ["Total", r.treatments.count, r.treatments.animals, r.treatments.count ? 100 : 0],
    ],
  },
  months: {
    file: "treatments-by-month",
    rows: (r) => [
      ["Month", ...TREATMENT_TYPES.map((t) => TYPE_LABELS[t]), "Total"],
      ...r.treatments.byMonth.map((m) => [m.month, ...TREATMENT_TYPES.map((t) => m[t]), m.total]),
    ],
  },
  attention: {
    current: true,
    file: "under-treatment-and-quarantine",
    rows: (r) => [
      ["Cow ID", "Name", "Status", "Current medications", "Last treatment date", "Last treatment type", "Last treatment product"],
      ...[["under_treatment", r.underTreatment], ["quarantine", r.quarantine]].flatMap(([status, list]) =>
        list.map((a) => [
          a.cattleTag, a.cattleName, STATUS_LABELS[status], a.medications, a.lastTreatmentDate, TYPE_LABELS[a.lastTreatmentType] || "", a.lastTreatmentProduct,
        ])
      ),
    ],
  },
  withdrawal: {
    current: true,
    file: "withdrawal-periods",
    rows: (r) => [
      ["Cow ID", "Name", "Withdrawal until", "Days left", "Product", "Date given"],
      ...r.withdrawal.map((w) => [w.cattleTag, w.cattleName, w.withdrawalUntil, w.daysLeft, w.product, w.dateGiven]),
    ],
  },
  "follow-ups": {
    current: true,
    file: "treatment-follow-ups",
    rows: (r) => [
      ["Cow ID", "Name", "Type", "Product", "Last given", "Next due", "Days until due", "Status"],
      ...[...r.followUps.overdue, ...r.followUps.upcoming].map((f) => [
        f.cattleTag, f.cattleName, TYPE_LABELS[f.type] || f.type, f.product, f.dateGiven, f.nextDueDate, f.daysUntil, f.daysUntil < 0 ? "Overdue" : "Upcoming",
      ]),
    ],
  },
};

// "herd-size-2026-01-01-to-2026-06-30.csv"; an open end uses "start" or today's date. A table
// marked `current` shows the herd as it is today, whatever the period: "withdrawal-periods-2026-06-15.csv".
export function csvFileName(table, { from, to } = {}, today = todayISO()) {
  if (table.current) return `${table.file}-${today}.csv`;
  return `${table.file}-${from || "start"}-to-${to || today}.csv`;
}

export { monthLabel };
