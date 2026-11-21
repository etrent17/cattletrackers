// Markup for the Performance Reports and Health Reports pages. Every value from the API or the
// user goes through escapeHtml(); the figures are the server's, only formatted here.
import { escapeHtml } from "../utils/escapeHtml.js";
import { RANGE_PRESETS } from "../services/FinanceService.js";
import { TYPE_LABELS } from "../services/TreatmentService.js";
import { formatAdg, formatGain, formatWeight } from "../services/WeightService.js";
import {
  EASE_LABELS,
  GROUP_LABELS,
  OUTCOME_LABELS,
  STATUS_LABELS,
  TREATMENT_TYPES,
  columnChart,
  daysLeftLabel,
  dueLabel,
  formatDays,
  formatPercent,
  labelIndexes,
  monthLabel,
  periodLabel,
  plural,
  sharePercent,
} from "../services/ReportsService.js";

function statCard(label, value, id, note = "") {
  return `
    <div class="col-6 col-md-4 col-xl-2">
      <div class="p-3 bg-white rounded border h-100">
        <div class="text-muted small">${escapeHtml(label)}</div>
        <div class="fs-4 fw-semibold" id="${id}">${escapeHtml(value)}</div>
        ${note ? `<div class="text-muted small">${escapeHtml(note)}</div>` : ""}
      </div>
    </div>`;
}

// A section heading with the table's Export CSV button (data-export names the table).
function heading(title, exportKey) {
  return `
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
      <h5 class="mb-0">${escapeHtml(title)}</h5>
      <button type="button" class="btn btn-outline-secondary btn-sm rep-export" data-export="${escapeHtml(exportKey)}"><i class="fas fa-file-csv me-1"></i>Export CSV</button>
    </div>`;
}

const empty = (colspan, text) => `<tr><td colspan="${colspan}" class="text-muted">${escapeHtml(text)}</td></tr>`;
const dash = (value) => (value === null || value === undefined || value === "" ? "—" : value);
const cowCell = (a) =>
  `<span class="badge badge-cow">${escapeHtml(a.cattleTag)}</span>${a.cattleName ? ` ${escapeHtml(a.cattleName)}` : ""}`;

// A horizontal bar for a share of a whole. Decorative: the number is in the next cell.
const shareBar = (percent) =>
  `<div class="rep-track" aria-hidden="true"><div class="rep-fill" style="width: ${Number(percent) || 0}%"></div></div>`;

// Rows of a "category, count, share, bar" table.
function breakdownRows(labels, counts, total) {
  return Object.keys(labels)
    .map((key) => {
      const percent = sharePercent(counts[key], total);
      return `
        <tr>
          <td>${escapeHtml(labels[key])}</td>
          <td class="text-end">${escapeHtml(counts[key])}</td>
          <td class="text-end text-muted">${percent}%</td>
          <td class="w-25">${shareBar(percent)}</td>
        </tr>`;
    })
    .join("");
}

// The herd-size column chart (inline SVG, one series). Each column has a <title> tooltip and the
// newest one carries its value; the table below it holds every figure.
function herdChart(byMonth) {
  const width = 900;
  const height = 220;
  const { top, plot, bars } = columnChart(byMonth.map((m) => m.size), { width, height });
  const slot = (plot.right - plot.left) / bars.length;
  const labelled = new Set(labelIndexes(bars.length, 8));
  const last = bars[bars.length - 1];
  const grid = [0, top / 2, top]
    .filter((value) => Number.isInteger(value))
    .map((value) => {
      const y = plot.bottom - (value / top) * (plot.bottom - plot.top);
      return `<line class="rep-chart-grid" x1="${plot.left}" x2="${plot.right}" y1="${y}" y2="${y}"/>
        <text class="rep-chart-label" x="${plot.left - 6}" y="${y + 4}" text-anchor="end">${value}</text>`;
    })
    .join("");
  const columns = bars
    .map((bar, i) => {
      const month = byMonth[i];
      const radius = Math.min(4, bar.width / 2, bar.height);
      // Rounded at the top only: the column stands square on the baseline.
      const path = `M${bar.x},${plot.bottom} V${bar.y + radius} Q${bar.x},${bar.y} ${bar.x + radius},${bar.y} H${bar.x + bar.width - radius} Q${bar.x + bar.width},${bar.y} ${bar.x + bar.width},${bar.y + radius} V${plot.bottom} Z`;
      return `
        <g class="rep-chart-column">
          <title>${escapeHtml(monthLabel(month.month))}: ${escapeHtml(plural(month.size, "animal"))} (${escapeHtml(month.added)} added)</title>
          <rect class="rep-chart-hit" x="${plot.left + slot * i}" y="${plot.top}" width="${slot}" height="${plot.bottom - plot.top}"/>
          ${bar.height > 0 ? `<path class="rep-chart-bar" d="${path}"/>` : ""}
          ${labelled.has(i) ? `<text class="rep-chart-label" x="${bar.x + bar.width / 2}" y="${height - 6}" text-anchor="middle">${escapeHtml(monthLabel(month.month))}</text>` : ""}
        </g>`;
    })
    .join("");
  return `
    <svg class="rep-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Herd size at the end of each month, from ${escapeHtml(monthLabel(byMonth[0].month))} to ${escapeHtml(monthLabel(byMonth[byMonth.length - 1].month))}. The figures are in the table below.">
      ${grid}
      ${columns}
      <text class="rep-chart-value" x="${last.x + last.width / 2}" y="${last.y - 5}" text-anchor="middle">${escapeHtml(last.value)}</text>
    </svg>`;
}

