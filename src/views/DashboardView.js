import { formatHealthStatus } from "../utils/DateHelpers.js";
import { escapeHtml } from "../utils/escapeHtml.js";

export class DashboardView {
  renderStats(stats) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set("stat-total", stats.total);
    set("stat-calving", stats.calvingThisMonth);
    set("stat-treatments", stats.scheduledTreatments);
    set("stat-healthy", stats.healthy);
  }

  renderRecentTable(cattleList) {
    const tbody = document.getElementById("recent-body");
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
            <td><span class="badge badge-cow">${escapeHtml(c.tagNumber)}</span></td>
            <td class="fw-semibold">${escapeHtml(c.nameBreed || "Unnamed")}</td>
            <td>${genderHtml}</td>
            <td>${c.gender === "male" ? "N/A" : escapeHtml(c.lastCalvingDate || "—")}</td>
            <td>${escapeHtml(c.medications || "None")}</td>
            <td><span class="badge ${escapeHtml(statusInfo.badgeClass)}">${escapeHtml(statusInfo.label)}</span></td>
            <td>
              <button class="btn btn-sm btn-outline-primary btn-edit" data-id="${escapeHtml(c.id)}" title="Edit"><i class="fas fa-edit"></i></button>
              <button class="btn btn-sm btn-outline-info btn-view" data-id="${escapeHtml(c.id)}" title="View"><i class="fas fa-eye"></i></button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  // `upcomingCalvings` is already filtered to future dates and sorted (CattleService.getUpcomingCalvings).
  renderUpcomingEvents(upcomingCalvings) {
    const eventsEl = document.getElementById("events-list");
    if (!eventsEl) return;

    eventsEl.innerHTML =
      upcomingCalvings.length > 0
        ? upcomingCalvings
            .map(
              (c) => `
              <li class="list-group-item d-flex justify-content-between align-items-center">
                <div>
                  <i class="fas fa-baby text-warning me-2"></i>
                  <strong>Calving Due</strong><br>
                  <small class="text-muted">${escapeHtml(c.nameBreed || "Unnamed")} (${escapeHtml(c.tagNumber)})</small>
                </div>
                <span class="badge bg-warning text-dark rounded-pill">${escapeHtml(c.expectedCalvingDate)}</span>
              </li>`
            )
            .join("")
        : `<li class="list-group-item text-muted">No upcoming calvings.</li>`;
  }
}
