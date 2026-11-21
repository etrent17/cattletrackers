// Weight tracking (feature 10): the Weights page (batch entry and herd-wide history), the
// "Weight history" tab in the cow details modal, and the record/edit form. Built by
// CattleController with a `host` object, like CalvingController:
//
// host = {
//   cattleService,                   the in-memory herd
//   reloadHerd(): Promise<boolean>,  refetch the herd and redraw the herd views
//   openCowDetails(id, tabId),       open (or redraw) the cow details modal on a tab
// }
import {
  WeightService, batchRows, changesSincePrevious, filterWeighings, isCalendarDate, validateWeighing, weighingPayload,
} from "../services/WeightService.js";
import { WeightView } from "../views/WeightView.js";
import { todayISO } from "../utils/DateHelpers.js";
import { showToast } from "../utils/feedback.js";

export const WEIGHT_TAB = "weights";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export class WeightController {
  constructor(host) {
    this.host = host;
    this.service = new WeightService();
    this.view = new WeightView();
    this.modalEl = document.getElementById("weighingModal");
    this.modal = this.modalEl ? new bootstrap.Modal(this.modalEl) : null;
    this.detailsEl = document.getElementById("viewCowModal");
    this.known = new Map(); // every weighing shown on screen, by id, for the edit and delete buttons
    this.editing = null; // the weighing being edited, or null while recording a new one
    this.returnToCow = null; // cow whose details modal reopens when the form closes
    this.saving = false;
    this.savingBatch = false;
    this.active = false; // true while the Weights page is the visible view
  }

  init() {
    document.body.addEventListener("click", (e) => {
      const addBtn = e.target.closest(".btn-weight-add");
      const editBtn = e.target.closest(".btn-weight-edit");
      const deleteBtn = e.target.closest(".btn-weight-delete");
      const removeRowBtn = e.target.closest(".btn-weight-batch-remove");
      if (addBtn) this.openForm({ cowId: addBtn.dataset.cattleId || "" });
      else if (editBtn && this.known.has(editBtn.dataset.id)) this.openForm({ weighing: this.known.get(editBtn.dataset.id) });
      else if (deleteBtn) this.handleDelete(deleteBtn.dataset.id);
      else if (removeRowBtn) this.removeBatchRow(removeRowBtn.closest("tr"));
    });

    document.getElementById("weight-search")?.addEventListener("input", () => this.renderTable());
    document.getElementById("weight-batch-add-row")?.addEventListener("click", () => this.view.addBatchRow(this.animals()));
    document.getElementById("weight-batch-fill")?.addEventListener("click", () => this.view.addAllAnimals(this.animals()));
    document.getElementById("weight-batch-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleBatchSubmit();
    });

    document.getElementById("weighing-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleSubmit();
    });
    // The form may have been opened from the details modal; go back there when it closes.
    this.modalEl?.addEventListener("hidden.bs.modal", () => {
      const cowId = this.returnToCow;
      this.returnToCow = null;
      if (cowId) this.host.openCowDetails(cowId, WEIGHT_TAB);
    });
  }

  // Every animal, by cow number.
  animals() {
    return this.host.cattleService
      .getAllCattle()
      .sort((a, b) => a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true }));
  }

  // ----- Weights page -----

  async show() {
    this.active = true;
    this.render();
    try {
      await this.service.loadAll();
    } catch (err) {
      if (!err.sessionExpired) showToast(`Couldn't load weighings. ${err.message}`, "error");
      return;
    }
    this.render();
  }

  hide() {
    this.active = false;
  }

  // Redraws the page from memory (no request). Safe to call when the page is not visible.
  render() {
    if (!this.active) return;
    this.view.prepareBatch(this.animals());
    this.renderTable();
  }

  renderTable() {
    const weighings = this.service.weighings;
    weighings.forEach((w) => this.known.set(w.id, w));
    this.view.renderTable(filterWeighings(weighings, this.view.getFilters()), changesSincePrevious(weighings), weighings.length);
  }

  removeBatchRow(tr) {
    if (!tr) return;
    tr.remove();
    if (!this.view.batchRowElements().length) this.view.addBatchRow(this.animals());
  }

  // Sends every row that can be saved in one request. Rows that cannot (checked here first, or
  // refused by the server) stay in the form, marked with the reason; saved rows are removed.
  async handleBatchSubmit() {
    if (this.savingBatch) return;
    const date = this.view.getBatchDate();
    if (!isCalendarDate(date)) return this.view.renderBatchResult("Enter the weighing date.", false);
    if (date > todayISO()) return this.view.renderBatchResult("The weighing date cannot be in the future.", false);

    const { send, invalid } = batchRows(this.view.getBatchRows());
    const errors = new Map(invalid.map((r) => [r.position, r.error]));
    if (!send.length) {
      this.view.applyBatchResult(this.animals(), new Set(), errors);
      this.view.renderBatchResult(invalid.length ? `Nothing saved. ${plural(invalid.length, "row")} need fixing.` : "Enter at least one animal and weight.", false);
      return;
    }

    const saveBtn = document.querySelector('#weight-batch-form button[type="submit"]');
    this.savingBatch = true;
    if (saveBtn) saveBtn.disabled = true;
    try {
      const result = await this.service.saveBatch(date, send.map(({ cattleId, weight, notes }) => ({ cattleId, weight, notes })));
      // The server reports by position in what was sent; map that back to the rows on screen.
      for (const f of result.failed) errors.set(send[f.index].position, f.error);
      const saved = new Set(result.saved.map((s) => send[s.index].position));
      this.view.applyBatchResult(this.animals(), saved, errors);
      const failedCount = errors.size;
      const message = saved.size
        ? `Saved ${plural(saved.size, "weight")} for ${date}.${failedCount ? ` ${plural(failedCount, "row")} not saved; see the marked rows.` : ""}`
        : `Nothing saved. ${plural(failedCount, "row")} need fixing.`;
      this.view.renderBatchResult(message, failedCount === 0);
      if (saved.size) {
        showToast(failedCount ? `Saved ${plural(saved.size, "weight")}; ${failedCount} not saved` : `Saved ${plural(saved.size, "weight")}`, failedCount ? "error" : "success");
        await this.afterChange();
      }
    } catch (err) {
      if (!err.sessionExpired) this.view.renderBatchResult(`Nothing saved. ${err.message}`, false);
    } finally {
      this.savingBatch = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  // ----- Cow details tab -----

  detailTab() {
    return {
      id: WEIGHT_TAB,
      label: "Weight history",
      render: (cow, pane) => this.renderHistory(cow, pane),
    };
  }

  async renderHistory(cow, pane) {
    this.view.renderHistoryLoading(pane);
    let weighings;
    try {
      weighings = await this.service.loadForCattle(cow.id);
    } catch (err) {
      if (!err.sessionExpired) this.view.renderHistoryError(pane, err.message);
      return;
    }
    weighings.forEach((w) => this.known.set(w.id, w));
    this.view.renderHistory(pane, cow, weighings);
  }

  // ----- Form -----

  openForm({ weighing = null, cowId = "" } = {}) {
    if (!this.modal) return;
    const cows = this.animals();
    if (!weighing && cows.length === 0) {
      showToast("Add an animal first, then record its weight.", "error");
      return;
    }
    this.editing = weighing;
    this.view.fillForm({ cows, weighing, cowId });

    // Bootstrap shows one modal at a time: close the details modal first and reopen it afterwards.
    const detailsOpen = this.detailsEl?.classList.contains("show");
    this.returnToCow = detailsOpen ? (weighing ? weighing.cattleId : cowId) || null : null;
    if (detailsOpen) {
      this.detailsEl.addEventListener("hidden.bs.modal", () => this.modal.show(), { once: true });
      bootstrap.Modal.getInstance(this.detailsEl)?.hide();
    } else {
      this.modal.show();
    }
  }

  async handleSubmit() {
    if (this.saving) return;
    const { cattleId, ...form } = this.view.getFormData();
    const data = weighingPayload(form);
    const problem = (!this.editing && !cattleId && "Choose the animal that was weighed") || validateWeighing(data);
    if (problem) {
      showToast(problem, "error");
      return;
    }

    const saveBtn = document.querySelector('#weighing-form button[type="submit"]');
    this.saving = true;
    if (saveBtn) saveBtn.disabled = true;
    try {
      if (this.editing) await this.service.update(this.editing.id, data);
      else await this.service.add(cattleId, data);
      // Refresh first, so the cow details that reopen when the form closes show the new data.
      await this.afterChange();
      this.modal.hide();
      showToast(this.editing ? "Weighing updated" : "Weight recorded", "success");
    } catch (err) {
      if (!err.sessionExpired) showToast(err.message || "Unable to save the weighing", "error");
    } finally {
      this.saving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async handleDelete(id) {
    const weighing = this.known.get(id);
    if (!weighing || !confirm("Delete this weighing?")) return;
    try {
      await this.service.remove(id);
    } catch (err) {
      if (err.sessionExpired) return;
      if (err.status === 404) showToast("That weighing was already deleted. The list has been refreshed.", "error");
      else {
        showToast(`Couldn't delete the weighing. ${err.message}`, "error");
        return;
      }
      await this.afterChange(weighing.cattleId);
      return;
    }
    this.known.delete(id);
    showToast("Weighing deleted", "success");
    await this.afterChange(weighing.cattleId);
  }

  // After any change: the herd (current weights) and the page are refetched. `detailsCowId`
  // redraws the history tab when the change was made from an open details modal.
  async afterChange(detailsCowId = null) {
    await this.host.reloadHerd();
    if (this.active) await this.show();
    if (detailsCowId && this.detailsEl?.classList.contains("show")) {
      this.host.openCowDetails(detailsCowId, WEIGHT_TAB);
    }
  }
}
