// Medical records: the Medical Records page, the "Treatments" tab in the cow details modal, the
// record/edit form, and the dashboard's Scheduled Treatments figure and overdue alerts.
// CattleController creates one of these and hands it what it needs from the rest of the app
// (`host`), so this file never imports the main controller.
//
// host = {
//   cattleService,                   the in-memory herd
//   reloadHerd(): Promise<boolean>,  refetch the herd and redraw the herd views
//   openCowDetails(id, tabId),       open (or redraw) the cow details modal on a tab
// }
import {
  TreatmentService,
  animalsInWithdrawal,
  dueStatus,
  filterTreatments,
  followUpDraft,
  productSuggestions,
  summarizeDue,
  treatmentPayload,
  validateTreatment,
} from "../services/TreatmentService.js";
import { TreatmentView, treatmentTitle } from "../views/TreatmentView.js";
import { DashboardView } from "../views/DashboardView.js";
import { showToast } from "../utils/feedback.js";

export const TREATMENT_TAB = "treatments";

export class TreatmentController {
  constructor(host) {
    this.host = host;
    this.service = new TreatmentService();
    this.view = new TreatmentView();
    this.dashboard = new DashboardView();
    this.modalEl = document.getElementById("treatmentModal");
    this.modal = this.modalEl ? new bootstrap.Modal(this.modalEl) : null;
    this.detailsEl = document.getElementById("viewCowModal");
    this.known = new Map(); // every treatment shown on screen, by id, for the edit and delete buttons
    this.editing = null; // the treatment being edited, or null while recording a new one
    this.returnToCow = null; // animal whose details modal reopens when the form closes
    this.saving = false;
    this.active = false; // true while the Medical Records page is the visible view
    this.herdKey = null; // the herd the open follow-ups were last loaded for (see render)
    this.dueError = null;
  }

