// Parse a `YYYY-MM-DD` string as a local calendar date. `new Date("2026-03-01")`
// is UTC midnight, which is the previous day in timezones west of UTC.
export function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

// Today's local date as `YYYY-MM-DD`, comparable with the API's date strings.
export function todayISO(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function calculateAge(birthDate) {
  if (!birthDate) return "Unknown";

  const birth = parseLocalDate(birthDate);
  if (!birth) return "Unknown";
  const today = new Date();
  const months =
    (today.getFullYear() - birth.getFullYear()) * 12 +
    (today.getMonth() - birth.getMonth());

  if (months < 12) {
    return `${Math.max(0, months)} mos`;
  }

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  return remainingMonths > 0 ? `${years}y ${remainingMonths}m` : `${years} yrs`;
}

export function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString();
}

export function formatHealthStatus(status) {
  const statusMap = {
    healthy: { label: "Healthy", badgeClass: "bg-success" },
    under_treatment: { label: "Under Treatment", badgeClass: "bg-warning text-dark" },
    quarantine: { label: "In Quarantine", badgeClass: "bg-danger" },
    pregnant: { label: "Pregnant", badgeClass: "bg-info text-dark" },
  };
  return statusMap[status] || { label: status || "Healthy", badgeClass: "bg-secondary" };
}

// Gender as table/modal markup. A record saved without a gender shows "—".
export function formatGender(gender) {
  if (gender === "male") return `<i class="fas fa-mars text-primary"></i> Male`;
  if (gender === "female") return `<i class="fas fa-venus text-danger"></i> Female`;
  return `<span class="text-muted" title="Not recorded">—</span>`;
}