export class ReportsView {
  // Period filter, Print button and an empty content area (#rep-content).
  renderLayout(bodyEl, { range }) {
    const presets = Object.entries(RANGE_PRESETS)
      .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === range.preset ? "selected" : ""}>${escapeHtml(label)}</option>`)
      .join("");
    bodyEl.innerHTML = `
      <form id="rep-filter" class="row g-2 align-items-end mb-3" novalidate>
        <div class="col-sm-6 col-lg-2">
          <label class="form-label small mb-1" for="rep-preset">Period</label>
          <select id="rep-preset" class="form-select form-select-sm">${presets}</select>
        </div>
        <div class="col-6 col-lg-2">
          <label class="form-label small mb-1" for="rep-from">From</label>
          <input id="rep-from" type="date" class="form-control form-control-sm" value="${escapeHtml(range.from)}">
        </div>
        <div class="col-6 col-lg-2">
          <label class="form-label small mb-1" for="rep-to">To</label>
          <input id="rep-to" type="date" class="form-control form-control-sm" value="${escapeHtml(range.to)}">
        </div>
        <div class="col-12 col-lg d-flex gap-2 justify-content-lg-end">
          <button id="rep-print-btn" type="button" class="btn btn-outline-secondary btn-sm"><i class="fas fa-print me-1"></i>Print</button>
        </div>
      </form>
      <p id="rep-period" class="text-muted small mb-3"></p>
      <div id="rep-content" aria-live="polite"></div>`;
  }

  // The period in words; it is also what a printed report shows instead of the filter.
  renderPeriod(range, today) {
    const el = document.getElementById("rep-period");
    if (el) el.textContent = `Period: ${periodLabel(range)}. Report date: ${today}.`;
  }

  renderLoading(contentEl) {
    contentEl.innerHTML = `<p class="text-muted"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading…</p>`;
  }

  renderMessage(contentEl, message) {
    contentEl.innerHTML = `<div class="alert alert-warning" role="alert">${escapeHtml(message)}</div>`;
  }

  // An error inside the page with a Retry button (#rep-retry).
  renderError(contentEl, message) {
    contentEl.innerHTML = `
      <div class="alert alert-danger d-flex flex-wrap justify-content-between align-items-center gap-2" role="alert">
        <span>${escapeHtml(message)}</span>
        <button id="rep-retry" type="button" class="btn btn-sm btn-danger">Retry</button>
      </div>`;
  }

  renderPerformance(contentEl, r) {
    const { herd, calvings, calvingInterval: interval, dailyGain, breeding } = r;
    const cards = `
      <div class="row g-3 mb-4">
        ${statCard("Herd size now", String(herd.size), "rep-herd-size", `${herd.females} female, ${herd.males} male`)}
        ${statCard("Calvings", String(calvings.count), "rep-calvings", `${calvings.byOutcome.alive} alive, ${calvings.byOutcome.stillborn} stillborn`)}
        ${statCard("Calving rate", formatPercent(calvings.calvingRate), "rep-calving-rate", `${calvings.cowsCalved} of ${plural(calvings.breedingFemales, "breeding female")}`)}
        ${statCard("Calving interval", formatDays(interval.averageDays), "rep-calving-interval", interval.intervals ? `Average of ${plural(interval.intervals, "interval")}` : "No repeat calvings")}
        ${statCard("Daily gain", formatAdg(dailyGain.herdAverage), "rep-daily-gain", dailyGain.animals ? `Average of ${plural(dailyGain.animals, "animal")}` : "No animals weighed twice")}
        ${statCard("Conception rate", formatPercent(breeding.conceptionRate), "rep-conception-rate", `${breeding.pregnant} of ${plural(breeding.checked, "checked breeding")}`)}
      </div>`;

    const herdRows = herd.byMonth
      .map(
        (m) => `
        <tr>
          <td class="text-nowrap">${escapeHtml(monthLabel(m.month))}</td>
          <td class="text-end">${escapeHtml(m.added)}</td>
          <td class="text-end fw-semibold">${escapeHtml(m.size)}</td>
        </tr>`
      )
      .join("");
    const herdSection = `
      <section class="rep-section mb-4">
        ${heading("Herd size over time", "herd")}
        ${herd.byMonth.length ? herdChart(herd.byMonth) : ""}
        <div class="table-responsive mt-2">
          <table class="table table-sm align-middle" id="rep-herd-table">
            <thead><tr><th>Month</th><th class="text-end">Animals added</th><th class="text-end">Herd size at month end</th></tr></thead>
            <tbody>${herdRows || empty(3, "No animals were on record in this period.")}</tbody>
          </table>
        </div>
      </section>`;

    const summaryRows = [
      ["Calvings in period", calvings.count],
      ["Cows that calved", calvings.cowsCalved],
      ["Breeding-age females", calvings.breedingFemales],
      ["Calving rate", formatPercent(calvings.calvingRate)],
      ["Average birth weight", calvings.birthWeights ? `${formatWeight(calvings.averageBirthWeight)} (${plural(calvings.birthWeights, "calf", "calves")} weighed)` : "—"],
      ["Average calving interval", formatDays(interval.averageDays)],
      ["Shortest and longest interval", interval.intervals ? `${formatDays(interval.minDays)} to ${formatDays(interval.maxDays)}` : "—"],
      ["Breedings in period", breeding.breedings],
      ["Breedings checked (pregnant or open)", breeding.checked],
      ["Checked pregnant", breeding.pregnant],
      ["Checked open", breeding.open],
      ["Conception rate", formatPercent(breeding.conceptionRate)],
    ]
      .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td class="text-end fw-semibold">${escapeHtml(value)}</td></tr>`)
      .join("");
    const breakdownTable = (title, id, labels, counts) => `
      <h6 class="mt-3">${escapeHtml(title)}</h6>
      <div class="table-responsive">
        <table class="table table-sm align-middle" id="${id}">
          <thead><tr><th>${escapeHtml(title)}</th><th class="text-end">Calvings</th><th class="text-end">Share</th><th><span class="visually-hidden">Chart</span></th></tr></thead>
          <tbody>${breakdownRows(labels, counts, calvings.count)}</tbody>
        </table>
      </div>`;
    const calvingSection = `
      <div class="row g-4 mb-4">
        <section class="rep-section col-lg-6">
          ${heading("Calving and breeding", "summary")}
          <div class="table-responsive">
            <table class="table table-sm align-middle" id="rep-summary-table">
              <thead><tr><th>Measure</th><th class="text-end">Value</th></tr></thead>
              <tbody>${summaryRows}</tbody>
            </table>
          </div>
        </section>
        <section class="rep-section col-lg-6">
          ${heading("Calving outcomes and ease", "calvings")}
          ${calvings.count === 0 ? `<p class="text-muted" id="rep-calvings-empty">No calvings were recorded in this period.</p>` : ""}
          ${breakdownTable("Outcome", "rep-outcome-table", OUTCOME_LABELS, calvings.byOutcome)}
          ${breakdownTable("Ease", "rep-ease-table", EASE_LABELS, calvings.byEase)}
        </section>
      </div>`;

    const groupRows = dailyGain.byGroup
      .map(
        (g) => `
        <tr>
          <td>${escapeHtml(GROUP_LABELS[g.group] || g.group)}</td>
          <td class="text-end">${escapeHtml(g.animals)}</td>
          <td class="text-end">${escapeHtml(formatAdg(g.average))}</td>
        </tr>`
      )
      .join("");
    const animalRows = dailyGain.byAnimal
      .map(
        (a) => `
        <tr>
          <td>${cowCell(a)}</td>
          <td>${escapeHtml(GROUP_LABELS[a.group] || a.group)}</td>
          <td class="text-nowrap">${escapeHtml(a.firstDate)}<br><small class="text-muted">${escapeHtml(formatWeight(a.firstWeight))}</small></td>
          <td class="text-nowrap">${escapeHtml(a.lastDate)}<br><small class="text-muted">${escapeHtml(formatWeight(a.lastWeight))}</small></td>
          <td class="text-end">${escapeHtml(a.days)}</td>
          <td class="text-end text-nowrap">${escapeHtml(formatGain(a.gain))}</td>
          <td class="text-end text-nowrap fw-semibold">${escapeHtml(formatAdg(a.dailyGain))}</td>
        </tr>`
      )
      .join("");
    const gainSection = `
      <div class="row g-4 mb-3">
        <section class="rep-section col-lg-4">
          ${heading("Daily gain by group", "gain-groups")}
          <div class="table-responsive">
            <table class="table table-sm align-middle" id="rep-gain-groups-table">
              <thead><tr><th>Group</th><th class="text-end">Animals</th><th class="text-end">Average daily gain</th></tr></thead>
              <tbody>${groupRows || empty(3, "No animal has two weighings on different days in this period.")}</tbody>
              ${dailyGain.animals ? `<tfoot><tr class="fw-semibold"><td>Whole herd</td><td class="text-end">${escapeHtml(dailyGain.animals)}</td><td class="text-end">${escapeHtml(formatAdg(dailyGain.herdAverage))}</td></tr></tfoot>` : ""}
            </table>
          </div>
        </section>
        <section class="rep-section col-lg-8">
          ${heading("Daily gain by animal", "gain")}
          <div class="table-responsive">
            <table class="table table-sm align-middle" id="rep-gain-table">
              <thead><tr><th>Animal</th><th>Group</th><th>First weighing</th><th>Last weighing</th><th class="text-end">Days</th><th class="text-end">Gain</th><th class="text-end">Daily gain</th></tr></thead>
              <tbody>${animalRows || empty(7, "No animal has two weighings on different days in this period.")}</tbody>
            </table>
          </div>
        </section>
      </div>`;

    contentEl.innerHTML = `
      ${cards}
      ${herdSection}
      ${calvingSection}
      ${gainSection}
      <div class="rep-notes text-muted small" id="rep-definitions">
        <p class="fw-semibold mb-1">How these figures are worked out</p>
        <ul class="mb-0 ps-3">
          <li><strong>Herd size over time</strong> counts the animals on record today whose record had been created by the end of each month (the current month is counted up to today). Animals that were deleted are not counted in any month, and an animal entered late appears from the day it was entered, not from when it arrived.</li>
          <li><strong>Calving rate</strong> is the number of cows that calved in the period divided by the breeding-age females on record: animals not marked male that have calved before, or females aged ${escapeHtml(calvings.breedingAgeMonths)} months or more at the end of the period (a female with no birth date counts). Over a period longer than a year a cow still counts once.</li>
          <li><strong>Calving interval</strong> is the number of days from a cow's previous calving to her calving in the period, averaged over all such intervals. Twins born on one day are one calving; a cow's first calving has no interval.</li>
          <li><strong>Daily gain</strong> is each animal's weight change from its first to its last weighing in the period, divided by the days between them; it needs two weighings on different days. The group and herd figures are the average of the animals' daily gains, each animal counting once.</li>
          <li><strong>Conception rate</strong> is the share of breedings in the period found pregnant among those with a result. A breeding's result is the cow's newest pregnant or open check dated on or after it and before her next breeding; unsure checks and unchecked breedings are left out.</li>
          <li>Weaning and sale weights are not recorded separately, so the report does not show them. Birth weights come from the calving records.</li>
        </ul>
      </div>`;
  }

  renderHealth(contentEl, r) {
    const { treatments, herd, followUps } = r;
    const cards = `
      <div class="row g-3 mb-4">
        ${statCard("Treatments", String(treatments.count), "rep-treatments", "In the period")}
        ${statCard("Animals treated", String(treatments.animals), "rep-animals-treated", `Of ${plural(herd.size, "animal")} on record`)}
        ${statCard("Under treatment", String(herd.underTreatment), "rep-under-treatment", "Now")}
        ${statCard("In quarantine", String(herd.quarantine), "rep-quarantine", "Now")}
        ${statCard("In withdrawal", String(r.withdrawal.length), "rep-withdrawal", "Now")}
        ${statCard("Overdue follow-ups", String(followUps.overdue.length), "rep-overdue", `${followUps.upcoming.length} due within ${followUps.upcomingDays} days`)}
      </div>`;

    const typeRows = treatments.byType
      .map((t) => {
        const percent = sharePercent(t.count, treatments.count);
        return `
          <tr>
            <td class="text-nowrap"><span class="rep-swatch rep-type-${escapeHtml(t.type)}" aria-hidden="true"></span>${escapeHtml(TYPE_LABELS[t.type] || t.type)}</td>
            <td class="text-end">${escapeHtml(t.count)}</td>
            <td class="text-end">${escapeHtml(t.animals)}</td>
            <td class="text-end text-muted">${percent}%</td>
            <td class="w-25">${shareBar(percent)}</td>
          </tr>`;
      })
      .join("");

    // Stacked bars share one scale: the busiest month fills the cell.
    const busiest = Math.max(1, ...treatments.byMonth.map((m) => m.total));
    const monthRows = treatments.byMonth
      .map((m) => {
        const segments = TREATMENT_TYPES.filter((type) => m[type] > 0)
          .map((type) => `<div class="rep-seg rep-type-${type}" style="flex-grow: ${Number(m[type])}" title="${escapeHtml(TYPE_LABELS[type])}: ${escapeHtml(m[type])}"></div>`)
          .join("");
        return `
          <tr>
            <td class="text-nowrap">${escapeHtml(monthLabel(m.month))}</td>
            ${TREATMENT_TYPES.map((type) => `<td class="text-end">${escapeHtml(m[type])}</td>`).join("")}
            <td class="text-end fw-semibold">${escapeHtml(m.total)}</td>
            <td class="w-25"><div class="rep-stack" style="width: ${(m.total / busiest) * 100}%" aria-hidden="true">${segments}</div></td>
          </tr>`;
      })
      .join("");
    const legend = TREATMENT_TYPES.map(
      (type) => `<span class="text-nowrap"><span class="rep-swatch rep-type-${type}" aria-hidden="true"></span>${escapeHtml(TYPE_LABELS[type])}</span>`
    ).join("");

    const attention = [...r.underTreatment.map((a) => ["under_treatment", a]), ...r.quarantine.map((a) => ["quarantine", a])];
    const attentionRows = attention
      .map(
        ([status, a]) => `
        <tr>
          <td>${cowCell(a)}</td>
          <td><span class="badge ${status === "quarantine" ? "bg-danger" : "bg-warning text-dark"}">${escapeHtml(STATUS_LABELS[status])}</span></td>
          <td>${escapeHtml(dash(a.medications))}</td>
          <td>${a.lastTreatmentDate ? `${escapeHtml(a.lastTreatmentDate)} · ${escapeHtml(TYPE_LABELS[a.lastTreatmentType] || a.lastTreatmentType)}${a.lastTreatmentProduct ? ` · ${escapeHtml(a.lastTreatmentProduct)}` : ""}` : `<span class="text-muted">None recorded</span>`}</td>
        </tr>`
      )
      .join("");

    const withdrawalRows = r.withdrawal
      .map(
        (w) => `
        <tr>
          <td>${cowCell(w)}</td>
          <td class="text-nowrap">${escapeHtml(w.withdrawalUntil)}</td>
          <td class="text-nowrap">${escapeHtml(daysLeftLabel(w.daysLeft))}</td>
          <td>${escapeHtml(dash(w.product))}</td>
          <td class="text-nowrap">${escapeHtml(dash(w.dateGiven))}</td>
        </tr>`
      )
      .join("");

    const followUpRows = [...followUps.overdue, ...followUps.upcoming]
      .map(
        (f) => `
        <tr>
          <td>${cowCell(f)}</td>
          <td>${escapeHtml(TYPE_LABELS[f.type] || f.type)}</td>
          <td>${escapeHtml(dash(f.product))}</td>
          <td class="text-nowrap">${escapeHtml(f.dateGiven)}</td>
          <td class="text-nowrap">${escapeHtml(f.nextDueDate)}</td>
          <td><span class="badge ${f.daysUntil < 0 ? "bg-danger" : "bg-secondary"} rounded-pill">${f.daysUntil < 0 ? `<i class="fas fa-triangle-exclamation me-1"></i>` : ""}${escapeHtml(dueLabel(f.daysUntil))}</span></td>
        </tr>`
      )
      .join("");

    contentEl.innerHTML = `
      ${cards}
      <div class="row g-4 mb-4">
        <section class="rep-section col-lg-5">
          ${heading("Treatments by type", "types")}
          <div class="table-responsive">
            <table class="table table-sm align-middle" id="rep-types-table">
              <thead><tr><th>Type</th><th class="text-end">Treatments</th><th class="text-end">Animals</th><th class="text-end">Share</th><th><span class="visually-hidden">Chart</span></th></tr></thead>
              <tbody>${typeRows}</tbody>
              <tfoot><tr class="fw-semibold"><td>Total</td><td class="text-end">${escapeHtml(treatments.count)}</td><td class="text-end">${escapeHtml(treatments.animals)}</td><td></td><td></td></tr></tfoot>
            </table>
          </div>
        </section>
        <section class="rep-section col-lg-7">
          ${heading("Treatments by month", "months")}
          <div class="rep-legend small mb-2">${legend}</div>
          <div class="table-responsive">
            <table class="table table-sm align-middle" id="rep-months-table">
              <thead><tr><th>Month</th>${TREATMENT_TYPES.map((type) => `<th class="text-end">${escapeHtml(TYPE_LABELS[type])}</th>`).join("")}<th class="text-end">Total</th><th><span class="visually-hidden">Chart</span></th></tr></thead>
              <tbody>${monthRows || empty(TREATMENT_TYPES.length + 3, "No treatments were recorded in this period.")}</tbody>
            </table>
          </div>
        </section>
      </div>
      <p class="text-muted small mb-2">The three lists below show the herd as it is on ${escapeHtml(r.today)}; the period above does not change them.</p>
      <section class="rep-section mb-4">
        ${heading("Under treatment or in quarantine", "attention")}
        <div class="table-responsive">
          <table class="table table-sm align-middle" id="rep-attention-table">
            <thead><tr><th>Animal</th><th>Status</th><th>Current medications</th><th>Last treatment</th></tr></thead>
            <tbody>${attentionRows || empty(4, "No animals are under treatment or in quarantine.")}</tbody>
          </table>
        </div>
      </section>
      <section class="rep-section mb-4">
        ${heading("In a withdrawal period", "withdrawal")}
        <div class="table-responsive">
          <table class="table table-sm align-middle" id="rep-withdrawal-table">
            <thead><tr><th>Animal</th><th>Withdrawal until</th><th>Time left</th><th>Product</th><th>Given</th></tr></thead>
            <tbody>${withdrawalRows || empty(5, "No animals are in a withdrawal period.")}</tbody>
          </table>
        </div>
      </section>
      <section class="rep-section mb-3">
        ${heading("Overdue and upcoming follow-ups", "follow-ups")}
        <div class="table-responsive">
          <table class="table table-sm align-middle" id="rep-followups-table">
            <thead><tr><th>Animal</th><th>Type</th><th>Product</th><th>Last given</th><th>Next due</th><th>Status</th></tr></thead>
            <tbody>${followUpRows || empty(6, `No follow-ups are overdue or due within ${followUps.upcomingDays} days.`)}</tbody>
          </table>
        </div>
      </section>
      <div class="rep-notes text-muted small" id="rep-definitions">
        <p class="fw-semibold mb-1">How these figures are worked out</p>
        <ul class="mb-0 ps-3">
          <li><strong>Treatments</strong> counts the medical records (treatments, vaccinations, vet visits, other) dated in the period; <strong>animals treated</strong> counts each animal once.</li>
          <li><strong>Under treatment</strong> and <strong>in quarantine</strong> list the animals whose status says so today, with their newest medical record.</li>
          <li><strong>Withdrawal</strong> lists animals whose latest withdrawal date is today or later; the last day still counts.</li>
          <li><strong>Follow-ups</strong> are treatments with a next due date that no later treatment of the same animal, type and product has replaced (the same rule as the Medical Records page). Every overdue one is listed, and those due from today to ${escapeHtml(followUps.upcomingDays)} days ahead.</li>
        </ul>
      </div>`;
  }
}
