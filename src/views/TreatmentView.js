// Rendering for medical records: the Medical Records page (#view-medical), the "Treatments" tab
// of the cow details modal, the record/edit form (#treatmentModal), and the withdrawal badge used
// in the cattle tables. Every value from a record goes through escapeHtml().
import { escapeHtml } from "../utils/escapeHtml.js";
import { todayISO } from "../utils/DateHelpers.js";
import { ROUTE_SUGGESTIONS, TYPE_LABELS, dueStatus, inWithdrawal } from "../services/TreatmentService.js";

const TYPE_ICONS = { treatment: "fa-pills", vaccination: "fa-syringe", vet_visit: "fa-user-md", other: "fa-notes-medical" };
const DUE_BADGES = { overdue: "bg-danger", today: "bg-warning text-dark", soon: "bg-warning text-dark", later: "bg-light text-dark border" };

const typeLabel = (type) => TYPE_LABELS[type] || type || "—";

// What a treatment was, in a few words: the product, or the type when no product was recorded.
export const treatmentTitle = (t) => t.product || typeLabel(t.type);

// A red badge for an animal whose withdrawal period is running, or "" when there is none.
export function withdrawalBadge(cow, today = todayISO()) {
  if (!inWithdrawal(cow, today)) return "";
  return `<span class="badge bg-danger badge-withdrawal" title="Meat and milk withdrawal period: do not sell or use until after this date"><i class="fas fa-ban me-1"></i>Withdrawal until ${escapeHtml(cow.withdrawalUntil)}</span>`;
}

function dueBadge(nextDueDate, today) {
  const status = dueStatus(nextDueDate, today);
  if (!status) return "";
  return `<span class="badge ${DUE_BADGES[status.state]} rounded-pill">${escapeHtml(status.label)}</span>`;
}

// The Next Due cell: the date, with its status while the follow-up is open (`open` holds the ids
// from GET /api/treatments/due) or "Done" once a later treatment of the series was recorded.
function nextDueCell(t, open, today) {
  if (!t.nextDueDate) return "—";
  const status = open.has(t.id) ? dueBadge(t.nextDueDate, today) : `<span class="badge bg-light text-muted border">Done</span>`;
  return `${escapeHtml(t.nextDueDate)}<br>${status}`;
}

function withdrawalCell(t, today) {
  if (!t.withdrawalUntil) return "—";
  const running = t.withdrawalUntil >= today ? ` <span class="badge bg-danger">Running</span>` : "";
  return `${escapeHtml(t.withdrawalUntil)}${running}`;
}

function productCell(t) {
  const details = [t.dose, t.route].filter(Boolean).map(escapeHtml).join(" · ");
  return `${escapeHtml(t.product || "—")}${details ? `<br><small class="text-muted">${details}</small>` : ""}`;
}

function treatmentRow(t, { showCow, open, today }) {
  const cowCell = showCow
    ? `<td><span class="badge badge-cow">${escapeHtml(t.cattleTag)}</span> <span class="fw-semibold">${escapeHtml(t.cattleName || "Unnamed")}</span></td>`
    : "";
  const viewBtn = showCow
    ? `<button class="btn btn-sm btn-outline-info btn-treatment-open" data-cattle-id="${escapeHtml(t.cattleId)}" title="View animal" aria-label="View animal"><i class="fas fa-eye" aria-hidden="true"></i></button>`
    : "";
  return `
    <tr data-treatment-id="${escapeHtml(t.id)}">
      <td class="text-nowrap">${escapeHtml(t.dateGiven)}</td>
      ${cowCell}
      <td class="text-nowrap"><i class="fas ${TYPE_ICONS[t.type] || "fa-notes-medical"} text-success me-1"></i>${escapeHtml(typeLabel(t.type))}</td>
      <td>${productCell(t)}</td>
      <td>${escapeHtml(t.givenBy || "—")}</td>
      <td class="text-nowrap">${nextDueCell(t, open, today)}</td>
      <td class="text-nowrap">${withdrawalCell(t, today)}</td>
      <td class="treatment-notes">${escapeHtml(t.notes || "")}</td>
      <td class="text-nowrap">
        ${viewBtn}
        <button class="btn btn-sm btn-outline-primary btn-treatment-edit" data-id="${escapeHtml(t.id)}" title="Edit treatment" aria-label="Edit treatment"><i class="fas fa-edit" aria-hidden="true"></i></button>
        <button class="btn btn-sm btn-outline-danger btn-treatment-delete" data-id="${escapeHtml(t.id)}" title="Delete treatment" aria-label="Delete treatment"><i class="fas fa-trash" aria-hidden="true"></i></button>
      </td>
    </tr>`;
}

