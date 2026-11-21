// Markup for the Financial Records page, the Financial Reports page, and the
// transactions section of the cow details dialog. Every value from the API or the
// user goes through escapeHtml(); amounts are formatted from exact decimal strings.
import { escapeHtml } from "../utils/escapeHtml.js";
import { formatCents, formatMoney, toCents } from "../utils/money.js";
import { RANGE_PRESETS, monthLabel, totalsInCents } from "../services/FinanceService.js";

const kindBadge = (kind) =>
  kind === "income"
    ? `<span class="badge bg-success">Income</span>`
    : `<span class="badge bg-danger">Expense</span>`;

const signedAmount = (t) =>
  t.kind === "income"
    ? `<span class="text-success">${escapeHtml(formatMoney(t.amount))}</span>`
    : `<span class="text-danger">-${escapeHtml(formatMoney(t.amount))}</span>`;

const netClass = (cents) => (cents < 0 ? "text-danger" : "text-success");

function statCard(label, value, id, extraClass = "", note = "") {
  return `
    <div class="col-6 col-lg-3">
      <div class="p-3 bg-white rounded border h-100">
        <div class="text-muted small">${escapeHtml(label)}</div>
        <div class="fs-4 fw-semibold ${extraClass}" id="${id}">${escapeHtml(value)}</div>
        ${note ? `<div class="text-muted small">${escapeHtml(note)}</div>` : ""}
      </div>
    </div>`;
}

export class FinanceView {
  // Filter bar plus an empty content area (#fin-content). `page` is "finance" or "financial-reports".
  renderLayout(bodyEl, page, { range, cattleId, cattle }) {
    const presets = Object.entries(RANGE_PRESETS)
      .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === range.preset ? "selected" : ""}>${escapeHtml(label)}</option>`)
      .join("");
    const animalFilter =
      page === "finance"
        ? `<div class="col-sm-6 col-lg-3">
            <label class="form-label small mb-1" for="fin-cattle">Animal</label>
            <select id="fin-cattle" class="form-select form-select-sm">
              <option value="">All transactions</option>
              ${cattle
                .map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === cattleId ? "selected" : ""}>${escapeHtml(c.tagNumber)}${c.nameBreed ? ` – ${escapeHtml(c.nameBreed)}` : ""}</option>`)
                .join("")}
            </select>
          </div>`
        : "";
    const actions =
      page === "finance"
        ? `<div class="col-12 col-lg d-flex gap-2 justify-content-lg-end">
            <button id="fin-export-btn" type="button" class="btn btn-outline-secondary btn-sm"><i class="fas fa-file-csv me-1"></i>Export CSV</button>
            <button id="fin-add-btn" type="button" class="btn btn-success btn-sm"><i class="fas fa-plus me-1"></i>Add Transaction</button>
          </div>`
        : "";

