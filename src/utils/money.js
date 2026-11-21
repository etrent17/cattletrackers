// Money helpers. The API sends amounts as decimal strings ("1234.50"). To stay exact,
// amounts are turned into whole cents (integers) before any arithmetic, never added as
// floating-point numbers (0.1 + 0.2 !== 0.3).

// What the API accepts: up to 10 digits, optionally a point and 1 or 2 decimals.
const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;

// True for an amount the API will accept: the format above and greater than zero.
export function isValidAmount(value) {
  const text = String(value ?? "").trim();
  return AMOUNT_RE.test(text) && toCents(text) > 0;
}

// "12.3" -> 1230, "-0.05" -> -5, 7 -> 700. NaN when the value is not a plain decimal
// with at most two decimal places.
export function toCents(value) {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? "").trim());
  if (!match) return NaN;
  const cents = Number(match[2]) * 100 + Number((match[3] || "").padEnd(2, "0"));
  return match[1] && cents !== 0 ? -cents : cents;
}

// 1230 -> "12.30", -5 -> "-0.05".
export function centsToAmount(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// Sum of decimal-string amounts, in cents.
export function sumCents(amounts) {
  return amounts.reduce((total, amount) => total + toCents(amount), 0);
}

// "1234567.8" -> "$1,234,567.80", "-5" -> "-$5.00". Accepts a decimal string or number
// of currency units. Returns "—" for anything that is not an amount.
export function formatMoney(amount) {
  const cents = toCents(amount);
  if (Number.isNaN(cents)) return "—";
  return formatCents(cents);
}

export function formatCents(cents) {
  const [whole, fraction] = centsToAmount(Math.abs(cents)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "-" : ""}$${grouped}.${fraction}`;
}