export class TreatmentView {
  // The herd-wide history table. `total` is the unfiltered count, for the "x of y" line.
  renderTable(list, total, open, today = todayISO()) {
    const tbody = document.getElementById("treatment-body");
    const emptyEl = document.getElementById("treatment-empty");
    const countEl = document.getElementById("treatment-count");
    if (!tbody) return;
    tbody.innerHTML = list.map((t) => treatmentRow(t, { showCow: true, open, today })).join("");
    if (emptyEl) {
      emptyEl.hidden = list.length > 0;
      emptyEl.textContent = total === 0
        ? 'No treatments recorded yet. Click "Record Treatment" to add the first one.'
        : "No treatments match these filters.";
    }
    if (countEl) countEl.textContent = total === 0 ? "" : `Showing ${list.length} of ${total}`;
  }

  // Open follow-ups, soonest first: overdue, due soon and later, each with its status.
  renderDue(due, today = todayISO()) {
    const listEl = document.getElementById("treatment-due");
    if (!listEl) return;
    listEl.innerHTML = due.length
      ? due.map((t) => `
          <li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2" data-treatment-id="${escapeHtml(t.id)}">
            <div>
              <span class="badge badge-cow">${escapeHtml(t.cattleTag)}</span>
              <span class="fw-semibold">${escapeHtml(t.cattleName || "Unnamed")}</span>
              · ${escapeHtml(typeLabel(t.type))}: <span class="fw-semibold">${escapeHtml(treatmentTitle(t))}</span><br>
              <small class="text-muted">Next due ${escapeHtml(t.nextDueDate)} · last given ${escapeHtml(t.dateGiven)}</small>
            </div>
            <div class="d-flex align-items-center gap-2">
              ${dueBadge(t.nextDueDate, today)}
              <button type="button" class="btn btn-sm btn-outline-success btn-treatment-followup" data-id="${escapeHtml(t.id)}">Record follow-up</button>
            </div>
          </li>`).join("")
      : `<li class="list-group-item text-muted">No upcoming or overdue treatments.</li>`;
  }

  renderDueError(message) {
    const listEl = document.getElementById("treatment-due");
    if (!listEl) return;
    listEl.innerHTML = `<li class="list-group-item text-danger"></li>`;
    listEl.firstElementChild.textContent = `Couldn't load upcoming treatments. ${message}`;
  }

  // Animals whose withdrawal period is running, the one that ends first at the top.
  renderWithdrawals(cattle) {
    const listEl = document.getElementById("treatment-withdrawals");
    if (!listEl) return;
    listEl.innerHTML = cattle.length
      ? cattle.map((c) => `
          <li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2">
            <div><span class="badge badge-cow">${escapeHtml(c.tagNumber)}</span> <span class="fw-semibold">${escapeHtml(c.nameBreed || "Unnamed")}</span></div>
            <div class="d-flex align-items-center gap-2">
              ${withdrawalBadge(c)}
              <button type="button" class="btn btn-sm btn-outline-info btn-treatment-open" data-cattle-id="${escapeHtml(c.id)}">View</button>
            </div>
          </li>`).join("")
      : `<li class="list-group-item text-muted">No animals are in a withdrawal period.</li>`;
  }

