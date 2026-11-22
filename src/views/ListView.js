import { calculateAge, formatGender, formatHealthStatus } from "../utils/DateHelpers.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { withdrawalBadge } from "./TreatmentView.js";

export class ListView {
  renderList(cattleList, title = "All Cattle Records", { total = cattleList.length, filtered = false } = {}) {
    const titleEl = document.getElementById("list-title");
    const tbody = document.getElementById("list-body");
    const emptyEl = document.getElementById("list-empty");
    const countEl = document.getElementById("cattle-list-count");
    const resetBtn = document.getElementById("cattle-reset-filters");
    if (titleEl) {
      titleEl.innerHTML = `<i class="fas fa-cow me-2 text-success" aria-hidden="true"></i>${escapeHtml(title)}`;
    }
    if (countEl) {
      countEl.textContent = filtered ? `${cattleList.length} of ${total}` : `${total} ${total === 1 ? "animal" : "animals"}`;
    }
    if (resetBtn) resetBtn.hidden = !filtered;
    if (!tbody) return;

    if (emptyEl) {
      emptyEl.hidden = cattleList.length > 0;
      emptyEl.textContent = filtered && total > 0
        ? "No animals match your search or status filter."
        : "No cattle records yet. Click \"Add Animal\" to add your first one.";
    }
    if (cattleList.length === 0) {
      tbody.innerHTML = "";
      return;
    }

    tbody.innerHTML = cattleList
      .map((c) => {
        const statusInfo = formatHealthStatus(c.healthStatus);
        const genderHtml = formatGender(c.gender);
        const label = c.nameBreed ? `${c.tagNumber} ${c.nameBreed}` : c.tagNumber;
        const calvingInfo =
          c.gender === "male"
            ? "N/A"
            : `Last: ${escapeHtml(c.lastCalvingDate || "—")}<br><small class="text-muted">Due: ${escapeHtml(c.expectedCalvingDate || "—")}</small>`;

        return `
          <tr>
            <td data-label="Cow ID"><span class="badge badge-cow">${escapeHtml(c.tagNumber)}</span></td>
            <td data-label="Name / Breed" class="fw-semibold">${escapeHtml(c.nameBreed || "Unnamed")} ${withdrawalBadge(c)}${c.pendingSync ? ' <span class="badge text-bg-warning badge-pending-sync" title="Changed on this device; not sent to the server yet">Not synced</span>' : ""}</td>
            <td data-label="Gender">${genderHtml}</td>
            <td data-label="Birth / Age"><span>${escapeHtml(c.birthDate || "—")}<br><small class="text-muted">${escapeHtml(calculateAge(c.birthDate))}</small></span></td>
            <td data-label="Calving"><span>${calvingInfo}</span></td>
            <td data-label="Medications">${escapeHtml(c.medications || "None")}</td>
            <td data-label="Status"><span class="badge ${escapeHtml(statusInfo.badgeClass)}">${escapeHtml(statusInfo.label)}</span></td>
            <td class="cell-actions text-nowrap">
              <button class="btn btn-sm btn-outline-info btn-view" data-id="${escapeHtml(c.id)}" title="View" aria-label="View ${escapeHtml(label)}"><i class="fas fa-eye" aria-hidden="true"></i></button>
              <button class="btn btn-sm btn-outline-primary btn-edit" data-id="${escapeHtml(c.id)}" title="Edit" aria-label="Edit ${escapeHtml(label)}"><i class="fas fa-edit" aria-hidden="true"></i></button>
              <button class="btn btn-sm btn-outline-danger btn-delete" data-id="${escapeHtml(c.id)}" title="Delete" aria-label="Delete ${escapeHtml(label)}"><i class="fas fa-trash" aria-hidden="true"></i></button>
            </td>
          </tr>
        `;
      })
      .join("");
  }
}
