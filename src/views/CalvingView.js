// Rendering for calving records: the Calving Records page (#view-calving), the "Calving history"
// tab of the cow details modal, and the record/edit form (#calvingModal).
// Every value from a record goes through escapeHtml().
import { escapeHtml } from "../utils/escapeHtml.js";
import { todayISO } from "../utils/DateHelpers.js";
import { CALF_SEX_LABELS, EASE_LABELS, OUTCOME_LABELS, daysUntil } from "../services/CalvingService.js";

const OUTCOME_BADGES = { alive: "bg-success", stillborn: "bg-secondary" };

function calfCell(e) {
  const parts = [];
  if (e.calfSex) parts.push(escapeHtml(CALF_SEX_LABELS[e.calfSex] || e.calfSex));
  if (e.calfTag) parts.push(`<span class="badge badge-cow">${escapeHtml(e.calfTag)}</span>`);
  return parts.join(" ") || "—";
}

function eventRow(e, showCow) {
  const cowCell = showCow
    ? `<td><span class="badge badge-cow">${escapeHtml(e.cattleTag)}</span> <span class="fw-semibold">${escapeHtml(e.cattleName || "Unnamed")}</span></td>`
    : "";
  const outcome = e.outcome
    ? `<span class="badge ${escapeHtml(OUTCOME_BADGES[e.outcome] || "bg-secondary")}">${escapeHtml(OUTCOME_LABELS[e.outcome] || e.outcome)}</span>`
    : "—";
  const viewBtn = showCow
    ? `<button class="btn btn-sm btn-outline-info btn-view" data-id="${escapeHtml(e.cattleId)}" title="View cow"><i class="fas fa-eye"></i><span class="visually-hidden">View cow</span></button>`
    : "";
  return `
    <tr data-calving-id="${escapeHtml(e.id)}">
      <td class="text-nowrap">${escapeHtml(e.calvingDate)}</td>
      ${cowCell}
      <td>${calfCell(e)}</td>
      <td>${e.birthWeight == null ? "—" : `${escapeHtml(e.birthWeight)} lbs`}</td>
      <td>${escapeHtml(EASE_LABELS[e.ease] || e.ease || "—")}</td>
      <td>${outcome}</td>
      <td class="calving-notes">${escapeHtml(e.notes || "")}</td>
      <td class="text-nowrap">
        ${viewBtn}
        <button class="btn btn-sm btn-outline-primary btn-calving-edit" data-id="${escapeHtml(e.id)}" title="Edit calving"><i class="fas fa-edit"></i><span class="visually-hidden">Edit calving</span></button>
        <button class="btn btn-sm btn-outline-danger btn-calving-delete" data-id="${escapeHtml(e.id)}" title="Delete calving"><i class="fas fa-trash"></i><span class="visually-hidden">Delete calving</span></button>
      </td>
    </tr>`;
}

export class CalvingView {
  // The herd-wide table. `total` is the unfiltered count, for the "x of y" line.
  renderTable(events, total) {
    const tbody = document.getElementById("calving-body");
    const emptyEl = document.getElementById("calving-empty");
    const countEl = document.getElementById("calving-count");
    if (!tbody) return;
    tbody.innerHTML = events.map((e) => eventRow(e, true)).join("");
    if (emptyEl) {
      emptyEl.hidden = events.length > 0;
      emptyEl.textContent = total === 0
        ? 'No calvings recorded yet. Click "Record Calving" to add the first one.'
        : "No calvings match these filters.";
    }
    if (countEl) countEl.textContent = total === 0 ? "" : `Showing ${events.length} of ${total}`;
  }

