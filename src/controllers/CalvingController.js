// Calving records: the Calving Records page, the "Calving history" tab in the cow details
// modal, and the record/edit form. CattleController creates one of these and hands it what it
// needs from the rest of the app (`host`), so this file never imports the main controller.
//
// host = {
//   cattleService,                   the in-memory herd
//   reloadHerd(): Promise<boolean>,  refetch the herd and redraw the herd views
//   openCowDetails(id, tabId),       open (or redraw) the cow details modal on a tab
// }
import { CalvingService, calvingPayload, calvingYears, filterCalvings, validateCalving } from "../services/CalvingService.js";
import { CalvingView } from "../views/CalvingView.js";
import { showToast } from "../utils/feedback.js";

export const CALVING_TAB = "calvings";

export class CalvingController {
  constructor(host) {
    this.host = host;
    this.service = new CalvingService();
    this.view = new CalvingView();
    this.modalEl = document.getElementById("calvingModal");
    this.modal = this.modalEl ? new bootstrap.Modal(this.modalEl) : null;
    this.detailsEl = document.getElementById("viewCowModal");
    this.known = new Map(); // every event shown on screen, by id, for the edit and delete buttons
    this.editing = null; // the event being edited, or null while recording a new one
    this.returnToCow = null; // cow whose details modal reopens when the form closes
    this.saving = false;
    this.active = false; // true while the Calving Records page is the visible view
  }

  init() {
    document.body.addEventListener("click", (e) => {
      const addBtn = e.target.closest(".btn-calving-add");
      const editBtn = e.target.closest(".btn-calving-edit");
      const deleteBtn = e.target.closest(".btn-calving-delete");
      if (addBtn) this.openForm({ cowId: addBtn.dataset.cattleId || "" });
      else if (editBtn && this.known.has(editBtn.dataset.id)) this.openForm({ event: this.known.get(editBtn.dataset.id) });
      else if (deleteBtn) this.handleDelete(deleteBtn.dataset.id);
    });

    for (const id of ["calving-search", "calving-filter-outcome", "calving-filter-year"]) {
      document.getElementById(id)?.addEventListener(id === "calving-search" ? "input" : "change", () => this.renderTable());
    }

    document.getElementById("calving-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleSubmit();
    });
    for (const id of ["cv-cow", "cv-outcome"]) {
      document.getElementById(id)?.addEventListener("change", () => this.updateFormOptions());
    }
    // The form may have been opened from the details modal; go back there when it closes.
    this.modalEl?.addEventListener("hidden.bs.modal", () => {
      const cowId = this.returnToCow;
      this.returnToCow = null;
      if (cowId) this.host.openCowDetails(cowId, CALVING_TAB);
    });
  }

  // ----- Calving Records page -----

  // Called when the page becomes the visible view: draws what is known, then refetches.
  async show() {
    this.active = true;
    this.render();
    try {
      await this.service.loadAll();
    } catch (err) {
      if (!err.sessionExpired) showToast(`Couldn't load calving records. ${err.message}`, "error");
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
    this.view.renderUpcoming(this.host.cattleService.getUpcomingCalvings(Infinity));
    this.view.renderYearOptions(calvingYears(this.service.events));
    this.renderTable();
  }

  renderTable() {
    const events = this.service.events;
    events.forEach((e) => this.known.set(e.id, e));
    this.view.renderTable(filterCalvings(events, this.view.getFilters()), events.length);
  }

  // ----- Cow details tab -----

  // The tab this feature adds to the cow details modal (see CattleController.detailTabs).
  detailTab() {
    return {
      id: CALVING_TAB,
      label: "Calving history",
      appliesTo: (cow) => cow.gender !== "male",
      render: (cow, pane) => this.renderHistory(cow, pane),
    };
  }

  async renderHistory(cow, pane) {
    this.view.renderHistoryLoading(pane);
    let events;
    try {
      events = await this.service.loadForCattle(cow.id);
    } catch (err) {
      if (!err.sessionExpired) this.view.renderHistoryError(pane, err.message);
      return;
    }
    events.forEach((e) => this.known.set(e.id, e));
    this.view.renderHistory(pane, cow, events);
  }

  // ----- Form -----

  // Animals that can calve: everything not recorded as male.
  cows() {
    return this.host.cattleService
      .getAllCattle()
      .filter((c) => c.gender !== "male")
      .sort((a, b) => a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true }));
  }

  openForm({ event = null, cowId = "" } = {}) {
    if (!this.modal) return;
    const cows = this.cows();
    if (!event && cows.length === 0) {
      showToast("Add a cow first, then record her calving.", "error");
      return;
    }
    this.editing = event;
    this.view.fillForm({ cows, event, cowId });
    this.updateFormOptions();

    // Bootstrap shows one modal at a time: close the details modal first and reopen it afterwards.
    const detailsOpen = this.detailsEl?.classList.contains("show");
    this.returnToCow = detailsOpen ? (event ? event.cattleId : cowId) || null : null;
    if (detailsOpen) {
      this.detailsEl.addEventListener("hidden.bs.modal", () => this.modal.show(), { once: true });
      bootstrap.Modal.getInstance(this.detailsEl)?.hide();
    } else {
      this.modal.show();
    }
  }

  updateFormOptions() {
    const cow = this.host.cattleService.getCattleById(document.getElementById("cv-cow").value);
    this.view.updateFormOptions(cow);
  }

  async handleSubmit() {
    if (this.saving) return;
    const { cattleId, ...form } = this.view.getFormData();
    const data = calvingPayload(form);
    const problem =
      (!this.editing && !cattleId && "Choose the cow that calved") ||
      validateCalving(data) ||
      (data.addCalf && this.host.cattleService.isDuplicateTag(data.calfTag) && "That calf number is already used by another animal");
    if (problem) {
      showToast(problem, "error");
      return;
    }

    const saveBtn = document.querySelector('#calving-form button[type="submit"]');
    this.saving = true;
    if (saveBtn) saveBtn.disabled = true;
    try {
      let message = "Calving record updated";
      if (this.editing) {
        await this.service.update(this.editing.id, data);
      } else {
        const created = await this.service.add(cattleId, data);
        message = created.calf ? `Calving recorded and calf ${created.calf.tagNumber} added to the herd` : "Calving recorded";
      }
      // Refresh first, so the cow details that reopen when the form closes show the new data.
      await this.afterChange();
      this.modal.hide(); // its hidden handler reopens the cow details when the form came from there
      showToast(message, "success");
    } catch (err) {
      if (!err.sessionExpired) showToast(err.message || "Unable to save the calving record", "error");
    } finally {
      this.saving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async handleDelete(id) {
    const event = this.known.get(id);
    if (!event || !confirm("Delete this calving record?")) return;
    try {
      await this.service.remove(id);
    } catch (err) {
      if (err.sessionExpired) return;
      if (err.status === 404) showToast("That calving record was already deleted. The list has been refreshed.", "error");
      else {
        showToast(`Couldn't delete the calving record. ${err.message}`, "error");
        return;
      }
      await this.afterChange(event.cattleId);
      return;
    }
    this.known.delete(id);
    showToast("Calving record deleted", "success");
    await this.afterChange(event.cattleId);
  }

  // After any change: the herd (last calving date, a new calf) and the page are refetched.
  // `detailsCowId` redraws the history tab when the change was made from an open details modal.
  async afterChange(detailsCowId = null) {
    await this.host.reloadHerd();
    if (this.active) await this.show();
    if (detailsCowId && this.detailsEl?.classList.contains("show")) {
      this.host.openCowDetails(detailsCowId, CALVING_TAB);
    }
  }
}
