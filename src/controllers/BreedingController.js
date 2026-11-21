// Breeding records: the Breeding History page, the "Breeding" tab in the cow details modal, and
// the breeding and pregnancy-check forms. Built by CattleController with a `host` object, like
// CalvingController:
//
// host = {
//   cattleService,                   the in-memory herd
//   reloadHerd(): Promise<boolean>,  refetch the herd and redraw the herd views
//   openCowDetails(id, tabId),       open (or redraw) the cow details modal on a tab
// }
import {
  BreedingService,
  breedingForCheck,
  breedingPayload,
  checkPayload,
  filterRecords,
  herdBulls,
  validateBreeding,
  validateCheck,
} from "../services/BreedingService.js";
import { BreedingView } from "../views/BreedingView.js";
import { showToast } from "../utils/feedback.js";

export const BREEDING_TAB = "breeding";

// One record form (breeding or check) in its own Bootstrap modal. Bootstrap shows one modal at a
// time, so a form opened from the cow details closes them first and reopens them when it closes.
class FormModal {
  constructor(modalId, host) {
    this.el = document.getElementById(modalId);
    this.modal = this.el ? new bootstrap.Modal(this.el) : null;
    this.detailsEl = document.getElementById("viewCowModal");
    this.returnToCow = null;
    this.el?.addEventListener("hidden.bs.modal", () => {
      const cowId = this.returnToCow;
      this.returnToCow = null;
      if (cowId) host.openCowDetails(cowId, BREEDING_TAB);
    });
  }

  show(cowId) {
    const detailsOpen = this.detailsEl?.classList.contains("show");
    this.returnToCow = detailsOpen ? cowId || null : null;
    if (detailsOpen) {
      this.detailsEl.addEventListener("hidden.bs.modal", () => this.modal.show(), { once: true });
      bootstrap.Modal.getInstance(this.detailsEl)?.hide();
    } else {
      this.modal.show();
    }
  }

  hide() {
    this.modal.hide(); // its hidden handler reopens the cow details when the form came from there
  }
}

export class BreedingController {
  constructor(host) {
    this.host = host;
    this.service = new BreedingService();
    this.view = new BreedingView();
    this.breedingForm = new FormModal("breedingModal", host);
    this.checkForm = new FormModal("pregcheckModal", host);
    this.detailsEl = document.getElementById("viewCowModal");
    this.knownBreedings = new Map(); // every breeding shown on screen, by id
    this.knownChecks = new Map();
    this.editingBreeding = null;
    this.editingCheck = null;
    this.cowBreedings = []; // the breedings of the cow chosen in the check form
    this.breedingTouched = false; // the user picked the check's breeding themselves
    this.loadToken = 0;
    this.saving = false;
    this.active = false; // true while the Breeding History page is the visible view
  }

  init() {
    document.body.addEventListener("click", (e) => {
      const target = (cls) => e.target.closest(cls);
      let btn;
      if ((btn = target(".btn-breeding-add"))) this.openBreedingForm({ cowId: btn.dataset.cattleId || "" });
      else if ((btn = target(".btn-breeding-edit")) && this.knownBreedings.has(btn.dataset.id)) {
        this.openBreedingForm({ event: this.knownBreedings.get(btn.dataset.id) });
      } else if ((btn = target(".btn-breeding-delete"))) this.handleDelete("breeding", btn.dataset.id);
      else if ((btn = target(".btn-pregcheck-add"))) {
        this.openCheckForm({ cowId: btn.dataset.cattleId || "", breedingId: btn.dataset.breedingId || "" });
      } else if ((btn = target(".btn-pregcheck-edit")) && this.knownChecks.has(btn.dataset.id)) {
        this.openCheckForm({ event: this.knownChecks.get(btn.dataset.id) });
      } else if ((btn = target(".btn-pregcheck-delete"))) this.handleDelete("check", btn.dataset.id);
    });

    document.getElementById("breeding-search")?.addEventListener("input", () => this.renderTables());

    document.getElementById("breeding-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitBreeding();
    });
    for (const id of ["br-date", "br-sire-bull"]) {
      document.getElementById(id)?.addEventListener(id === "br-date" ? "input" : "change", () => this.updateBreedingForm());
    }

