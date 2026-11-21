// Financial Records page (view "finance"), Financial Reports page (view
// "financial-reports"), the add/edit transaction dialog (#transactionModal), and the
// transactions section of the cow details dialog.
//
// CattleController hands over through three hooks: handles()/render() from
// renderSecondaryView, and appendCattleSection() from the cow details dialog.
import {
  DEFAULT_CATEGORIES,
  FinanceService,
  presetRange,
  transactionsToCsv,
} from "../services/FinanceService.js";
import { FinanceView } from "../views/FinanceView.js";
import { downloadCsv } from "../utils/csv.js";
import { isValidAmount } from "../utils/money.js";
import { todayISO } from "../utils/DateHelpers.js";
import { showToast } from "../utils/feedback.js";

const TITLES = { finance: "Financial Records", "financial-reports": "Financial Reports" };

export class FinanceController {
  constructor({ cattleService, getCurrentView }) {
    this.cattleService = cattleService;
    this.getCurrentView = getCurrentView;
    this.service = new FinanceService();
    this.view = new FinanceView();
    // Shared by both pages, so switching between them keeps the period.
    this.range = { preset: "12m", ...presetRange("12m") };
    this.cattleId = "";
    this.transactions = [];
    this.loadToken = 0;
    this.editingId = null;
    this.saving = false;
    this.bindModal();
  }

  handles(viewName) {
    return Object.hasOwn(TITLES, viewName);
  }

  // Draws a finance page into the secondary view and loads its data. Never rejects.
  async render(viewName, titleEl, bodyEl) {
    titleEl.textContent = TITLES[viewName];
    const cattle = [...this.cattleService.getAllCattle()].sort((a, b) => a.tagNumber.localeCompare(b.tagNumber));
    if (this.cattleId && !cattle.some((c) => c.id === this.cattleId)) this.cattleId = "";
    this.view.renderLayout(bodyEl, viewName, { range: this.range, cattleId: this.cattleId, cattle });
    this.bindFilter(viewName, bodyEl);
    await this.load(viewName);
  }

  bindFilter(viewName, bodyEl) {
    const presetEl = bodyEl.querySelector("#fin-preset");
    const fromEl = bodyEl.querySelector("#fin-from");
    const toEl = bodyEl.querySelector("#fin-to");

    presetEl.addEventListener("change", () => {
      this.range = { preset: presetEl.value, ...(presetEl.value === "custom" ? { from: fromEl.value, to: toEl.value } : presetRange(presetEl.value)) };
      fromEl.value = this.range.from;
      toEl.value = this.range.to;
      this.load(viewName);
    });
    const onDateChange = () => {
      this.range = { preset: "custom", from: fromEl.value, to: toEl.value };
      presetEl.value = "custom";
      this.load(viewName);
    };
    fromEl.addEventListener("change", onDateChange);
    toEl.addEventListener("change", onDateChange);
    bodyEl.querySelector("#fin-filter").addEventListener("submit", (e) => e.preventDefault());

    bodyEl.querySelector("#fin-cattle")?.addEventListener("change", (e) => {
      this.cattleId = e.target.value;
      this.load(viewName);
    });
    bodyEl.querySelector("#fin-add-btn")?.addEventListener("click", () => this.openModal(null));
    bodyEl.querySelector("#fin-export-btn")?.addEventListener("click", () => this.exportCsv());

    bodyEl.querySelector("#fin-content").addEventListener("click", (e) => {
      const edit = e.target.closest(".fin-edit");
      const del = e.target.closest(".fin-delete");
      if (e.target.closest("#fin-retry")) this.load(viewName);
      else if (edit) this.openModal(this.transactions.find((t) => t.id === edit.dataset.id) || null);
      else if (del) this.handleDelete(del.dataset.id);
    });
  }

  // Loads and draws the current page's data. A newer load, or leaving the page,
  // makes an older response be ignored.
  async load(viewName) {
    const contentEl = document.getElementById("fin-content");
    if (!contentEl) return;
    const token = ++this.loadToken;
    const isCurrent = () => token === this.loadToken && this.getCurrentView() === viewName && contentEl.isConnected;

    const { from, to } = this.range;
    if (from && to && from > to) {
      this.transactions = [];
      contentEl.innerHTML = `<div class="alert alert-warning" role="alert">The From date must be on or before the To date.</div>`;
      return;
    }

    this.view.renderLoading(contentEl);
    try {
      if (viewName === "finance") {
        const list = await this.service.list({ from, to, cattleId: this.cattleId });
        if (!isCurrent()) return;
        this.transactions = list;
        this.view.renderRecords(contentEl, list);
      } else {
        const summary = await this.service.summary({ from, to });
        if (!isCurrent()) return;
        this.view.renderReport(contentEl, summary);
      }
    } catch (err) {
      if (err.sessionExpired || !isCurrent()) return;
      console.error(err);
      this.view.renderError(contentEl, `Couldn't load your financial records. ${err.message}`);
    }
  }

  refreshIfShown() {
    const current = this.getCurrentView();
    if (this.handles(current)) this.load(current);
  }

