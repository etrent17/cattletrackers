import { CattleService } from "../services/CattleService.js";
import { DashboardView } from "../views/DashboardView.js";
import { FormView } from "../views/FormView.js";
import { ListView } from "../views/ListView.js";
import { calculateAge, formatHealthStatus } from "../utils/DateHelpers.js";

export class CattleController {
  constructor() {
    this.cattleService = new CattleService();
    this.dashboardView = new DashboardView();
    this.formView = new FormView();
    this.listView = new ListView();
    this.editingId = null;
    this.currentView = "dashboard";
  }

  async init() {
    await this.cattleService.loadData();
    this.setupEventListeners();
    this.setupOnlineStatus();
    this.refreshAllViews();
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
    document.getElementById("search-cattle")?.addEventListener("input", () => this.applyFilters());
    document.getElementById("filter-status")?.addEventListener("change", () => this.applyFilters());

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
      this.renderFilteredSubView(viewName);
    } else {
      document.getElementById("view-secondary").classList.add("active");
      this.renderSecondaryView(viewName);
    }
  }

  renderFilteredSubView(viewName) {
    const all = this.cattleService.getAllCattle();
    if (viewName === "calving") {
      const filtered = all.filter((c) => c.gender === "female" && (c.lastCalvingDate || c.expectedCalvingDate));
      this.listView.renderList(filtered, "Calving Records");
    } else if (viewName === "medical") {
      const filtered = all.filter((c) => c.medications || c.healthStatus !== "healthy");
      this.listView.renderList(filtered, "Medical & Health Records");
    } else if (viewName === "breeding") {
      const filtered = all.filter((c) => c.healthStatus === "pregnant" || c.expectedCalvingDate);
      this.listView.renderList(filtered, "Breeding History");
    } else {
      this.listView.renderList(all, "All Cattle Records");
    }
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
        await this.cattleService.loadData();
        this.refreshAllViews();
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

  applyFilters() {
    const query = document.getElementById("search-cattle")?.value || "";
    const status = document.getElementById("filter-status")?.value || "all";
    const filtered = this.cattleService.searchCattle(query, status);
    this.listView.renderList(filtered, "All Cattle Records");
  }

  async handleFormSubmit() {
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
      this.showNotification(err.message || "Unable to save record", "error");
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
        <li class="list-group-item"><strong>Cow ID:</strong> ${c.tagNumber}</li>
        <li class="list-group-item"><strong>Name / Breed:</strong> ${c.nameBreed || "—"}</li>
        <li class="list-group-item"><strong>Gender:</strong> ${c.gender === "male" ? "Male" : "Female"}</li>
        <li class="list-group-item"><strong>Birth Date / Age:</strong> ${c.birthDate || "—"} (${calculateAge(c.birthDate)})</li>
        <li class="list-group-item"><strong>Weight:</strong> ${c.weight ? `${c.weight} lbs` : "—"}</li>
        <li class="list-group-item"><strong>Last Calving:</strong> ${c.lastCalvingDate || "N/A"}</li>
        <li class="list-group-item"><strong>Expected Calving:</strong> ${c.expectedCalvingDate || "N/A"}</li>
        <li class="list-group-item"><strong>Medications:</strong> ${c.medications || "None"}</li>
        <li class="list-group-item"><strong>Status:</strong> <span class="badge ${statusInfo.badgeClass}">${statusInfo.label}</span></li>
        <li class="list-group-item"><strong>Notes:</strong> ${c.notes || "No notes recorded."}</li>
      </ul>
    `;
    new bootstrap.Modal(document.getElementById("viewCowModal")).show();
  }

  async handleDelete(id) {
    if (!confirm("Delete this cattle record?")) return;
    await this.cattleService.deleteCattle(id);
    this.showNotification("Cattle record deleted", "success");
    this.refreshAllViews();
  }

  refreshAllViews() {
    const all = this.cattleService.getAllCattle();
    const stats = this.cattleService.getStatistics();
    this.dashboardView.renderStats(stats);
    this.dashboardView.renderRecentTable(this.cattleService.getRecentCattle(5));
    this.dashboardView.renderEventsAndAlerts(all);
    this.listView.renderList(all);
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
    const el = document.getElementById("notification");
    if (!el) return;
    el.textContent = message;
    el.className = `toast-notification ${type} show`;
    setTimeout(() => el.classList.remove("show"), 3000);
  }
}