  // Cows with an expected calving date today or later, soonest first.
  renderUpcoming(cows) {
    const listEl = document.getElementById("calving-upcoming");
    if (!listEl) return;
    const today = todayISO();
    listEl.innerHTML = cows.length
      ? cows.map((c) => {
          const days = daysUntil(c.expectedCalvingDate, today);
          const when = days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due in ${days} days`;
          return `
            <li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div>
                <span class="badge badge-cow">${escapeHtml(c.tagNumber)}</span>
                <span class="fw-semibold">${escapeHtml(c.nameBreed || "Unnamed")}</span><br>
                <small class="text-muted">Expected ${escapeHtml(c.expectedCalvingDate)} · Last calving ${escapeHtml(c.lastCalvingDate || "none recorded")}</small>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="badge ${days <= 14 ? "bg-warning text-dark" : "bg-light text-dark border"} rounded-pill">${escapeHtml(when)}</span>
                <button type="button" class="btn btn-sm btn-outline-success btn-calving-add" data-cattle-id="${escapeHtml(c.id)}">Record calving</button>
              </div>
            </li>`;
        }).join("")
      : `<li class="list-group-item text-muted">No upcoming expected calvings.</li>`;
  }

  // Fills the year filter, keeping the current choice when that year still has events.
  renderYearOptions(years) {
    const select = document.getElementById("calving-filter-year");
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="all">All Years</option>${years.map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("")}`;
    select.value = years.includes(current) ? current : "all";
  }

  getFilters() {
    return {
      query: document.getElementById("calving-search")?.value || "",
      outcome: document.getElementById("calving-filter-outcome")?.value || "all",
      year: document.getElementById("calving-filter-year")?.value || "all",
    };
  }

  // ----- Cow details tab -----

  renderHistoryLoading(pane) {
    pane.innerHTML = `<p class="text-muted mb-0">Loading calving history…</p>`;
  }

  renderHistoryError(pane, message) {
    pane.innerHTML = `<p class="text-danger mb-0"></p>`;
    pane.firstElementChild.textContent = `Couldn't load the calving history. ${message}`;
  }

  renderHistory(pane, cow, events) {
    const table = events.length
      ? `<div class="table-responsive">
          <table class="table table-sm align-middle">
            <thead><tr><th>Date</th><th>Calf</th><th>Birth Weight</th><th>Ease</th><th>Outcome</th><th>Notes</th><th>Actions</th></tr></thead>
            <tbody>${events.map((e) => eventRow(e, false)).join("")}</tbody>
          </table>
        </div>`
      : `<p class="text-muted">No calvings recorded for this animal.</p>`;
    pane.innerHTML = `
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <span>${events.length === 1 ? "1 calving" : `${events.length} calvings`} recorded${cow.expectedCalvingDate ? ` · next expected ${escapeHtml(cow.expectedCalvingDate)}` : ""}</span>
        <button type="button" class="btn btn-sm btn-success btn-calving-add" data-cattle-id="${escapeHtml(cow.id)}" data-return="details">Record calving</button>
      </div>
      ${table}`;
  }

  // ----- Record / edit form -----

  // `cows` are the animals offered in the cow list; `event` is set when editing; `cowId`
  // preselects a cow for a new record.
  fillForm({ cows, event = null, cowId = "" }) {
    const editing = Boolean(event);
    const cowSelect = document.getElementById("cv-cow");
    cowSelect.innerHTML =
      `<option value="">Select a cow</option>` +
      cows.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(`${c.tagNumber} · ${c.nameBreed || "Unnamed"}`)}</option>`).join("");
    cowSelect.value = editing ? event.cattleId : cowId;
    cowSelect.disabled = editing;

    const dateEl = document.getElementById("cv-date");
    dateEl.max = todayISO();
    dateEl.value = editing ? event.calvingDate : todayISO();
    document.getElementById("cv-calf-sex").value = editing ? event.calfSex : "";
    document.getElementById("cv-calf-tag").value = editing ? event.calfTag : "";
    document.getElementById("cv-weight").value = editing ? event.birthWeight ?? "" : "";
    document.getElementById("cv-ease").value = editing ? event.ease : "unassisted";
    document.getElementById("cv-outcome").value = editing ? event.outcome : "alive";
    document.getElementById("cv-notes").value = editing ? event.notes : "";
    document.getElementById("cv-add-calf").checked = false;
    document.getElementById("cv-create-options").hidden = editing;

    document.getElementById("calvingModalTitle").textContent = editing ? "Edit Calving Record" : "Record Calving";
    document.querySelector('#calving-form button[type="submit"]').textContent = editing ? "Update Calving" : "Save Calving";
  }

  // Shows what the create-only options will do for the chosen cow and outcome.
  // `cow` is the selected animal or null.
  updateFormOptions(cow) {
    const stillborn = document.getElementById("cv-outcome").value === "stillborn";
    const addCalf = document.getElementById("cv-add-calf");
    addCalf.disabled = stillborn;
    if (stillborn) addCalf.checked = false;

    const expectedWrap = document.getElementById("cv-clear-expected-wrap");
    const expected = cow?.expectedCalvingDate || "";
    expectedWrap.hidden = !expected;
    document.getElementById("cv-clear-expected").checked = Boolean(expected);
    document.getElementById("cv-clear-expected-label").textContent =
      cow?.healthStatus === "pregnant"
        ? `Clear her expected calving date (${expected}) and Pregnant status`
        : `Clear her expected calving date (${expected})`;
  }

  getFormData() {
    const value = (id) => document.getElementById(id).value;
    const creating = !document.getElementById("cv-create-options").hidden;
    return {
      cattleId: value("cv-cow"),
      calvingDate: value("cv-date"),
      calfSex: value("cv-calf-sex"),
      calfTag: value("cv-calf-tag"),
      birthWeight: value("cv-weight"),
      ease: value("cv-ease"),
      outcome: value("cv-outcome"),
      notes: value("cv-notes"),
      addCalf: creating && document.getElementById("cv-add-calf").checked,
      clearExpected:
        creating &&
        !document.getElementById("cv-clear-expected-wrap").hidden &&
        document.getElementById("cv-clear-expected").checked,
    };
  }
}
