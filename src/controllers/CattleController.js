import { CattleService } from "../services/CattleService.js";
import { UsersController } from "./UsersController.js";
import { FinanceController } from "./FinanceController.js";
import { DashboardView } from "../views/DashboardView.js";
import { FormView } from "../views/FormView.js";
import { ListView } from "../views/ListView.js";
import { SettingsView } from "../views/SettingsView.js";
import { calculateAge, formatGender, formatHealthStatus } from "../utils/DateHelpers.js";
import { hideErrorBanner, showErrorBanner, showToast } from "../utils/feedback.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { CalvingController } from "./CalvingController.js";
import { TreatmentController } from "./TreatmentController.js";
import { withdrawalBadge } from "../views/TreatmentView.js";
import { BreedingController } from "./BreedingController.js";
import { WeightController } from "./WeightController.js";
import { isOnline, probe } from "../utils/connectivity.js";

// Pages that work from the herd saved on this device (feature 14). Every other page reads or
// writes records that are only on the server, and shows "needs a connection" while offline.
const OFFLINE_VIEWS = new Set(["dashboard", "cattle", "settings"]);

const QUEUED_NOTE = "Saved on this device. It will sync when the connection returns.";

export class CattleController {
  // `sync` is the SyncEngine (src/services/SyncEngine.js) that keeps the herd available offline.
  constructor({ sync = null } = {}) {
    this.sync = sync;
    this.cattleService = new CattleService({ sync });
    this.dashboardView = new DashboardView();
    this.formView = new FormView();
    this.listView = new ListView();
    this.settingsView = new SettingsView();
    this.editingId = null;
    this.saving = false;
    this.currentView = "dashboard";
    this.reapplying = null; // the unsynced change the open form is doing again (see reapplyUnsynced)

    // Record pages (calvings, and later treatments, breedings, weights). Each has its own
    // controller, built with this `host` object, and may add a tab to the cow details modal.
    const host = {
      cattleService: this.cattleService,
      reloadHerd: () => this.loadData(),
      openCowDetails: (id, tabId) => this.handleInspect(id, tabId),
    };
    this.calvingController = new CalvingController(host);
    this.treatmentController = new TreatmentController(host);
    this.breedingController = new BreedingController(host);
    // view name -> controller with init(), show(), hide(), render(), detailTab()
    this.recordPages = {
      calving: this.calvingController,
      medical: this.treatmentController,
      breeding: this.breedingController,
      weights: new WeightController(host),
    };
    // Tabs after "Details" in the cow details modal: { id, label, appliesTo?(cow), render(cow, pane) }
    this.detailTabs = Object.values(this.recordPages).map((page) => page.detailTab());
    this.financeController = new FinanceController({ cattleService: this.cattleService, getCurrentView: () => this.currentView });
  }

  // Listeners go on first so the page stays usable when the load fails.
  async init() {
    this.setupEventListeners();
    await this.loadData();
  }

  // Loads the herd from the server and redraws; without a connection, from the copy saved on
  // this device (the sync banner then says so). On failure shows the error
  // banner with a Retry button instead of an empty page. Returns true on success.
  async loadData() {
    try {
      await this.cattleService.loadData();
    } catch (err) {
      if (!err.sessionExpired) {
        showErrorBanner(`Couldn't load your cattle records. ${err.message}`, () => this.loadData());
      }
      return false;
    }
    hideErrorBanner();
    this.refreshAllViews();
    return true;
  }

