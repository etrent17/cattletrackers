import { formatGender, formatHealthStatus } from "../utils/DateHelpers.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { withdrawalBadge } from "./TreatmentView.js";

export class DashboardView {
  renderStats(stats) {
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set("stat-total", stats.total);
    set("stat-calving", stats.calvingThisMonth);
    // stat-treatments is drawn by renderTreatmentsDue from the treatment schedule (feature 08).
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
        const genderHtml = formatGender(c.gender);

        return `
          <tr>
            <td><span class="badge badge-cow">${escapeHtml(c.tagNumber)}</span></td>
            <td class="fw-semibold">${escapeHtml(c.nameBreed || "Unnamed")} ${withdrawalBadge(c)}</td>
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

  // Scheduled Treatments card: open follow-ups that are overdue or due within the next 7 days
  // (TreatmentController). `null` while the schedule is not loaded or could not be loaded.
  renderTreatmentsDue(summary) {
    const valueEl = document.getElementById("stat-treatments");
    const noteEl = document.getElementById("stat-treatments-note");
    if (valueEl) valueEl.textContent = summary ? summary.scheduled : "—";
    if (noteEl) {
      noteEl.textContent = summary && summary.overdue
        ? `Due within 7 days, incl. ${summary.overdue} overdue`
        : "Due within 7 days, incl. overdue";
    }
  }

  // The dashboard alerts list. Each feature owns the alerts it passes as `source`; calling again
  // replaces that feature's alerts and leaves the others'. An alert is
  // { icon, title, detail, badge?, badgeClass?, cattleId?, buttonClass? }: with a cattle id it gets
  // a View button (class `buttonClass`, default `btn-view`, with the id in data-id and data-cattle-id).
  renderAlerts(source, alerts) {
    const listEl = document.getElementById("alerts-list");
    if (!listEl) return;
    for (const el of listEl.querySelectorAll("[data-alert-source]")) {
      if (el.dataset.alertSource === source) el.remove();
    }
    listEl.querySelector(".alerts-empty")?.remove();
    listEl.insertAdjacentHTML(
      "beforeend",
      alerts
        .map((a) => {
          const badge = a.badge ? `<span class="badge ${escapeHtml(a.badgeClass || "bg-secondary")} rounded-pill">${escapeHtml(a.badge)}</span>` : "";
          const button = a.cattleId
            ? `<button type="button" class="btn btn-sm btn-outline-secondary ${escapeHtml(a.buttonClass || "btn-view")}" data-id="${escapeHtml(a.cattleId)}" data-cattle-id="${escapeHtml(a.cattleId)}">View</button>`
            : "";
          return `
            <li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2" data-alert-source="${escapeHtml(source)}">
              <div>
                <i class="${escapeHtml(a.icon || "fas fa-exclamation-triangle text-warning")} me-2"></i>
                <strong>${escapeHtml(a.title)}</strong><br>
                <small class="text-muted">${escapeHtml(a.detail || "")}</small>
              </div>
              <div class="d-flex align-items-center gap-2">${badge}${button}</div>
            </li>`;
        })
        .join("")
    );
    if (!listEl.querySelector("[data-alert-source]")) {
      listEl.innerHTML = '<li class="list-group-item text-muted alerts-empty">No alerts.</li>';
    }
  }
}