    document.getElementById("pregcheck-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitCheck();
    });
    document.getElementById("pc-cow")?.addEventListener("change", () => this.loadCowBreedings(""));
    document.getElementById("pc-date")?.addEventListener("change", () => this.pickBreeding());
    document.getElementById("pc-breeding")?.addEventListener("change", () => (this.breedingTouched = true));
  }

  // ----- Breeding History page -----

  async show() {
    this.active = true;
    this.render();
    try {
      await this.service.loadAll();
    } catch (err) {
      if (!err.sessionExpired) showToast(`Couldn't load breeding records. ${err.message}`, "error");
      return;
    }
    this.render();
  }

  hide() {
    this.active = false;
  }

  render() {
    if (!this.active) return;
    this.view.renderNeedsCheck(this.service.needsCheck, this.service.checkAfterDays);
    this.renderTables();
  }

  renderTables() {
    const { breedings, checks } = this.service;
    breedings.forEach((e) => this.knownBreedings.set(e.id, e));
    checks.forEach((e) => this.knownChecks.set(e.id, e));
    const query = this.view.getQuery();
    this.view.renderTables(filterRecords(breedings, query), filterRecords(checks, query), {
      breedings: breedings.length,
      checks: checks.length,
    });
  }

  // ----- Cow details tab -----

  detailTab() {
    return {
      id: BREEDING_TAB,
      label: "Breeding",
      appliesTo: (cow) => cow.gender !== "male",
      render: (cow, pane) => this.renderHistory(cow, pane),
    };
  }

  async renderHistory(cow, pane) {
    this.view.renderHistoryLoading(pane);
    let breedings;
    let checks;
    try {
      [breedings, checks] = await Promise.all([this.service.loadBreedingsFor(cow.id), this.service.loadChecksFor(cow.id)]);
    } catch (err) {
      if (!err.sessionExpired) this.view.renderHistoryError(pane, err.message);
      return;
    }
    breedings.forEach((e) => this.knownBreedings.set(e.id, e));
    checks.forEach((e) => this.knownChecks.set(e.id, e));
    this.view.renderHistory(pane, cow, breedings, checks);
  }

  // ----- Forms -----

  // Animals that can be bred: everything not recorded as male.
  cows() {
    return this.host.cattleService
      .getAllCattle()
      .filter((c) => c.gender !== "male")
      .sort((a, b) => a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true }));
  }

  openBreedingForm({ event = null, cowId = "" } = {}) {
    if (!this.breedingForm.modal) return;
    const cows = this.cows();
    if (!event && cows.length === 0) {
      showToast("Add a cow first, then record her breeding.", "error");
      return;
    }
    this.editingBreeding = event;
    this.view.fillBreedingForm({ cows, bulls: herdBulls(this.host.cattleService.getAllCattle()), event, cowId });
    this.updateBreedingForm();
    // The gestation length comes from the server; fetch it if the page has not been opened yet.
    if (!this.service.gestationDays) {
      this.service.loadNeedsCheck().then(() => this.updateBreedingForm(), () => {});
    }
    this.breedingForm.show(event ? event.cattleId : cowId);
  }

  updateBreedingForm() {
    this.view.updateBreedingForm(this.service.gestationDays, Boolean(this.editingBreeding));
  }

  openCheckForm({ event = null, cowId = "", breedingId = "" } = {}) {
    if (!this.checkForm.modal) return;
    const cows = this.cows();
    if (!event && cows.length === 0) {
      showToast("Add a cow first, then record her pregnancy check.", "error");
      return;
    }
    this.editingCheck = event;
    this.view.fillCheckForm({ cows, event, cowId });
    this.loadCowBreedings(event ? event.breedingId || "" : breedingId, Boolean(event || breedingId));
    this.checkForm.show(event ? event.cattleId : cowId);
  }

  // Loads the chosen cow's breedings into the check form. `selectedId` is kept when given
  // (editing, or opened from the needs-check list); otherwise the likely breeding is picked.
  async loadCowBreedings(selectedId, keepSelection = false) {
    const cowId = document.getElementById("pc-cow").value;
    const token = ++this.loadToken;
    this.cowBreedings = [];
    this.breedingTouched = keepSelection;
    this.view.renderBreedingOptions(null, "");
    if (!cowId) return;
    let breedings;
    try {
      breedings = await this.service.loadBreedingsFor(cowId);
    } catch (err) {
      if (!err.sessionExpired && token === this.loadToken) showToast(`Couldn't load her breedings. ${err.message}`, "error");
      breedings = [];
    }
    if (token !== this.loadToken) return; // another cow was chosen meanwhile
    this.cowBreedings = breedings;
    this.view.renderBreedingOptions(breedings, selectedId);
    if (!keepSelection) this.pickBreeding();
  }

  pickBreeding() {
    if (this.breedingTouched) return;
    const match = breedingForCheck(this.cowBreedings, document.getElementById("pc-date").value);
    this.view.renderBreedingOptions(this.cowBreedings, match ? match.id : "");
  }

  async submitBreeding() {
    if (this.saving) return;
    const { cattleId, ...form } = this.view.getBreedingForm();
    const data = breedingPayload(form);
    const problem = (!this.editingBreeding && !cattleId && "Choose the cow that was bred") || validateBreeding(data);
    if (problem) return showToast(problem, "error");

    await this.save("#breeding-form", async () => {
      if (this.editingBreeding) {
        await this.service.updateBreeding(this.editingBreeding.id, data);
        return "Breeding record updated";
      }
      const created = await this.service.addBreeding(cattleId, data);
      return `Breeding recorded. Expected calving ${created.expectedCalvingDate}`;
    }, this.breedingForm);
  }

  async submitCheck() {
    if (this.saving) return;
    const { cattleId, ...form } = this.view.getCheckForm();
    const data = checkPayload(form);
    const linked = this.cowBreedings.find((b) => b.id === data.breedingId);
    const problem = (!this.editingCheck && !cattleId && "Choose the cow that was checked") || validateCheck(data, undefined, linked?.breedingDate || "");
    if (problem) return showToast(problem, "error");

    await this.save("#pregcheck-form", async () => {
      if (this.editingCheck) {
        await this.service.updateCheck(this.editingCheck.id, data);
        return "Pregnancy check updated";
      }
      await this.service.addCheck(cattleId, data);
      return "Pregnancy check recorded";
    }, this.checkForm);
  }

  // Runs a save with the submit button disabled; on success refreshes and closes the form.
  async save(formSelector, action, formModal) {
    const saveBtn = document.querySelector(`${formSelector} button[type="submit"]`);
    this.saving = true;
    if (saveBtn) saveBtn.disabled = true;
    try {
      const message = await action();
      // Refresh first, so the cow details that reopen when the form closes show the new data.
      await this.afterChange();
      formModal.hide();
      showToast(message, "success");
    } catch (err) {
      if (!err.sessionExpired) showToast(err.message || "Unable to save the record", "error");
    } finally {
      this.saving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async handleDelete(kind, id) {
    const known = kind === "breeding" ? this.knownBreedings : this.knownChecks;
    const label = kind === "breeding" ? "breeding record" : "pregnancy check";
    const event = known.get(id);
    if (!event || !confirm(`Delete this ${label}?`)) return;
    try {
      await (kind === "breeding" ? this.service.removeBreeding(id) : this.service.removeCheck(id));
    } catch (err) {
      if (err.sessionExpired) return;
      if (err.status !== 404) {
        showToast(`Couldn't delete the ${label}. ${err.message}`, "error");
        return;
      }
      showToast(`That ${label} was already deleted. The list has been refreshed.`, "error");
      await this.afterChange(event.cattleId);
      return;
    }
    known.delete(id);
    showToast(`${label[0].toUpperCase()}${label.slice(1)} deleted`, "success");
    await this.afterChange(event.cattleId);
  }

  // After any change: the herd (expected calving date, status) and the page are refetched.
  // `detailsCowId` redraws the tab when the change was made from an open details modal.
  async afterChange(detailsCowId = null) {
    await this.host.reloadHerd();
    if (this.active) await this.show();
    if (detailsCowId && this.detailsEl?.classList.contains("show")) {
      this.host.openCowDetails(detailsCowId, BREEDING_TAB);
    }
  }
}