    bodyEl.innerHTML = `
      <form id="fin-filter" class="row g-2 align-items-end mb-3" novalidate>
        <div class="col-sm-6 col-lg-2">
          <label class="form-label small mb-1" for="fin-preset">Period</label>
          <select id="fin-preset" class="form-select form-select-sm">${presets}</select>
        </div>
        <div class="col-6 col-lg-2">
          <label class="form-label small mb-1" for="fin-from">From</label>
          <input id="fin-from" type="date" class="form-control form-control-sm" value="${escapeHtml(range.from)}">
        </div>
        <div class="col-6 col-lg-2">
          <label class="form-label small mb-1" for="fin-to">To</label>
          <input id="fin-to" type="date" class="form-control form-control-sm" value="${escapeHtml(range.to)}">
        </div>
        ${animalFilter}
        ${actions}
      </form>
      <div id="fin-content" aria-live="polite"></div>`;
  }

  renderLoading(contentEl) {
    contentEl.innerHTML = `<p class="text-muted"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading…</p>`;
  }

  // An error inside the page with a Retry button (#fin-retry).
  renderError(contentEl, message) {
    contentEl.innerHTML = `
      <div class="alert alert-danger d-flex flex-wrap justify-content-between align-items-center gap-2" role="alert">
        <span>${escapeHtml(message)}</span>
        <button id="fin-retry" type="button" class="btn btn-sm btn-danger">Retry</button>
      </div>`;
  }

  renderRecords(contentEl, transactions) {
    const totals = totalsInCents(transactions);
    const cards = `
      <div class="row g-3 mb-3">
        ${statCard("Income", formatCents(totals.income), "fin-total-income", "text-success")}
        ${statCard("Expenses", formatCents(totals.expenses), "fin-total-expenses", "text-danger")}
        ${statCard("Net", formatCents(totals.net), "fin-total-net", netClass(totals.net))}
        ${statCard("Transactions", String(transactions.length), "fin-total-count")}
      </div>`;

    if (transactions.length === 0) {
      contentEl.innerHTML = `${cards}<p id="fin-empty" class="text-muted">No transactions in this period. Choose Add Transaction to record one.</p>`;
      return;
    }

    const rows = transactions
      .map(
        (t) => `
        <tr data-id="${escapeHtml(t.id)}">
          <td class="text-nowrap">${escapeHtml(t.date)}</td>
          <td>${kindBadge(t.kind)}</td>
          <td>${escapeHtml(t.category)}</td>
          <td>${escapeHtml(t.description || "—")}</td>
          <td>${t.cattleTagNumber ? `<span class="badge badge-cow">${escapeHtml(t.cattleTagNumber)}</span>` : `<span class="text-muted">—</span>`}</td>
          <td class="text-end text-nowrap fw-semibold">${signedAmount(t)}</td>
          <td class="text-nowrap">
            <button type="button" class="btn btn-sm btn-outline-primary fin-edit" data-id="${escapeHtml(t.id)}" title="Edit" aria-label="Edit transaction"><i class="fas fa-edit"></i></button>
            <button type="button" class="btn btn-sm btn-outline-danger fin-delete" data-id="${escapeHtml(t.id)}" title="Delete" aria-label="Delete transaction"><i class="fas fa-trash"></i></button>
          </td>
        </tr>`
      )
      .join("");

    contentEl.innerHTML = `
      ${cards}
      <div class="table-responsive">
        <table class="table table-hover align-middle">
          <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Animal</th><th class="text-end">Amount</th><th>Actions</th></tr></thead>
          <tbody id="fin-body">${rows}</tbody>
        </table>
      </div>`;
  }

  renderReport(contentEl, summary) {
    const net = toCents(summary.net);
    const costNote =
      summary.costPerHead === null
        ? "No animals on record"
        : `Expenses ÷ ${summary.herdSize} animal${summary.herdSize === 1 ? "" : "s"} on record now`;
    const cards = `
      <div class="row g-3 mb-4">
        ${statCard("Income", formatMoney(summary.income), "fin-report-income", "text-success")}
        ${statCard("Expenses", formatMoney(summary.expenses), "fin-report-expenses", "text-danger")}
        ${statCard("Net", formatMoney(summary.net), "fin-report-net", netClass(net))}
        ${statCard("Cost per head", summary.costPerHead === null ? "—" : formatMoney(summary.costPerHead), "fin-report-cost-per-head", "", costNote)}
      </div>`;

    if (summary.count === 0) {
      contentEl.innerHTML = `${cards}<p id="fin-empty" class="text-muted">No transactions in this period. Record income and expenses on the Financial Records page.</p>`;
      return;
    }

    // Bar widths only; the figures shown are the exact strings from the API.
    const largest = Math.max(1, ...summary.byMonth.flatMap((m) => [toCents(m.income), toCents(m.expenses)]));
    const pct = (amount) => `${Math.round((toCents(amount) / largest) * 100)}%`;
    const months = summary.byMonth
      .map(
        (m) => `
        <tr>
          <td class="text-nowrap">${escapeHtml(monthLabel(m.month))}</td>
          <td class="text-end text-success">${escapeHtml(formatMoney(m.income))}</td>
          <td class="text-end text-danger">${escapeHtml(formatMoney(m.expenses))}</td>
          <td class="text-end fw-semibold ${netClass(toCents(m.net))}">${escapeHtml(formatMoney(m.net))}</td>
          <td class="w-25" aria-hidden="true">
            <div class="progress mb-1" style="height: .5rem"><div class="progress-bar bg-success" style="width: ${pct(m.income)}"></div></div>
            <div class="progress" style="height: .5rem"><div class="progress-bar bg-danger" style="width: ${pct(m.expenses)}"></div></div>
          </td>
        </tr>`
      )
      .join("");

    const categoryTable = (kind, title, total) => {
      const rows = summary.byCategory.filter((c) => c.kind === kind);
      const totalCents = toCents(total);
      const body = rows.length
        ? rows
            .map(
              (c) => `
              <tr>
                <td>${escapeHtml(c.category)}</td>
                <td class="text-end">${escapeHtml(c.count)}</td>
                <td class="text-end">${escapeHtml(formatMoney(c.total))}</td>
                <td class="text-end text-muted">${totalCents ? Math.round((toCents(c.total) / totalCents) * 100) : 0}%</td>
              </tr>`
            )
            .join("")
        : `<tr><td colspan="4" class="text-muted">None in this period.</td></tr>`;
      return `
        <div class="col-lg-6">
          <h5>${escapeHtml(title)}</h5>
          <div class="table-responsive">
            <table class="table table-sm align-middle" id="fin-categories-${kind}">
              <thead><tr><th>Category</th><th class="text-end">Entries</th><th class="text-end">Total</th><th class="text-end">Share</th></tr></thead>
              <tbody>${body}</tbody>
              <tfoot><tr class="fw-semibold"><td>Total</td><td></td><td class="text-end">${escapeHtml(formatMoney(total))}</td><td></td></tr></tfoot>
            </table>
          </div>
        </div>`;
    };

    contentEl.innerHTML = `
      ${cards}
      <h5>Income and expenses by month</h5>
      <div class="table-responsive mb-4">
        <table class="table table-sm align-middle" id="fin-months">
          <thead><tr><th>Month</th><th class="text-end">Income</th><th class="text-end">Expenses</th><th class="text-end">Net</th><th><span class="visually-hidden">Chart</span></th></tr></thead>
          <tbody>${months}</tbody>
        </table>
      </div>
      <div class="row g-4">
        ${categoryTable("income", "Income by category", summary.income)}
        ${categoryTable("expense", "Expenses by category", summary.expenses)}
      </div>
      <p class="text-muted small mt-3 mb-0">
        Cost per head is the total expenses in the selected period divided by the number of animals on record today
        (${escapeHtml(summary.herdSize)}), rounded to the cent. It does not average the herd size over the period.
      </p>`;
  }

  // The transactions section inside the cow details dialog.
  renderCattleSection(sectionEl, transactions) {
    if (transactions.length === 0) {
      sectionEl.innerHTML = `<h6 class="mt-3">Financial records</h6><p class="text-muted small mb-0">No transactions linked to this animal.</p>`;
      return;
    }
    const totals = totalsInCents(transactions);
    sectionEl.innerHTML = `
      <h6 class="mt-3">Financial records</h6>
      <div class="table-responsive">
        <table class="table table-sm align-middle mb-1">
          <thead><tr><th>Date</th><th>Category</th><th class="text-end">Amount</th></tr></thead>
          <tbody>
            ${transactions
              .map(
                (t) => `
                <tr>
                  <td class="text-nowrap">${escapeHtml(t.date)}</td>
                  <td>${escapeHtml(t.category)}${t.description ? `<br><small class="text-muted">${escapeHtml(t.description)}</small>` : ""}</td>
                  <td class="text-end text-nowrap">${signedAmount(t)}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <p class="small mb-0">
        Income ${escapeHtml(formatCents(totals.income))} · Expenses ${escapeHtml(formatCents(totals.expenses))} ·
        <strong class="${netClass(totals.net)}">Net ${escapeHtml(formatCents(totals.net))}</strong>
      </p>`;
  }
}
