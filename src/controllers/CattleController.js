import { CattleService } from "../services/CattleService.js";
import { DashboardView } from "../views/DashboardView.js";
import { FormView } from "../views/FormView.js";
import { ListView } from "../views/ListView.js";
import { calculateAge, formatGender, formatHealthStatus } from "../utils/DateHelpers.js";
import { hideErrorBanner, showErrorBanner, showToast } from "../utils/feedback.js";
import { escapeHtml } from "../utils/escapeHtml.js";

export class CattleController {
  constructor() {
    this.cattleService = new CattleService();
    this.dashboardView = new DashboardView();
    this.formView = new FormView();
    this.listView = new ListView();
    this.editingId = null;
    this.saving = false;
    this.currentView = "dashboard";
  }

  // Listeners go on first so the page stays usable when the load fails.
  async init() {
    this.setupEventListeners();
    this.setupOnlineStatus();
    await this.loadData();
  }

  // Loads the herd from the server and redraws. On failure shows the error
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

    // Open Add New Cow Modal
    document.getElementById("open-add-modal-btn")?.addEventListener("click", () => {
      this.editingId = null;
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

    if (viewName === "dashboard") {
      document.getElementById("view-dashboard").classList.add("active");
      this.refreshAllViews();
    } else if (["cattle", "calving", "medical", "breeding"].includes(viewName)) {
      document.getElementById("view-cattle").classList.add("active");
      this.renderCattleList();
    } else {
      document.getElementById("view-secondary").classList.add("active");
      this.renderSecondaryView(viewName);
    }
  }

  // Renders the cattle table for the current list view (All, Calving, Medical,
  // Breeding), narrowed by the search box and status filter.
  renderCattleList() {
    const subViews = {
      calving: { title: "Calving Records", filter: (c) => c.gender !== "male" && (c.lastCalvingDate || c.expectedCalvingDate) },
      medical: { title: "Medical & Health Records", filter: (c) => c.medications || c.healthStatus !== "healthy" },
      breeding: { title: "Breeding History", filter: (c) => c.healthStatus === "pregnant" || c.expectedCalvingDate },
    };
    const { title, filter } = subViews[this.currentView] || { title: "All Cattle Records", filter: () => true };
    const query = document.getElementById("search-cattle")?.value || "";
    const status = document.getElementById("filter-status")?.value || "all";
    const matches = this.cattleService.searchCattle(query, status).filter(filter);
    this.listView.renderList(matches, title);
  }

  renderSecondaryView(viewName) {
    const titleEl = document.getElementById("secondary-view-title");
    const bodyEl = document.getElementById("secondary-view-body");
    const stats = this.cattleService.getStatistics();

    const titles = {
      reports: "Performance Reports",
      "health-reports": "Health Reports",
      "financial-reports": "Financial Reports",
      settings: "System Settings",
      users: "User Management",
    };

    titleEl.textContent = titles[viewName] || "Overview";

    if (viewName === "settings") {
      bodyEl.innerHTML = `
        <p class="text-muted">Offline storage is active via browser <code>localStorage</code> and Service Worker caching.</p>
        <button class="btn btn-outline-danger btn-sm" id="reset-demo-data-btn">Reset to Blueprint Sample Herd</button>
      `;
      document.getElementById("reset-demo-data-btn")?.addEventListener("click", async () => {
        localStorage.removeItem("cattle-data");
        if (!(await this.loadData())) return;
        this.showNotification("Sample herd data restored", "success");
      });
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

      if (this.editingId) {
        await this.cattleService.updateCattle(this.editingId, formData);
        this.showNotification("Cattle record updated", "success");
      } else {
        await this.cattleService.addCattle(formData);
        this.showNotification("New cow added to herd", "success");
      }

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
    this.formView.populateForm(cattle);
    this.formView.openModal(true);
  }

  handleInspect(id) {
    const c = this.cattleService.getCattleById(id);
    if (!c) return;
    const statusInfo = formatHealthStatus(c.healthStatus);
    document.getElementById("viewCowModalTitle").textContent = `${c.nameBreed} (${c.tagNumber})`;
    document.getElementById("viewCowModalBody").innerHTML = `
      <ul class="list-group list-group-flush">
        <li class="list-group-item"><strong>Cow ID:</strong> ${escapeHtml(c.tagNumber)}</li>
        <li class="list-group-item"><strong>Name / Breed:</strong> ${escapeHtml(c.nameBreed || "—")}</li>
        <li class="list-group-item"><strong>Gender:</strong> ${formatGender(c.gender)}</li>
        <li class="list-group-item"><strong>Birth Date / Age:</strong> ${escapeHtml(c.birthDate || "—")} (${escapeHtml(calculateAge(c.birthDate))})</li>
        <li class="list-group-item"><strong>Weight:</strong> ${c.weight ? `${escapeHtml(c.weight)} lbs` : "—"}</li>
        <li class="list-group-item"><strong>Last Calving:</strong> ${escapeHtml(c.lastCalvingDate || "N/A")}</li>
        <li class="list-group-item"><strong>Expected Calving:</strong> ${escapeHtml(c.expectedCalvingDate || "N/A")}</li>
        <li class="list-group-item"><strong>Medications:</strong> ${escapeHtml(c.medications || "None")}</li>
        <li class="list-group-item"><strong>Status:</strong> <span class="badge ${escapeHtml(statusInfo.badgeClass)}">${escapeHtml(statusInfo.label)}</span></li>
        <li class="list-group-item"><strong>Notes:</strong> ${escapeHtml(c.notes || "No notes recorded.")}</li>
      </ul>
    `;
    new bootstrap.Modal(document.getElementById("viewCowModal")).show();
  }

  async handleDelete(id) {
    if (!confirm("Delete this cattle record?")) return;
    try {
      await this.cattleService.deleteCattle(id);
    } catch (err) {
      if (err.sessionExpired) return;
      if (err.status === 404) {
        // Already gone, e.g. deleted in another tab: say so and resync the list.
        this.showNotification("That record was already deleted. The list has been refreshed.", "error");
        await this.loadData();
      } else {
        this.showNotification(`Couldn't delete the record. ${err.message}`, "error");
      }
      return;
    }
    this.showNotification("Cattle record deleted", "success");
    this.refreshAllViews();
  }

  // Each part renders on its own, so one failing view does not blank the others.
  refreshAllViews() {
    const parts = [
      () => this.dashboardView.renderStats(this.cattleService.getStatistics()),
      () => this.dashboardView.renderRecentTable(this.cattleService.getRecentCattle(5)),
      () => this.dashboardView.renderUpcomingEvents(this.cattleService.getUpcomingCalvings(5)),
      () => this.renderCattleList(),
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

  setupOnlineStatus() {
    const updateStatus = () => {
      const indicator = document.getElementById("online-status");
      const text = document.getElementById("status-text");
      if (!indicator || !text) return;
      if (navigator.onLine) {
        indicator.className = "status-indicator online";
        text.textContent = "Online";
      } else {
        indicator.className = "status-indicator offline";
        text.textContent = "Offline";
      }
    };
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    updateStatus();
  }

  showNotification(message, type = "success") {
    showToast(message, type);
  }
}