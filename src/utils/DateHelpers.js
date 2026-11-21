export function calculateAge(birthDate) {
  if (!birthDate) return "Unknown";

  const birth = new Date(birthDate);
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