  getFilters() {
    return {
      query: document.getElementById("treatment-search")?.value || "",
      type: document.getElementById("treatment-filter-type")?.value || "all",
    };
  }

  // ----- Cow details tab -----

  renderHistoryLoading(pane) {
    pane.innerHTML = `<p class="text-muted mb-0">Loading treatments…</p>`;
  }

  renderHistoryError(pane, message) {
    pane.innerHTML = `<p class="text-danger mb-0"></p>`;
    pane.firstElementChild.textContent = `Couldn't load the treatments. ${message}`;
  }

  renderHistory(pane, cow, list, open, today = todayISO()) {
    const table = list.length
      ? `<div class="table-responsive">
          <table class="table table-sm align-middle">
            <thead><tr><th>Date</th><th>Type</th><th>Product</th><th>Given By</th><th>Next Due</th><th>Withdrawal Until</th><th>Notes</th><th>Actions</th></tr></thead>
            <tbody>${list.map((t) => treatmentRow(t, { showCow: false, open, today })).join("")}</tbody>
          </table>
        </div>`
      : `<p class="text-muted">No treatments recorded for this animal.</p>`;
    const badge = withdrawalBadge(cow, today);
    pane.innerHTML = `
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <span>${list.length === 1 ? "1 treatment" : `${list.length} treatments`} recorded ${badge}</span>
        <button type="button" class="btn btn-sm btn-success btn-treatment-add" data-cattle-id="${escapeHtml(cow.id)}">Record treatment</button>
      </div>
      <p class="small mb-2"><strong>Current medications:</strong> ${escapeHtml(cow.medications || "None")}</p>
      ${table}`;
  }

  // ----- Record / edit form -----

  // `cows` are the animals offered; `treatment` is set when editing; `draft` prefills a new
  // record (a follow-up); `cowId` preselects an animal; `products` feed the suggestions.
  fillForm({ cows, treatment = null, draft = null, cowId = "", products = [] }) {
    const editing = Boolean(treatment);
    const values = treatment || draft || {};
    const set = (id, value) => { document.getElementById(id).value = value ?? ""; };

    const cowSelect = document.getElementById("tr-cow");
    cowSelect.innerHTML =
      `<option value="">Select an animal</option>` +
      cows.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(`${c.tagNumber} · ${c.nameBreed || "Unnamed"}`)}</option>`).join("");
    cowSelect.value = values.cattleId || cowId;
    cowSelect.disabled = editing;

    const dateEl = document.getElementById("tr-date");
    dateEl.max = todayISO();
    set("tr-date", values.dateGiven || todayISO());
    set("tr-type", values.type || "treatment");
    for (const [id, field] of [["tr-product", "product"], ["tr-dose", "dose"], ["tr-route", "route"], ["tr-given-by", "givenBy"],
      ["tr-next-due", "nextDueDate"], ["tr-withdrawal", "withdrawalUntil"], ["tr-notes", "notes"]]) {
      set(id, values[field]);
    }
    document.getElementById("tr-product-list").innerHTML = products.map((p) => `<option value="${escapeHtml(p)}"></option>`).join("");
    document.getElementById("tr-route-list").innerHTML = ROUTE_SUGGESTIONS.map((r) => `<option value="${escapeHtml(r)}"></option>`).join("");

    document.getElementById("treatmentModalTitle").textContent = editing ? "Edit Treatment" : draft ? "Record Follow-up" : "Record Treatment";
    document.querySelector('#treatment-form button[type="submit"]').textContent = editing ? "Update Treatment" : "Save Treatment";
  }

  getFormData() {
    const value = (id) => document.getElementById(id).value;
    return {
      cattleId: value("tr-cow"),
      dateGiven: value("tr-date"),
      type: value("tr-type"),
      product: value("tr-product"),
      dose: value("tr-dose"),
      route: value("tr-route"),
      givenBy: value("tr-given-by"),
      nextDueDate: value("tr-next-due"),
      withdrawalUntil: value("tr-withdrawal"),
      notes: value("tr-notes"),
    };
  }
}
