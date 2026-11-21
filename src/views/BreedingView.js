// Rendering for breeding records: the Breeding History page (#view-breeding), the "Breeding" tab
// of the cow details modal, and the breeding and pregnancy-check forms (#breedingModal,
// #pregcheckModal). Every value from a record goes through escapeHtml().
import { escapeHtml } from "../utils/escapeHtml.js";
import { todayISO } from "../utils/DateHelpers.js";
import {
  CHECK_METHOD_LABELS,
  METHOD_LABELS,
  RESULT_LABELS,
  addDays,
  breedingLabel,
  sireLabel,
} from "../services/BreedingService.js";

const RESULT_BADGES = { pregnant: "bg-info text-dark", open: "bg-secondary", unsure: "bg-warning text-dark" };

const cowCell = (e) =>
  `<td><span class="badge badge-cow">${escapeHtml(e.cattleTag)}</span> <span class="fw-semibold">${escapeHtml(e.cattleName || "Unnamed")}</span></td>`;

const resultBadge = (result) =>
  result
    ? `<span class="badge ${escapeHtml(RESULT_BADGES[result] || "bg-secondary")}">${escapeHtml(RESULT_LABELS[result] || result)}</span>`
    : "";

const viewButton = (e) =>
  `<button class="btn btn-sm btn-outline-info btn-view" data-id="${escapeHtml(e.cattleId)}" title="View cow"><i class="fas fa-eye"></i><span class="visually-hidden">View cow</span></button>`;

const actionButtons = (kind, label, e) => `
  <button class="btn btn-sm btn-outline-primary btn-${kind}-edit" data-id="${escapeHtml(e.id)}" title="Edit ${label}"><i class="fas fa-edit"></i><span class="visually-hidden">Edit ${label}</span></button>
  <button class="btn btn-sm btn-outline-danger btn-${kind}-delete" data-id="${escapeHtml(e.id)}" title="Delete ${label}"><i class="fas fa-trash"></i><span class="visually-hidden">Delete ${label}</span></button>`;

function breedingRow(e, showCow) {
  const check = e.checkResult ? `${resultBadge(e.checkResult)} <small class="text-muted">${escapeHtml(e.checkDate)}</small>` : "—";
  return `
    <tr data-breeding-id="${escapeHtml(e.id)}">
      <td class="text-nowrap">${escapeHtml(e.breedingDate)}</td>
      ${showCow ? cowCell(e) : ""}
      <td>${escapeHtml(METHOD_LABELS[e.method] || e.method || "—")}</td>
      <td>${escapeHtml(sireLabel(e) || "—")}</td>
      ${showCow ? `<td>${escapeHtml(e.technician || "—")}</td>` : ""}
      <td class="text-nowrap">${escapeHtml(e.expectedCalvingDate || "—")}</td>
      <td class="text-nowrap">${check}</td>
      <td class="breeding-notes">${escapeHtml(e.notes || "")}</td>
      <td class="text-nowrap">${showCow ? viewButton(e) : ""}${actionButtons("breeding", "breeding", e)}</td>
    </tr>`;
}

function checkRow(e, showCow) {
  return `
    <tr data-pregcheck-id="${escapeHtml(e.id)}">
      <td class="text-nowrap">${escapeHtml(e.checkDate)}</td>
      ${showCow ? cowCell(e) : ""}
      <td>${resultBadge(e.result)}</td>
      <td>${escapeHtml(CHECK_METHOD_LABELS[e.method] || e.method || "—")}</td>
      <td class="text-nowrap">${e.breedingDate ? `Bred ${escapeHtml(e.breedingDate)}` : "—"}</td>
      <td class="breeding-notes">${escapeHtml(e.notes || "")}</td>
      <td class="text-nowrap">${showCow ? viewButton(e) : ""}${actionButtons("pregcheck", "check", e)}</td>
    </tr>`;
}

