import { calculateAge, formatGender, formatHealthStatus } from "../utils/DateHelpers.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { withdrawalBadge } from "./TreatmentView.js";

export class ListView {
  renderList(cattleList, title = "All Cattle Records") {
    const titleEl = document.getElementById("list-title");
    const tbody = document.getElementById("list-body");
    const emptyEl = document.getElementById("list-empty");
    if (titleEl) {
      titleEl.innerHTML = `<i class="fas fa-cow me-2 text-success"></i>${escapeHtml(title)}`;
    }
    if (!tbody) return;

    if (emptyEl) emptyEl.hidden = cattleList.length > 0;
    if (cattleList.length === 0) {
      tbody.innerHTML = "";
      return;
    }

    tbody.innerHTML = cattleList
      .map((c) => {
        const statusInfo = formatHealthStatus(c.healthStatus);
        const genderHtml = formatGender(c.gender);
        const calvingInfo =
          c.gender === "male"
            ? "N/A"
            : `Last: ${escapeHtml(c.lastCalvingDate || "—")}<br><small class="text-muted">Due: ${escapeHtml(c.expectedCalvingDate || "—")}</small>`;

        return `
          <tr>
            <td><span class="badge badge-cow">${escapeHtml(c.tagNumber)}</span></td>
            <td class="fw-semibold">${escapeHtml(c.nameBreed || "Unnamed")} ${withdrawalBadge(c)}${c.pendingSync ? ' <span class="badge text-bg-warning badge-pending-sync" title="Changed on this device; not sent to the server yet">Not synced</span>' : ""}</td>
            <td>${genderHtml}</td>
            <td>${escapeHtml(c.birthDate || "—")}<br><small class="text-muted">${escapeHtml(calculateAge(c.birthDate))}</small></td>
            <td>${calvingInfo}</td>
            <td>${escapeHtml(c.medications || "None")}</td>
            <td><span class="badge ${escapeHtml(statusInfo.badgeClass)}">${escapeHtml(statusInfo.label)}</span></td>
            <td>
              <button class="btn btn-sm btn-outline-primary btn-edit" data-id="${escapeHtml(c.id)}" title="Edit"><i class="fas fa-edit"></i></button>
              <button class="btn btn-sm btn-outline-info btn-view" data-id="${escapeHtml(c.id)}" title="View"><i class="fas fa-eye"></i></button>
              <button class="btn btn-sm btn-outline-danger btn-delete" data-id="${escapeHtml(c.id)}" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `;
      })
      .join("");
  }
}