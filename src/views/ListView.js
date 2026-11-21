import { calculateAge, formatHealthStatus } from "../utils/DateHelpers.js";

export class ListView {
  renderList(cattleList, title = "All Cattle Records") {
    const titleEl = document.getElementById("list-title");
    const tbody = document.getElementById("list-body");
    const emptyEl = document.getElementById("list-empty");
    if (titleEl) {
      titleEl.innerHTML = `<i class="fas fa-cow me-2 text-success"></i>${title}`;
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
        const genderHtml =
          c.gender === "male"
            ? `<i class="fas fa-mars text-primary"></i> Male`
            : `<i class="fas fa-venus text-danger"></i> Female`;
        const calvingInfo =
          c.gender === "male"
            ? "N/A"
            : `Last: ${c.lastCalvingDate || "—"}<br><small class="text-muted">Due: ${c.expectedCalvingDate || "—"}</small>`;

        return `
          <tr>
            <td><span class="badge badge-cow">${c.tagNumber}</span></td>
            <td class="fw-semibold">${c.nameBreed || "Unnamed"}</td>
            <td>${genderHtml}</td>
            <td>${c.birthDate || "—"}<br><small class="text-muted">${calculateAge(c.birthDate)}</small></td>
            <td>${calvingInfo}</td>
            <td>${c.medications || "None"}</td>
            <td><span class="badge ${statusInfo.badgeClass}">${statusInfo.label}</span></td>
            <td>
              <button class="btn btn-sm btn-outline-primary btn-edit" data-id="${c.id}" title="Edit"><i class="fas fa-edit"></i></button>
              <button class="btn btn-sm btn-outline-info btn-view" data-id="${c.id}" title="View"><i class="fas fa-eye"></i></button>
              <button class="btn btn-sm btn-outline-danger btn-delete" data-id="${c.id}" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `;
      })
      .join("");
  }
}