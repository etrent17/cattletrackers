import { api } from "./CattleService.js";
import { toCsv } from "../utils/csv.js";
import { sumCents } from "../utils/money.js";
import { todayISO } from "../utils/DateHelpers.js";

// Suggested categories in the transaction form. The API accepts any category of
// 1 to 50 characters, so this list can become editable later.
export const DEFAULT_CATEGORIES = [
  "Feed",
  "Vet and medicine",
  "Breeding",
  "Equipment",
  "Labour",
  "Sale of animals",
  "Milk",
  "Other",
];

export const RANGE_PRESETS = {
  "12m": "Last 12 months",
  month: "This month",
  year: "This year",
  "last-year": "Last year",
  all: "All time",
  custom: "Custom range",
};

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

// API calls for /api/transactions. Errors are those of CattleService's api():
// they carry `status` and `sessionExpired`.
export class FinanceService {
  list({ from, to, cattleId } = {}) {
    return api(`/api/transactions${query({ from, to, cattleId })}`);
  }

  summary({ from, to } = {}) {
    return api(`/api/transactions/summary${query({ from, to })}`);
  }

  create(data) {
    return api("/api/transactions", { method: "POST", body: JSON.stringify(data) });
  }

  update(id, data) {
    return api(`/api/transactions/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) });
  }

  remove(id) {
    return api(`/api/transactions/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}

// The from/to dates (YYYY-MM-DD, local calendar) of a preset; "" means unbounded.
// "Last 12 months" is the current month and the 11 before it.
export function presetRange(preset, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (year, month, day) => todayISO(new Date(year, month, day));
  const endOfMonth = iso(y, m + 1, 0);
  switch (preset) {
    case "month":
      return { from: iso(y, m, 1), to: endOfMonth };
    case "year":
      return { from: iso(y, 0, 1), to: iso(y, 11, 31) };
    case "last-year":
      return { from: iso(y - 1, 0, 1), to: iso(y - 1, 11, 31) };
    case "all":
      return { from: "", to: "" };
    case "12m":
    default:
      return { from: iso(y, m - 11, 1), to: endOfMonth };
  }
}

// Income, expenses and net of a list of transactions, in whole cents.
export function totalsInCents(transactions) {
  const income = sumCents(transactions.filter((t) => t.kind === "income").map((t) => t.amount));
  const expenses = sumCents(transactions.filter((t) => t.kind === "expense").map((t) => t.amount));
  return { income, expenses, net: income - expenses };
}

export function transactionsToCsv(transactions) {
  const header = ["Date", "Type", "Category", "Amount", "Animal", "Description"];
  const rows = transactions.map((t) => [
    t.date,
    t.kind === "income" ? "Income" : "Expense",
    t.category,
    t.amount,
    t.cattleTagNumber || "",
    t.description || "",
  ]);
  return toCsv([header, ...rows]);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-03" -> "Mar 2026"
export function monthLabel(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month || "");
  return match ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : String(month ?? "");
}
