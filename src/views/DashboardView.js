import { formatHealthStatus } from "../utils/DateHelpers.js";

export class DashboardView {
  renderStats(stats) {
    document.getElementById("stat-total-cattle").textContent = stats.total;
    document.getElementById("stat-calving-month").textContent = stats.calvingThisMonth;
    document.getElementById("stat-scheduled-treatments").textContent = stats.scheduledTreatments;
    document.getElementById("stat-healthy-animals").textContent = stats.healthy;
  }

  renderRecentTable(cattleList) {
    const tbody = document.getElementById("recent-cattle-tbody");
    if (!tbody) return;

    if (cattleList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No cattle records yet. Click "Add New Cow" to get started.</td></tr>`;
      return;
    }

    tbody.innerHTML = cattleList
      .map((c) => {
        const statusInfo = formatHealthStatus(c.healthStatus);
        const genderHtml =
          c.gender === "male"
            ? `<i class="fas fa-mars text-primary"></i> Male`
            : `<i class="fas fa-venus text-danger"></i> Female`;

        return `
          <tr>
            <td><span class="badge badge-cow">${c.tagNumber}</span></td>
            <td class="fw-semibold">${c.nameBreed || "Unnamed"}</td>
            <td>${genderHtml}</td>
            <td>${c.gender === "male" ? "N/A" : c.lastCalvingDate || "—"}</td>
            <td>${c.medications || "None"}</td>
            <td><span class="badge ${statusInfo.badgeClass}">${statusInfo.label}</span></td>
            <td>
              <button class="btn btn-sm btn-outline-primary btn-edit" data-id="${c.id}" title="Edit"><i class="fas fa-edit"></i></button>
              <button class="btn btn-sm btn-outline-info btn-view" data-id="${c.id}" title="View"><i class="fas fa-eye"></i></button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  renderEventsAndAlerts(allCattle) {
    const eventsEl = document.getElementById("upcoming-events-list");
    const alertsEl = document.getElementById("alerts-reminders-list");
    if (!eventsEl || !alertsEl) return;

    const upcomingCalvings = allCattle.filter((c) => c.expectedCalvingDate).slice(0, 3);
    eventsEl.innerHTML =
      upcomingCalvings.length > 0
        ? upcomingCalvings
            .map(
              (c) => `
              <li class="list-group-item d-flex justify-content-between align-items-center">
                <div>
                  <i class="fas fa-baby text-warning me-2"></i>
                  <strong>Calving Due</strong><br>
                  <small class="text-muted">${c.nameBreed} (${c.tagNumber})</small>
                </div>
                <span class="badge bg-warning text-dark rounded-pill">${c.expectedCalvingDate}</span>
              </li>`
            )
            .join("")
        : `<li class="list-group-item text-muted">No upcoming scheduled events.</li>`;

    const alerts = allCattle.filter(
      (c) => c.healthStatus !== "healthy" || !c.medications
    ).slice(0, 3);

    alertsEl.innerHTML =
      alerts.length > 0
        ? alerts
            .map((c) => {
              const isMedical = c.healthStatus === "under_treatment" || c.healthStatus === "quarantine";
              return `
                <li class="list-group-item">
                  <i class="fas ${isMedical ? "fa-exclamation-circle text-danger" : "fa-info-circle text-info"} me-2"></i>
                  <strong>${isMedical ? "Medical Attention Required" : "Record Check"}</strong><br>
                  <small class="text-muted">${c.nameBreed} (${c.tagNumber}) — ${c.notes || "Review status & medication log"}</small>
                </li>`;
            })
            .join("")
        : `<li class="list-group-item text-muted">All herd records are up to date.</li>`;
  }
}