  exportCsv() {
    if (this.transactions.length === 0) {
      showToast("There are no transactions in this period to export.", "error");
      return;
    }
    const { from, to } = this.range;
    const name = `transactions-${from || "start"}-to-${to || todayISO()}.csv`;
    downloadCsv(name, transactionsToCsv(this.transactions));
  }

  async handleDelete(id) {
    const t = this.transactions.find((x) => x.id === id);
    if (!t || !confirm(`Delete this ${t.kind} of ${t.amount} (${t.category})?`)) return;
    try {
      await this.service.remove(id);
    } catch (err) {
      if (err.sessionExpired) return;
      if (err.status === 404) {
        showToast("That transaction was already deleted. The list has been refreshed.", "error");
        this.refreshIfShown();
      } else {
        showToast(`Couldn't delete the transaction. ${err.message}`, "error");
      }
      return;
    }
    showToast("Transaction deleted", "success");
    this.refreshIfShown();
  }

  // --- Add / edit dialog ---------------------------------------------------

  modalEl() {
    return document.getElementById("transactionModal");
  }

  bindModal() {
    document.getElementById("transaction-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.handleSubmit();
    });
  }

  field(id) {
    return document.getElementById(id);
  }

  // `transaction` null opens an empty form (linked to the animal filter, if one is set).
  openModal(transaction) {
    const el = this.modalEl();
    if (!el) return;
    this.editingId = transaction?.id || null;

    const categories = new Set(DEFAULT_CATEGORIES);
    this.transactions.forEach((t) => categories.add(t.category));
    const list = this.field("t-category-list");
    list.replaceChildren(...[...categories].map((c) => Object.assign(document.createElement("option"), { value: c })));

    const select = this.field("t-cattle");
    const cattle = [...this.cattleService.getAllCattle()].sort((a, b) => a.tagNumber.localeCompare(b.tagNumber));
    select.replaceChildren(
      Object.assign(document.createElement("option"), { value: "", textContent: "Not linked to an animal" }),
      ...cattle.map((c) =>
        Object.assign(document.createElement("option"), {
          value: c.id,
          textContent: c.nameBreed ? `${c.tagNumber} – ${c.nameBreed}` : c.tagNumber,
        })
      )
    );

    this.field("transactionModalTitle").textContent = transaction ? "Edit Transaction" : "Add Transaction";
    this.field("t-date").value = transaction?.date || todayISO();
    this.field("t-kind").value = transaction?.kind || "expense";
    this.field("t-category").value = transaction?.category || "";
    this.field("t-amount").value = transaction?.amount || "";
    select.value = transaction ? transaction.cattleId || "" : this.cattleId;
    this.field("t-description").value = transaction?.description || "";
    this.field("t-amount").setCustomValidity("");

    bootstrap.Modal.getOrCreateInstance(el).show();
  }

  formData() {
    return {
      date: this.field("t-date").value,
      kind: this.field("t-kind").value,
      category: this.field("t-category").value.trim(),
      amount: this.field("t-amount").value.trim(),
      cattleId: this.field("t-cattle").value || null,
      description: this.field("t-description").value.trim(),
    };
  }

  async handleSubmit() {
    if (this.saving) return;
    const data = this.formData();
    const amountEl = this.field("t-amount");
    if (!isValidAmount(data.amount)) {
      amountEl.setCustomValidity("Enter an amount greater than 0 with at most 2 decimal places, e.g. 125.50");
      amountEl.reportValidity();
      amountEl.addEventListener("input", () => amountEl.setCustomValidity(""), { once: true });
      return;
    }

    const saveBtn = document.querySelector('#transaction-form button[type="submit"]');
    this.saving = true;
    if (saveBtn) saveBtn.disabled = true;
    try {
      if (this.editingId) {
        await this.service.update(this.editingId, data);
        showToast("Transaction updated", "success");
      } else {
        await this.service.create(data);
        showToast("Transaction added", "success");
      }
      this.editingId = null;
      bootstrap.Modal.getOrCreateInstance(this.modalEl()).hide();
      this.refreshIfShown();
    } catch (err) {
      if (!err.sessionExpired) showToast(err.message || "Unable to save the transaction", "error");
    } finally {
      this.saving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  // --- Cow details dialog --------------------------------------------------

  // Appends a "Financial records" section for one animal to `containerEl` and fills
  // it when the list arrives. If the dialog has been redrawn meanwhile (another
  // animal opened), the detached section is simply not updated.
  async appendCattleSection(cattleId, containerEl) {
    if (!containerEl) return;
    const section = document.createElement("div");
    section.id = "cow-transactions";
    section.innerHTML = `<h6 class="mt-3">Financial records</h6><p class="text-muted small mb-0">Loading…</p>`;
    containerEl.appendChild(section);
    try {
      const list = await this.service.list({ cattleId });
      if (section.isConnected) this.view.renderCattleSection(section, list);
    } catch (err) {
      if (err.sessionExpired || !section.isConnected) return;
      section.innerHTML = `<h6 class="mt-3">Financial records</h6><p class="text-danger small mb-0"></p>`;
      section.querySelector("p").textContent = `Couldn't load this animal's transactions. ${err.message}`;
    }
  }
}