  setupEventListeners() {
    // Top navbar & sidebar navigation links
    document.querySelectorAll("[data-view]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const view = link.dataset.view;
        this.switchView(view);
      });
    });

    // "Try again" on the needs-a-connection page
    document.getElementById("needs-connection-retry")?.addEventListener("click", async (e) => {
      const button = e.currentTarget;
      button.disabled = true;
      const online = await probe();
      button.disabled = false;
      if (online) this.switchView(this.currentView);
      else this.showNotification("Still no connection to the server.", "error");
    });

    // Closing the cattle form ends a re-apply that was not saved; its entry stays in the list.
    document.getElementById("cattleModal")?.addEventListener("hidden.bs.modal", () => {
      this.reapplying = null;
    });

    // Open Add New Cow Modal
    document.getElementById("open-add-modal-btn")?.addEventListener("click", () => {
      this.editingId = null;
      this.reapplying = null;
      this.formView.resetForm();
      this.formView.openModal(false);
    });

    // Save / Update Cow Form
    document.getElementById("cattle-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.handleFormSubmit();
    });

    // Search & status filter on Cattle Records view
    document.getElementById("search-cattle")?.addEventListener("input", () => this.renderCattleList());
    document.getElementById("filter-status")?.addEventListener("change", () => this.renderCattleList());

    Object.values(this.recordPages).forEach((page) => page.init());

    // Event delegation for Edit / View / Delete buttons in both Dashboard & All Cattle tables
    document.body.addEventListener("click", async (e) => {
      const editBtn = e.target.closest(".btn-edit");
      const viewBtn = e.target.closest(".btn-view");
      const deleteBtn = e.target.closest(".btn-delete");

      if (editBtn) {
        this.handleEdit(editBtn.dataset.id);
      } else if (viewBtn) {
        this.handleInspect(viewBtn.dataset.id);
      } else if (deleteBtn) {
        await this.handleDelete(deleteBtn.dataset.id);
      }
    });
  }

  switchView(viewName) {
    this.currentView = viewName;

    // Update active state on sidebar & navbar
    document.querySelectorAll("[data-view]").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === viewName);
    });

    document.querySelectorAll(".app-view").forEach((sec) => sec.classList.remove("active"));
    Object.values(this.recordPages).forEach((page) => page.hide());

    if (!isOnline() && !OFFLINE_VIEWS.has(viewName)) {
      // Nothing is fetched and none of the page's buttons are reachable until the connection returns.
      const title = document.querySelector(`.nav-link[data-view="${viewName}"]`)?.textContent.trim() || "This page";
      document.getElementById("needs-connection-title").textContent = title;
      document.getElementById("view-needs-connection").classList.add("active");
      return;
    }

    if (this.recordPages[viewName]) {
      // A record page has its own section, #view-<name>, and loads its own data.
      document.getElementById(`view-${viewName}`).classList.add("active");
      this.recordPages[viewName].show();
    } else if (viewName === "dashboard") {
      document.getElementById("view-dashboard").classList.add("active");
      this.refreshAllViews();
    } else if (viewName === "cattle") {
      document.getElementById("view-cattle").classList.add("active");
      this.renderCattleList();
    } else {
      document.getElementById("view-secondary").classList.add("active");
      this.renderSecondaryView(viewName);
      if (viewName === "settings") this.applyOfflineSettings();
    }
  }

  // The app went online or offline (called by SyncController). Pages that need the server swap
  // with the needs-a-connection page; the settings page locks or unlocks its password form.
  connectivityChanged() {
    if (!OFFLINE_VIEWS.has(this.currentView)) this.switchView(this.currentView);
    else if (this.currentView === "settings") this.applyOfflineSettings();
  }

  // Changing the password needs the server: while offline the form is disabled and says why.
  applyOfflineSettings() {
    const form = document.getElementById("settings-password-form");
    if (!form) return;
    const offline = !isOnline();
    form.querySelectorAll("input, button").forEach((el) => {
      el.disabled = offline;
    });
    let note = document.getElementById("settings-password-offline");
    if (offline && !note) {
      note = document.createElement("div");
      note.id = "settings-password-offline";
      note.className = "alert alert-warning py-2";
      note.textContent = "Changing your password needs a connection.";
      form.before(note);
    } else if (!offline) {
      note?.remove();
    }
  }

  // Renders the All Cattle table,
  // narrowed by the search box and status filter.
  renderCattleList() {
    const query = document.getElementById("search-cattle")?.value || "";
    const status = document.getElementById("filter-status")?.value || "all";
    this.listView.renderList(this.cattleService.searchCattle(query, status), "All Cattle Records");
  }

  renderSecondaryView(viewName) {
    const titleEl = document.getElementById("secondary-view-title");
    const bodyEl = document.getElementById("secondary-view-body");
    if (this.financeController.handles(viewName)) return this.financeController.render(viewName, titleEl, bodyEl);
    const stats = this.cattleService.getStatistics();

    const titles = {
      reports: "Performance Reports",
      "health-reports": "Health Reports",
      "financial-reports": "Financial Reports",
      settings: "System Settings",
      users: "User Management",
    };

    titleEl.textContent = titles[viewName] || "Overview";
    if (viewName === "users") {
      this.usersController ??= new UsersController({ onAccessLost: () => this.switchView("dashboard") });
      this.usersController.show(bodyEl).catch((err) => console.error("User Management failed:", err));
      return;
    }

    if (viewName === "settings") {
      this.settingsView.render(bodyEl, window.currentUser);
    } else {
      bodyEl.innerHTML = `
        <div class="row g-3">
          <div class="col-md-4"><div class="p-3 bg-light rounded"><strong>Total Herd Size:</strong> ${stats.total} head</div></div>
          <div class="col-md-4"><div class="p-3 bg-light rounded"><strong>Healthy Rate:</strong> ${stats.total ? Math.round((stats.healthy / stats.total) * 100) : 0}%</div></div>
          <div class="col-md-4"><div class="p-3 bg-light rounded"><strong>Active Treatments:</strong> ${stats.scheduledTreatments}</div></div>
        </div>
      `;
    }
  }

  async handleFormSubmit() {
    // Ignore a second submit (double-click, Enter) while the first is in flight.
    if (this.saving) return;
    const saveBtn = document.querySelector('#cattle-form button[type="submit"]');
    this.saving = true;
    if (saveBtn) saveBtn.disabled = true;
    try {
      const formData = this.formView.getFormData();

      if (this.cattleService.isDuplicateTag(formData.tagNumber, this.editingId)) {
        this.showNotification("Cow number already exists", "error");
        return;
      }

      // A change being done again keeps the day it was first made as its weighing date.
      const reapplying = this.reapplying;
      const options = { weightDate: reapplying?.op.weightDate || null };
      if (this.editingId) {
        await this.cattleService.updateCattle(this.editingId, formData, options);
        this.showNotification(this.cattleService.lastQueued ? `Cattle record updated. ${QUEUED_NOTE}` : "Cattle record updated", "success");
      } else {
        await this.cattleService.addCattle(formData, options);
        this.showNotification(this.cattleService.lastQueued ? `New cow added to herd. ${QUEUED_NOTE}` : "New cow added to herd", "success");
      }
      // Saved again (sent or queued): the refused copy is no longer needed.
      if (reapplying) await this.sync.discardUnsynced(reapplying.key).catch((err) => console.error(err));

      this.editingId = null;
      this.formView.resetForm();
      this.formView.closeModal();
      this.refreshAllViews();
    } catch (err) {
      if (!err.sessionExpired) this.showNotification(err.message || "Unable to save record", "error");
    } finally {
      this.saving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  handleEdit(id) {
    const cattle = this.cattleService.getCattleById(id);
    if (!cattle) return;
    this.editingId = id;
    this.reapplying = null;
    this.formView.populateForm(cattle);
    this.formView.openModal(true);
  }

  // Opens the cow details modal, or redraws it when it is already open. `activeTab` is the id of
  // the tab to show first: "details" or one from this.detailTabs. Record tabs are drawn the first
  // time they are shown, by their own controller.
  handleInspect(id, activeTab = "details") {
    const c = this.cattleService.getCattleById(id);
    if (!c) return;
    const statusInfo = formatHealthStatus(c.healthStatus);
    // Record tabs read from the server: not offline, and not for an animal the server has not got yet.
    const recordsAvailable = isOnline() && !c.pendingSync;
    const tabs = recordsAvailable ? this.detailTabs.filter((tab) => !tab.appliesTo || tab.appliesTo(c)) : [];
    if (!tabs.some((tab) => tab.id === activeTab)) activeTab = "details";
    const tabButton = (tabId, label) => `
      <li class="nav-item" role="presentation">
        <button type="button" class="nav-link ${tabId === activeTab ? "active" : ""}" id="cow-tab-btn-${escapeHtml(tabId)}" data-bs-toggle="tab" data-bs-target="#cow-tab-${escapeHtml(tabId)}" data-tab="${escapeHtml(tabId)}" role="tab" aria-controls="cow-tab-${escapeHtml(tabId)}" aria-selected="${tabId === activeTab}">${escapeHtml(label)}</button>
      </li>`;
    const paneClass = (tabId) => `tab-pane ${tabId === activeTab ? "show active" : ""}`;

    document.getElementById("viewCowModalTitle").textContent = `${c.nameBreed} (${c.tagNumber})`;
    const bodyEl = document.getElementById("viewCowModalBody");
    bodyEl.innerHTML = `
      <ul class="nav nav-tabs mb-3" role="tablist">
        ${tabButton("details", "Details")}
        ${tabs.map((tab) => tabButton(tab.id, tab.label)).join("")}
      </ul>
      <div class="tab-content">
      <div class="${paneClass("details")}" id="cow-tab-details" role="tabpanel" aria-labelledby="cow-tab-btn-details">
      <ul class="list-group list-group-flush">
        <li class="list-group-item"><strong>Cow ID:</strong> ${escapeHtml(c.tagNumber)}</li>
        <li class="list-group-item"><strong>Name / Breed:</strong> ${escapeHtml(c.nameBreed || "—")}</li>
        <li class="list-group-item"><strong>Gender:</strong> ${formatGender(c.gender)}</li>
        <li class="list-group-item"><strong>Birth Date / Age:</strong> ${escapeHtml(c.birthDate || "—")} (${escapeHtml(calculateAge(c.birthDate))})</li>
        <li class="list-group-item"><strong>Weight:</strong> ${c.weight ? `${escapeHtml(c.weight)} lbs` : "—"}</li>
        <li class="list-group-item"><strong>Last Calving:</strong> ${escapeHtml(c.lastCalvingDate || "N/A")}</li>
        <li class="list-group-item"><strong>Expected Calving:</strong> ${escapeHtml(c.expectedCalvingDate || "N/A")}</li>
        <li class="list-group-item"><strong>Current Medications:</strong> ${escapeHtml(c.medications || "None")}</li>
        <li class="list-group-item"><strong>Withdrawal Period:</strong> ${withdrawalBadge(c) || escapeHtml(c.withdrawalUntil ? `Ended ${c.withdrawalUntil}` : "None")}</li>
        <li class="list-group-item"><strong>Status:</strong> <span class="badge ${escapeHtml(statusInfo.badgeClass)}">${escapeHtml(statusInfo.label)}</span></li>
        <li class="list-group-item"><strong>Notes:</strong> ${escapeHtml(c.notes || "No notes recorded.")}</li>
      </ul>
      ${recordsAvailable ? "" : `<p class="text-muted small mt-3 mb-0" id="cow-details-offline-note">${
        isOnline()
          ? "This animal has not synced yet. Its calving, breeding, weight, treatment and financial history will be available once it has."
          : "Calving, breeding, weight, treatment and financial history need a connection."
      }</p>`}
      </div>
      ${tabs.map((tab) => `<div class="${paneClass(tab.id)}" id="cow-tab-${escapeHtml(tab.id)}" role="tabpanel" aria-labelledby="cow-tab-btn-${escapeHtml(tab.id)}"></div>`).join("")}
      </div>
    `;
    for (const tab of tabs) {
      const pane = document.getElementById(`cow-tab-${tab.id}`);
      const draw = () => tab.render(c, pane);
      if (tab.id === activeTab) draw();
      else bodyEl.querySelector(`[data-tab="${tab.id}"]`).addEventListener("show.bs.tab", draw, { once: true });
    }
    if (recordsAvailable) this.financeController.appendCattleSection(c.id, document.getElementById("cow-tab-details"));
    bootstrap.Modal.getOrCreateInstance(document.getElementById("viewCowModal")).show();
  }

  // Resolves to true when the record was deleted (or the delete was queued).
  async handleDelete(id) {
    if (!confirm("Delete this cattle record?")) return false;
    try {
      await this.cattleService.deleteCattle(id);
    } catch (err) {
      if (err.sessionExpired) return false;
      if (err.status === 404) {
        // Already gone, e.g. deleted in another tab: say so and resync the list.
        this.showNotification("That record was already deleted. The list has been refreshed.", "error");
        await this.loadData();
      } else {
        this.showNotification(`Couldn't delete the record. ${err.message}`, "error");
      }
      return false;
    }
    this.showNotification(this.cattleService.lastQueued ? `Cattle record deleted. ${QUEUED_NOTE}` : "Cattle record deleted", "success");
    this.refreshAllViews();
    return true;
  }

  // Starts doing an unsynced change again (the "Unsynced changes" dialog, SyncController). The
  // change goes through the normal add, edit or delete path as a new change, so it is checked
  // against the herd as it is now. Its entry is removed only once that new change is saved.
  async reapplyUnsynced(item) {
    const { op } = item;
    const existing = this.cattleService.getCattleById(op.cattleId);

    if (op.type === "delete") {
      if (!existing) {
        await this.sync.discardUnsynced(item.key);
        this.showNotification("That animal is already gone.", "success");
        return true;
      }
      if (!(await this.handleDelete(op.cattleId))) return false;
      await this.sync.discardUnsynced(item.key);
      return true;
    }

    // An edit of an animal that still exists edits it; anything else (a new animal, or an edit
    // of one deleted elsewhere) is added as a new animal with the values the user entered.
    const editing = op.type === "edit" && existing;
    this.editingId = editing ? existing.id : null;
    this.formView.resetForm();
    this.formView.populateForm({
      ...(editing ? existing.toJSON() : {}),
      ...op.data,
      // The last calving date is not part of an edit; show what the records say.
      lastCalvingDate: editing ? existing.lastCalvingDate : op.data.lastCalvingDate,
    });
    this.formView.openModal(Boolean(editing));
    this.reapplying = item;
    return true;
  }

  // Each part renders on its own, so one failing view does not blank the others.
  refreshAllViews() {
    const parts = [
      () => this.dashboardView.renderStats(this.cattleService.getStatistics()),
      () => this.dashboardView.renderRecentTable(this.cattleService.getRecentCattle(5)),
      () => this.dashboardView.renderUpcomingEvents(this.cattleService.getUpcomingCalvings(5)),
      () => this.renderCattleList(),
      ...Object.values(this.recordPages).map((page) => () => page.render()),
    ];
    let failed = false;
    for (const render of parts) {
      try {
        render();
      } catch (err) {
        failed = true;
        console.error("View failed to render:", err);
      }
    }
    if (failed) this.showNotification("Part of the page couldn't be displayed. Try reloading.", "error");
  }

  showNotification(message, type = "success") {
    showToast(message, type);
  }
}