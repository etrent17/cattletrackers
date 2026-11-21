// Rendering for weight tracking: the Weights page (#view-weights) with its batch-entry form and
// herd-wide history, the "Weight history" tab of the cow details modal (with an inline SVG chart),
// and the record/edit form (#weighingModal). Every value from a record goes through escapeHtml().
import { escapeHtml } from "../utils/escapeHtml.js";
import { todayISO } from "../utils/DateHelpers.js";
import {
  averageDailyGain, chartGeometry, formatAdg, formatGain, formatWeight, gainSegments,
} from "../services/WeightService.js";

const animalLabel = (c) => `${c.tagNumber} · ${c.nameBreed || "Unnamed"}${c.weight ? ` (${formatWeight(c.weight)})` : ""}`;

const cowOptions = (cows, placeholder) =>
  `<option value="">${escapeHtml(placeholder)}</option>` +
  cows.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(animalLabel(c))}</option>`).join("");

const gainClass = (gain) => (gain > 0 ? "text-success" : gain < 0 ? "text-danger" : "");

function actionButtons(w, showView) {
  const viewBtn = showView
    ? `<button class="btn btn-sm btn-outline-info btn-view" data-id="${escapeHtml(w.cattleId)}" title="View cow"><i class="fas fa-eye"></i><span class="visually-hidden">View cow</span></button>`
    : "";
  return `
    ${viewBtn}
    <button class="btn btn-sm btn-outline-primary btn-weight-edit" data-id="${escapeHtml(w.id)}" title="Edit weighing"><i class="fas fa-edit"></i><span class="visually-hidden">Edit weighing</span></button>
    <button class="btn btn-sm btn-outline-danger btn-weight-delete" data-id="${escapeHtml(w.id)}" title="Delete weighing"><i class="fas fa-trash"></i><span class="visually-hidden">Delete weighing</span></button>`;
}

// A change since the previous weighing: "+30 lbs" with "+0.29 lbs/day over 104 days" under it.
function changeCell(change) {
  if (!change) return `<span class="text-muted">First weighing</span>`;
  const rate = change.adg === null ? "same day" : `${formatAdg(change.adg)} over ${change.days} ${change.days === 1 ? "day" : "days"}`;
  return `<span class="${gainClass(change.gain)}">${escapeHtml(formatGain(change.gain))}</span><br><small class="text-muted">${escapeHtml(rate)}</small>`;
}

export class WeightView {
  // ----- Weights page: history table -----

  // `changes` maps a weighing id to its change since that animal's previous weighing.
  renderTable(weighings, changes, total) {
    const tbody = document.getElementById("weights-body");
    const emptyEl = document.getElementById("weights-empty");
    const countEl = document.getElementById("weights-count");
    if (!tbody) return;
    tbody.innerHTML = weighings
      .map((w) => `
        <tr data-weighing-id="${escapeHtml(w.id)}">
          <td class="text-nowrap">${escapeHtml(w.date)}</td>
          <td><span class="badge badge-cow">${escapeHtml(w.cattleTag)}</span> <span class="fw-semibold">${escapeHtml(w.cattleName || "Unnamed")}</span></td>
          <td class="text-nowrap">${escapeHtml(formatWeight(w.weight))}</td>
          <td class="text-nowrap">${changeCell(changes.get(w.id))}</td>
          <td class="weight-notes">${escapeHtml(w.notes || "")}</td>
          <td class="text-nowrap">${actionButtons(w, true)}</td>
        </tr>`)
      .join("");
    if (emptyEl) {
      emptyEl.hidden = weighings.length > 0;
      emptyEl.textContent = total === 0
        ? "No weighings recorded yet. Use Record Weights above to add the first ones."
        : "No weighings match this search.";
    }
    if (countEl) countEl.textContent = total === 0 ? "" : `Showing ${weighings.length} of ${total}`;
  }

  getFilters() {
    return { query: document.getElementById("weight-search")?.value || "" };
  }

  // ----- Weights page: batch entry -----

  // Sets the date (today, newest allowed) and redraws the animal lists of the existing rows,
  // keeping what is chosen. Starts with three empty rows the first time.
  prepareBatch(cows) {
    const dateEl = document.getElementById("weight-batch-date");
    if (dateEl) {
      dateEl.max = todayISO();
      if (!dateEl.value) dateEl.value = todayISO();
    }
    const tbody = document.getElementById("weight-batch-body");
    if (!tbody) return;
    for (const select of tbody.querySelectorAll(".wb-cow")) {
      const current = select.value;
      select.innerHTML = cowOptions(cows, "Select an animal");
      select.value = cows.some((c) => c.id === current) ? current : "";
    }
    if (!tbody.children.length) for (let i = 0; i < 3; i += 1) this.addBatchRow(cows);
  }

  addBatchRow(cows, cattleId = "") {
    const tbody = document.getElementById("weight-batch-body");
    if (!tbody) return null;
    const tr = document.createElement("tr");
    tr.className = "weight-batch-row";
    tr.innerHTML = `
      <td>
        <select class="form-select form-select-sm wb-cow" aria-label="Animal">${cowOptions(cows, "Select an animal")}</select>
        <div class="invalid-feedback wb-error"></div>
      </td>
      <td><input type="number" class="form-control form-control-sm wb-weight" min="0.01" max="5000" step="any" inputmode="decimal" aria-label="Weight (lbs)"></td>
      <td><input class="form-control form-control-sm wb-notes" maxlength="2000" aria-label="Notes"></td>
      <td class="text-end"><button type="button" class="btn btn-sm btn-outline-secondary btn-weight-batch-remove" title="Remove row"><i class="fas fa-times"></i><span class="visually-hidden">Remove row</span></button></td>`;
    tr.querySelector(".wb-cow").value = cattleId;
    tbody.appendChild(tr);
    return tr;
  }

  // Adds a row for each animal that is not in the form yet, filling empty rows first.
  addAllAnimals(cows) {
    const rows = this.batchRowElements();
    const chosen = new Set(rows.map((tr) => tr.querySelector(".wb-cow").value).filter(Boolean));
    const empty = rows.filter((tr) => !tr.querySelector(".wb-cow").value && !tr.querySelector(".wb-weight").value);
    for (const cow of cows) {
      if (chosen.has(cow.id)) continue;
      const tr = empty.shift();
      if (tr) tr.querySelector(".wb-cow").value = cow.id;
      else this.addBatchRow(cows, cow.id);
    }
  }

  batchRowElements() {
    return [...(document.getElementById("weight-batch-body")?.children || [])];
  }

  getBatchDate() {
    return document.getElementById("weight-batch-date")?.value || "";
  }

  // The rows as typed, in screen order.
  getBatchRows() {
    return this.batchRowElements().map((tr) => ({
      cattleId: tr.querySelector(".wb-cow").value,
      weight: tr.querySelector(".wb-weight").value,
      notes: tr.querySelector(".wb-notes").value,
    }));
  }

  // After a save: rows at `savedPositions` are removed, rows in `errors` (position -> message) are
  // marked, every other row is unmarked. Keeps at least one row.
  applyBatchResult(cows, savedPositions, errors) {
    const rows = this.batchRowElements();
    rows.forEach((tr, position) => {
      const message = errors.get(position) || "";
      tr.classList.toggle("table-danger", Boolean(message));
      tr.querySelector(".wb-cow").classList.toggle("is-invalid", Boolean(message));
      const errorEl = tr.querySelector(".wb-error");
      errorEl.textContent = message;
      errorEl.classList.toggle("d-block", Boolean(message));
    });
    rows.filter((_, position) => savedPositions.has(position)).forEach((tr) => tr.remove());
    if (!this.batchRowElements().length) this.addBatchRow(cows);
  }

  // The line under the form that says what the last save did. Plain text.
  renderBatchResult(message, ok) {
    const el = document.getElementById("weight-batch-result");
    if (!el) return;
    el.textContent = message;
    el.className = `small mb-0 ${ok ? "text-success" : "text-danger"}`;
    el.hidden = !message;
  }

  // ----- Cow details tab -----

  renderHistoryLoading(pane) {
    pane.innerHTML = `<p class="text-muted mb-0">Loading weight history…</p>`;
  }

  renderHistoryError(pane, message) {
    pane.innerHTML = `<p class="text-danger mb-0"></p>`;
    pane.firstElementChild.textContent = `Couldn't load the weight history. ${message}`;
  }

  // `weighings` newest first, as the API returns them.
  renderHistory(pane, cow, weighings) {
    const overall = averageDailyGain(weighings);
    const segments = new Map(gainSegments(weighings).map((s) => [s.to.id, s]));
    const summary = [
      `<div><div class="text-muted small">Current weight</div><div class="fs-5 fw-semibold" data-weight-current>${escapeHtml(formatWeight(cow.weight))}</div></div>`,
      `<div><div class="text-muted small">Weighings</div><div class="fs-5 fw-semibold">${weighings.length}</div></div>`,
      `<div><div class="text-muted small">Average daily gain${overall ? `, ${escapeHtml(overall.from.date)} to ${escapeHtml(overall.to.date)}` : ""}</div>
        <div class="fs-5 fw-semibold" data-weight-adg>${overall
          ? `<span class="${gainClass(overall.gain)}">${escapeHtml(formatAdg(overall.adg))}</span> <small class="text-muted fw-normal">${escapeHtml(formatGain(overall.gain))} in ${overall.days} ${overall.days === 1 ? "day" : "days"}</small>`
          : `<span class="text-muted fw-normal fs-6">Needs two weighings on different days</span>`}</div></div>`,
    ].join("");

    const table = weighings.length
      ? `<div class="table-responsive">
          <table class="table table-sm align-middle">
            <thead><tr><th>Date</th><th>Weight</th><th>Change</th><th>Notes</th><th>Actions</th></tr></thead>
            <tbody>${weighings.map((w) => `
              <tr data-weighing-id="${escapeHtml(w.id)}">
                <td class="text-nowrap">${escapeHtml(w.date)}</td>
                <td class="text-nowrap">${escapeHtml(formatWeight(w.weight))}</td>
                <td class="text-nowrap">${changeCell(segments.get(w.id))}</td>
                <td class="weight-notes">${escapeHtml(w.notes || "")}</td>
                <td class="text-nowrap">${actionButtons(w, false)}</td>
              </tr>`).join("")}</tbody>
          </table>
        </div>`
      : `<p class="text-muted">No weighings recorded for this animal.</p>`;

    pane.innerHTML = `
      <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div class="d-flex flex-wrap gap-4">${summary}</div>
        <button type="button" class="btn btn-sm btn-success btn-weight-add" data-cattle-id="${escapeHtml(cow.id)}">Record weight</button>
      </div>
      ${weighings.length >= 2 ? this.chart(weighings, cow) : ""}
      ${table}`;
  }

  // A line chart of weight over time, drawn as inline SVG. Each point has a tooltip (<title>) with
  // its date and weight; the table under the chart holds the same figures.
  chart(weighings, cow) {
    // A narrower drawing on phones, so the 12px labels stay readable when the SVG is scaled down.
    const narrow = typeof window !== "undefined" && window.matchMedia?.("(max-width: 575.98px)").matches;
    const g = chartGeometry(weighings, narrow ? { width: 360, height: 200, pad: { top: 14, right: 14, bottom: 28, left: 46 } } : undefined);
    if (!g) return "";
    const { width, height, pad, points, yTicks } = g;
    const last = points[points.length - 1];
    const grid = yTicks
      .map((t) => `
        <line x1="${pad.left}" x2="${width - pad.right}" y1="${t.y}" y2="${t.y}" class="weight-chart-grid"/>
        <text x="${pad.left - 8}" y="${t.y}" text-anchor="end" dominant-baseline="middle" class="weight-chart-label">${escapeHtml(Math.round(t.value).toLocaleString("en-US"))}</text>`)
      .join("");
    const dots = points
      .map((p) => `
        <g class="weight-chart-point">
          <title>${escapeHtml(`${p.weighing.date}: ${formatWeight(p.weighing.weight)}`)}</title>
          <circle cx="${p.x}" cy="${p.y}" r="12" fill="transparent"/>
          <circle cx="${p.x}" cy="${p.y}" r="4" class="weight-chart-dot"/>
        </g>`)
      .join("");
    const label = `Weight of ${cow.tagNumber} over time, from ${formatWeight(points[0].weighing.weight)} on ${points[0].weighing.date} to ${formatWeight(last.weighing.weight)} on ${last.weighing.date}`;
    return `
      <figure class="mb-3">
        <svg class="weight-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}" preserveAspectRatio="xMidYMid meet">
          ${grid}
          <text x="${pad.left}" y="${height - 8}" class="weight-chart-label">${escapeHtml(points[0].weighing.date)}</text>
          <text x="${width - pad.right}" y="${height - 8}" text-anchor="end" class="weight-chart-label">${escapeHtml(last.weighing.date)}</text>
          <polyline points="${points.map((p) => `${p.x},${p.y}`).join(" ")}" class="weight-chart-line"/>
          ${dots}
        </svg>
        <figcaption class="text-muted small">Weight (lbs) by weighing date. Hover a point for its value.</figcaption>
      </figure>`;
  }

  // ----- Record / edit form -----

  fillForm({ cows, weighing = null, cowId = "" }) {
    const editing = Boolean(weighing);
    const cowSelect = document.getElementById("wt-cow");
    cowSelect.innerHTML = cowOptions(cows, "Select an animal");
    cowSelect.value = editing ? weighing.cattleId : cowId;
    cowSelect.disabled = editing;
    const dateEl = document.getElementById("wt-date");
    dateEl.max = todayISO();
    dateEl.value = editing ? weighing.date : todayISO();
    document.getElementById("wt-weight").value = editing ? weighing.weight : "";
    document.getElementById("wt-notes").value = editing ? weighing.notes : "";
    document.getElementById("weighingModalTitle").textContent = editing ? "Edit Weighing" : "Record Weight";
    document.querySelector('#weighing-form button[type="submit"]').textContent = editing ? "Update Weighing" : "Save Weighing";
  }

  getFormData() {
    const value = (id) => document.getElementById(id).value;
    return { cattleId: value("wt-cow"), date: value("wt-date"), weight: value("wt-weight"), notes: value("wt-notes") };
  }
}