  init() {
    document.body.addEventListener("click", (e) => {
      const addBtn = e.target.closest(".btn-treatment-add");
      const followBtn = e.target.closest(".btn-treatment-followup");
      const editBtn = e.target.closest(".btn-treatment-edit");
      const deleteBtn = e.target.closest(".btn-treatment-delete");
      const openBtn = e.target.closest(".btn-treatment-open");
      if (addBtn) this.openForm({ cowId: addBtn.dataset.cattleId || "" });
      else if (followBtn && this.known.has(followBtn.dataset.id)) this.openForm({ draft: followUpDraft(this.known.get(followBtn.dataset.id)) });
      else if (editBtn && this.known.has(editBtn.dataset.id)) this.openForm({ treatment: this.known.get(editBtn.dataset.id) });
      else if (deleteBtn) this.handleDelete(deleteBtn.dataset.id);
      else if (openBtn) this.host.openCowDetails(openBtn.dataset.cattleId, TREATMENT_TAB);
    });

    document.getElementById("treatment-search")?.addEventListener("input", () => this.renderTable());
    document.getElementById("treatment-filter-type")?.addEventListener("change", () => this.renderTable());

    document.getElementById("treatment-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleSubmit();
    });
    // The form may have been opened from the details modal; go back there when it closes.
    this.modalEl?.addEventListener("hidden.bs.modal", () => {
      const cowId = this.returnToCow;
      this.returnToCow = null;
      if (cowId) this.host.openCowDetails(cowId, TREATMENT_TAB);
    });
  }

  // ----- Medical Records page -----

  // Called when the page becomes the visible view: draws what is known, then refetches.
  async show() {
    this.active = true;
    this.render();
    try {
      await Promise.all([this.service.loadAll(), this.refreshDue()]);
    } catch (err) {
      if (!err.sessionExpired) showToast(`Couldn't load medical records. ${err.message}`, "error");
    }
    this.render();
  }

  hide() {
    this.active = false;
  }

  // Redraws the dashboard figures and, when visible, the page, from memory. CattleController
  // calls this after every herd change. Deleting or renaming an animal changes its follow-ups on
  // the server, so when the herd itself changed, the open follow-ups are refetched once.
  render() {
    const herdKey = this.host.cattleService.getAllCattle().map((c) => `${c.id}|${c.tagNumber}|${c.nameBreed}`).join("\n");
    if (herdKey !== this.herdKey) {
      this.herdKey = herdKey;
      this.refreshDue().catch(() => {}).then(() => this.render());
    }
    this.renderDashboard();
    if (!this.active) return;
    if (this.dueError) this.view.renderDueError(this.dueError);
    else this.view.renderDue(this.service.due);
    this.view.renderWithdrawals(animalsInWithdrawal(this.host.cattleService.getAllCattle()));
    this.renderTable();
  }

  renderTable() {
    const list = this.service.treatments;
    list.forEach((t) => this.known.set(t.id, t));
    this.view.renderTable(filterTreatments(list, this.view.getFilters()), list.length, this.openIds());
  }

  openIds() {
    return new Set(this.service.due.map((t) => t.id));
  }

  // Fetches the open follow-ups. Errors are kept for the page and the dashboard, and rethrown.
  async refreshDue() {
    try {
      await this.service.loadDue();
      this.dueError = null;
      this.service.due.forEach((t) => this.known.set(t.id, t));
    } catch (err) {
      this.dueError = err.message;
      if (!this.active) this.renderDashboard();
      throw err;
    }
  }

  // Scheduled Treatments (overdue plus due within the next DUE_WINDOW_DAYS days) and one alert per
  // overdue follow-up.
  renderDashboard() {
    if (this.dueError || !this.service.dueLoaded) {
      this.dashboard.renderTreatmentsDue(null);
      return;
    }
    const { overdue, scheduled } = summarizeDue(this.service.due);
    this.dashboard.renderTreatmentsDue({ scheduled, overdue: overdue.length });
    this.dashboard.renderAlerts(
      "treatments",
      overdue.map((t) => ({
        icon: "fas fa-syringe text-danger",
        title: "Treatment overdue",
        detail: `${treatmentTitle(t)} for ${t.cattleTag} ${t.cattleName || "Unnamed"} (due ${t.nextDueDate})`,
        badge: dueStatus(t.nextDueDate).label,
        badgeClass: "bg-danger",
        cattleId: t.cattleId,
        buttonClass: "btn-treatment-open",
      }))
    );
  }

  // ----- Cow details tab -----

  // The tab this feature adds to the cow details modal (see CattleController.detailTabs).
  detailTab() {
    return {
      id: TREATMENT_TAB,
      label: "Treatments",
      render: (cow, pane) => this.renderHistory(cow, pane),
    };
  }

  async renderHistory(cow, pane) {
    this.view.renderHistoryLoading(pane);
    let list;
    try {
      list = await this.service.loadForCattle(cow.id);
    } catch (err) {
      if (!err.sessionExpired) this.view.renderHistoryError(pane, err.message);
      return;
    }
    list.forEach((t) => this.known.set(t.id, t));
    this.view.renderHistory(pane, cow, list, this.openIds());
  }

  // ----- Form -----

  cows() {
    return this.host.cattleService
      .getAllCattle()
      .sort((a, b) => a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true }));
  }

  openForm({ treatment = null, draft = null, cowId = "" } = {}) {
    if (!this.modal) return;
    const cows = this.cows();
    if (!treatment && cows.length === 0) {
      showToast("Add an animal first, then record its treatments.", "error");
      return;
    }
    this.editing = treatment;
    this.view.fillForm({ cows, treatment, draft, cowId, products: productSuggestions([...this.service.treatments, ...this.service.due]) });

    // Bootstrap shows one modal at a time: close the details modal first and reopen it afterwards.
    const detailsOpen = this.detailsEl?.classList.contains("show");
    this.returnToCow = detailsOpen ? (treatment?.cattleId || draft?.cattleId || cowId || null) : null;
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
    const data = treatmentPayload(form);
    const problem = (!this.editing && !cattleId && "Choose the animal that was treated") || validateTreatment(data);
    if (problem) {
      showToast(problem, "error");
      return;
    }

    const saveBtn = document.querySelector('#treatment-form button[type="submit"]');
    this.saving = true;
    if (saveBtn) saveBtn.disabled = true;
    try {
      if (this.editing) await this.service.update(this.editing.id, data);
      else await this.service.add(cattleId, data);
      // Refresh first, so the cow details that reopen when the form closes show the new data.
      await this.afterChange();
      this.modal.hide(); // its hidden handler reopens the cow details when the form came from there
      showToast(this.editing ? "Treatment updated" : "Treatment recorded", "success");
    } catch (err) {
      if (!err.sessionExpired) showToast(err.message || "Unable to save the treatment", "error");
    } finally {
      this.saving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async handleDelete(id) {
    const treatment = this.known.get(id);
    if (!treatment || !confirm("Delete this treatment record?")) return;
    try {
      await this.service.remove(id);
    } catch (err) {
      if (err.sessionExpired) return;
      if (err.status === 404) showToast("That treatment was already deleted. The list has been refreshed.", "error");
      else {
        showToast(`Couldn't delete the treatment. ${err.message}`, "error");
        return;
      }
      await this.afterChange(treatment.cattleId);
      return;
    }
    this.known.delete(id);
    showToast("Treatment deleted", "success");
    await this.afterChange(treatment.cattleId);
  }

  // After any change: the herd (withdrawal dates), the open follow-ups and the page are refetched.
  // `detailsCowId` redraws the treatments tab when the change was made from an open details modal.
  async afterChange(detailsCowId = null) {
    await this.host.reloadHerd();
    if (this.active) {
      await this.show();
    } else {
      await this.refreshDue().catch(() => {});
      this.render();
    }
    if (detailsCowId && this.detailsEl?.classList.contains("show")) {
      this.host.openCowDetails(detailsCowId, TREATMENT_TAB);
    }
  }
}