const cowOption = (c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(`${c.tagNumber} · ${c.nameBreed || "Unnamed"}`)}</option>`;

export class BreedingView {
  // ----- Breeding History page -----

  renderNeedsCheck(cows, checkAfterDays) {
    const listEl = document.getElementById("breeding-needs-check");
    if (!listEl) return;
    if (checkAfterDays) {
      document.getElementById("breeding-needs-help").textContent =
        `Cows bred more than ${checkAfterDays} days ago with no pregnancy check since.`;
    }
    listEl.innerHTML = cows.length
      ? cows.map((e) => `
          <li class="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2" data-cattle-id="${escapeHtml(e.cattleId)}">
            <div>
              <span class="badge badge-cow">${escapeHtml(e.cattleTag)}</span>
              <span class="fw-semibold">${escapeHtml(e.cattleName || "Unnamed")}</span><br>
              <small class="text-muted">Bred ${escapeHtml(e.breedingDate)}${sireLabel(e) ? ` to ${escapeHtml(sireLabel(e))}` : ""} · expected calving ${escapeHtml(e.expectedCalvingDate)}</small>
            </div>
            <div class="d-flex align-items-center gap-2">
              <span class="badge bg-warning text-dark rounded-pill">${escapeHtml(`${e.daysSinceBreeding} days since breeding`)}</span>
              <button type="button" class="btn btn-sm btn-outline-success btn-pregcheck-add" data-cattle-id="${escapeHtml(e.cattleId)}" data-breeding-id="${escapeHtml(e.id)}">Record check</button>
            </div>
          </li>`).join("")
      : `<li class="list-group-item text-muted">No cows are waiting for a pregnancy check.</li>`;
  }

  // The two herd-wide tables. `totals` are the unfiltered counts.
  renderTables(breedings, checks, totals) {
    const body = document.getElementById("breeding-body");
    if (!body) return;
    body.innerHTML = breedings.map((e) => breedingRow(e, true)).join("");
    document.getElementById("pregcheck-body").innerHTML = checks.map((e) => checkRow(e, true)).join("");

    const empty = document.getElementById("breeding-empty");
    empty.hidden = breedings.length > 0;
    empty.textContent = totals.breedings === 0
      ? 'No breedings recorded yet. Click "Record Breeding" to add the first one.'
      : "No breedings match this search.";
    const checksEmpty = document.getElementById("pregcheck-empty");
    checksEmpty.hidden = checks.length > 0;
    checksEmpty.textContent = totals.checks === 0 ? "No pregnancy checks recorded yet." : "No pregnancy checks match this search.";
    document.getElementById("breeding-count").textContent =
      totals.breedings === 0 ? "" : `Showing ${breedings.length} of ${totals.breedings}`;
  }

  getQuery() {
    return document.getElementById("breeding-search")?.value || "";
  }

  // ----- Cow details tab -----

  renderHistoryLoading(pane) {
    pane.innerHTML = `<p class="text-muted mb-0">Loading breeding history…</p>`;
  }

  renderHistoryError(pane, message) {
    pane.innerHTML = `<p class="text-danger mb-0"></p>`;
    pane.firstElementChild.textContent = `Couldn't load the breeding history. ${message}`;
  }

  renderHistory(pane, cow, breedings, checks) {
    const breedingTable = breedings.length
      ? `<div class="table-responsive"><table class="table table-sm align-middle">
          <thead><tr><th>Date</th><th>Method</th><th>Sire</th><th>Expected Calving</th><th>Check</th><th>Notes</th><th>Actions</th></tr></thead>
          <tbody class="breeding-history">${breedings.map((e) => breedingRow(e, false)).join("")}</tbody>
        </table></div>`
      : `<p class="text-muted">No breedings recorded for this animal.</p>`;
    const checkTable = checks.length
      ? `<div class="table-responsive"><table class="table table-sm align-middle">
          <thead><tr><th>Date</th><th>Result</th><th>Method</th><th>Breeding</th><th>Notes</th><th>Actions</th></tr></thead>
          <tbody class="pregcheck-history">${checks.map((e) => checkRow(e, false)).join("")}</tbody>
        </table></div>`
      : `<p class="text-muted">No pregnancy checks recorded for this animal.</p>`;
    pane.innerHTML = `
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <span>${cow.expectedCalvingDate ? `Expected calving ${escapeHtml(cow.expectedCalvingDate)}` : "No expected calving date"}</span>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-sm btn-outline-success btn-pregcheck-add" data-cattle-id="${escapeHtml(cow.id)}">Record check</button>
          <button type="button" class="btn btn-sm btn-success btn-breeding-add" data-cattle-id="${escapeHtml(cow.id)}">Record breeding</button>
        </div>
      </div>
      <h6>Breedings</h6>
      ${breedingTable}
      <h6 class="mt-3">Pregnancy checks</h6>
      ${checkTable}`;
  }

  // ----- Breeding form -----

  // `cows` can be bred, `bulls` are offered as sires; `event` is set when editing.
  fillBreedingForm({ cows, bulls, event = null, cowId = "" }) {
    const editing = Boolean(event);
    const cowSelect = document.getElementById("br-cow");
    cowSelect.innerHTML = `<option value="">Select a cow</option>${cows.map(cowOption).join("")}`;
    cowSelect.value = editing ? event.cattleId : cowId;
    cowSelect.disabled = editing;

    const bullSelect = document.getElementById("br-sire-bull");
    const linked = editing && event.sireCattleId;
    const options = [...bulls];
    // A linked bull no longer recorded as male is still shown, so editing keeps it.
    if (linked && !bulls.some((b) => b.id === event.sireCattleId)) {
      options.push({ id: event.sireCattleId, tagNumber: event.sireTag, nameBreed: event.sireName });
    }
    bullSelect.innerHTML =
      `<option value="">Not a bull from the herd (type below)</option>` +
      options.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(`${b.tagNumber} · ${b.nameBreed || "Unnamed"}`)}</option>`).join("");
    bullSelect.value = linked ? event.sireCattleId : "";

    const dateEl = document.getElementById("br-date");
    dateEl.max = todayISO();
    dateEl.value = editing ? event.breedingDate : todayISO();
    document.getElementById("br-method").value = editing ? event.method : "ai";
    document.getElementById("br-sire").value = editing && !linked ? event.sire : "";
    document.getElementById("br-technician").value = editing ? event.technician : "";
    document.getElementById("br-notes").value = editing ? event.notes : "";

    document.getElementById("breedingModalTitle").textContent = editing ? "Edit Breeding Record" : "Record Breeding";
    document.querySelector('#breeding-form button[type="submit"]').textContent = editing ? "Update Breeding" : "Save Breeding";
  }

  // Hides the typed sire when a bull is picked, and shows the expected calving date the
  // breeding date gives (`gestationDays` is null until the server has said).
  updateBreedingForm(gestationDays, editing) {
    document.getElementById("br-sire-wrap").hidden = Boolean(document.getElementById("br-sire-bull").value);
    const date = document.getElementById("br-date").value;
    const expected = gestationDays ? addDays(date, gestationDays) : "";
    document.getElementById("br-expected").textContent = expected
      ? editing
        ? `Expected calving ${expected} (${gestationDays} days after breeding).`
        : `Expected calving ${expected} (${gestationDays} days after breeding). Saved on the cow when this is her newest breeding.`
      : "";
  }

  getBreedingForm() {
    const value = (id) => document.getElementById(id).value;
    return {
      cattleId: value("br-cow"),
      breedingDate: value("br-date"),
      method: value("br-method"),
      sireCattleId: value("br-sire-bull"),
      sire: value("br-sire"),
      technician: value("br-technician"),
      notes: value("br-notes"),
    };
  }

  // ----- Pregnancy check form -----

  fillCheckForm({ cows, event = null, cowId = "" }) {
    const editing = Boolean(event);
    const cowSelect = document.getElementById("pc-cow");
    cowSelect.innerHTML = `<option value="">Select a cow</option>${cows.map(cowOption).join("")}`;
    cowSelect.value = editing ? event.cattleId : cowId;
    cowSelect.disabled = editing;
    const dateEl = document.getElementById("pc-date");
    dateEl.max = todayISO();
    dateEl.value = editing ? event.checkDate : todayISO();
    document.getElementById("pc-result").value = editing ? event.result : "";
    document.getElementById("pc-method").value = editing ? event.method : "";
    document.getElementById("pc-notes").value = editing ? event.notes : "";
    this.renderBreedingOptions(null, "");

    document.getElementById("pregcheckModalTitle").textContent = editing ? "Edit Pregnancy Check" : "Record Pregnancy Check";
    document.querySelector('#pregcheck-form button[type="submit"]').textContent = editing ? "Update Check" : "Save Check";
  }

  // The selected cow's breedings for the "Breeding Checked" list; `breedings` is null while loading.
  renderBreedingOptions(breedings, selectedId) {
    const select = document.getElementById("pc-breeding");
    if (breedings === null) {
      select.innerHTML = `<option value="">Not linked to a breeding</option>`;
      select.disabled = true;
      return;
    }
    select.innerHTML =
      `<option value="">Not linked to a breeding</option>` +
      breedings.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(breedingLabel(b))}</option>`).join("");
    select.value = breedings.some((b) => b.id === selectedId) ? selectedId : "";
    select.disabled = false;
  }

  getCheckForm() {
    const value = (id) => document.getElementById(id).value;
    return {
      cattleId: value("pc-cow"),
      checkDate: value("pc-date"),
      result: value("pc-result"),
      method: value("pc-method"),
      breedingId: value("pc-breeding"),
      notes: value("pc-notes"),
    };
  }
}
