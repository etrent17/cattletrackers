// Mobile-first shell enhancements: bottom navigation bar, off-canvas sidebar drawer,
// dashboard action hierarchy, stat-card drill-downs, and cattle-page header controls.
// Uses data-mobile-view (never data-view) so existing sidebar selectors stay unique.
import { escapeHtml } from "./escapeHtml.js";

export const PRIMARY_MOBILE_VIEWS = ["dashboard", "cattle", "medical", "weights"];

export function activeBottomTab(viewName) {
  return PRIMARY_MOBILE_VIEWS.includes(viewName) ? viewName : "more";
}

function setDrawerOpen(open) {
  document.body.classList.toggle("mobile-nav-open", open);
  const menuBtn = document.getElementById("mobile-menu-btn");
  if (menuBtn) menuBtn.setAttribute("aria-expanded", String(open));
}

export function syncMobileNav(viewName) {
  const active = activeBottomTab(viewName);
  document.querySelectorAll("[data-mobile-view]").forEach((btn) => {
    const isCurrent = btn.dataset.mobileView === active;
    btn.classList.toggle("active", isCurrent);
    if (isCurrent) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  setDrawerOpen(false);
}

export function initMobileShell({ onNavigate, onAddAnimal, onFilterHealthy, onResetCattleFilters }) {
  if (document.getElementById("mobile-bottom-nav")) return;

  // 1. Navbar: mobile drawer button + signed-in account indicator on desktop
  const navbar = document.querySelector("nav.navbar");
  const brand = navbar?.querySelector(".navbar-brand");
  if (navbar && brand) {
    const leftGroup = document.createElement("div");
    leftGroup.className = "d-flex align-items-center gap-2";
    const menuBtn = document.createElement("button");
    menuBtn.id = "mobile-menu-btn";
    menuBtn.type = "button";
    menuBtn.className = "btn btn-sm btn-outline-light mobile-menu-btn";
    menuBtn.setAttribute("aria-label", "Open navigation menu");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.innerHTML = '<i class="fas fa-bars" aria-hidden="true"></i>';
    menuBtn.addEventListener("click", () => setDrawerOpen(!document.body.classList.contains("mobile-nav-open")));
    brand.before(leftGroup);
    leftGroup.append(menuBtn, brand);

    const user = window.currentUser;
    const rightGroup = navbar.querySelector(".d-flex.align-items-center");
    if (user?.email && rightGroup) {
      const pill = document.createElement("span");
      pill.className = "nav-user-pill";
      pill.title = user.email;
      pill.textContent = user.isDemo ? "Demo mode" : user.email;
      rightGroup.prepend(pill);
    }
  }

  // 2. Slide-out drawer header + backdrop
  const aside = document.querySelector("aside");
  if (aside) {
    const drawerHeader = document.createElement("div");
    drawerHeader.className = "mobile-drawer-header";
    drawerHeader.innerHTML = `
      <strong class="text-success">Menu</strong>
      <button type="button" class="btn-close" aria-label="Close navigation menu"></button>
    `;
    drawerHeader.querySelector("button").addEventListener("click", () => setDrawerOpen(false));
    aside.prepend(drawerHeader);
  }

  const backdrop = document.createElement("div");
  backdrop.className = "mobile-nav-backdrop";
  backdrop.addEventListener("click", () => setDrawerOpen(false));
  document.body.append(backdrop);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("mobile-nav-open")) {
      setDrawerOpen(false);
    }
  });

  // 3. Fixed bottom navigation bar for phones
  const bottomNav = document.createElement("nav");
  bottomNav.id = "mobile-bottom-nav";
  bottomNav.className = "mobile-bottom-nav";
  bottomNav.setAttribute("aria-label", "Primary navigation");
  const tabs = [
    { id: "dashboard", label: "Home", icon: "fa-home" },
    { id: "cattle", label: "Cattle", icon: "fa-cow" },
    { id: "medical", label: "Medical", icon: "fa-syringe" },
    { id: "weights", label: "Weights", icon: "fa-weight-scale" },
    { id: "more", label: "More", icon: "fa-bars" },
  ];
  bottomNav.innerHTML = tabs
    .map(
      (t) => `
      <button type="button" class="mobile-bottom-btn" data-mobile-view="${escapeHtml(t.id)}">
        <i class="fas ${escapeHtml(t.icon)}" aria-hidden="true"></i>
        <span>${escapeHtml(t.label)}</span>
      </button>`
    )
    .join("");
  bottomNav.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mobile-view]");
    if (!btn) return;
    const target = btn.dataset.mobileView;
    if (target === "more") setDrawerOpen(!document.body.classList.contains("mobile-nav-open"));
    else onNavigate(target);
  });
  document.body.append(bottomNav);

  // 4. Dashboard: interactive stat cards, quick actions bar, and attention-first layout
  const dashboard = document.getElementById("view-dashboard");
  if (dashboard) {
    const statTargets = [
      { id: "stat-total", action: () => onNavigate("cattle"), label: "View all cattle" },
      { id: "stat-calving", action: () => onNavigate("calving"), label: "View calving records" },
      { id: "stat-treatments", action: () => onNavigate("medical"), label: "View medical records" },
      { id: "stat-healthy", action: () => onFilterHealthy(), label: "View healthy cattle" },
    ];
    for (const item of statTargets) {
      const card = document.getElementById(item.id)?.closest(".rounded");
      if (!card) continue;
      card.classList.add("stat-card");
      card.dataset.statTarget = item.id;
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", item.label);
      card.addEventListener("click", item.action);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          item.action();
        }
      });
    }

    const statsRow = dashboard.querySelector(".row.g-3.mb-4");
    const quickBar = document.createElement("div");
    quickBar.className = "quick-actions-bar";
    quickBar.setAttribute("aria-label", "Quick actions");
    quickBar.innerHTML = `
      <button type="button" class="btn btn-sm btn-outline-success btn-treatment-add"><i class="fas fa-syringe" aria-hidden="true"></i>Record Treatment</button>
      <button type="button" class="btn btn-sm btn-outline-success btn-weight-add"><i class="fas fa-weight-scale" aria-hidden="true"></i>Record Weight</button>
      <button type="button" class="btn btn-sm btn-outline-success btn-calving-add"><i class="fas fa-baby" aria-hidden="true"></i>Record Calving</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" id="quick-all-cattle-btn"><i class="fas fa-list" aria-hidden="true"></i>All Cattle</button>
    `;
    quickBar.querySelector("#quick-all-cattle-btn")?.addEventListener("click", () => onNavigate("cattle"));
    statsRow?.after(quickBar);

    const recentTableWrap = document.getElementById("recent-body")?.closest(".table-responsive");
    recentTableWrap?.classList.add("mobile-cards-table");

    // Surface Alerts & Upcoming Events above Recent Cattle Records in a 2-column grid
    const eventsList = document.getElementById("events-list");
    const alertsList = document.getElementById("alerts-list");
    const recentHeading = recentTableWrap?.previousElementSibling;
    const eventsHeading = eventsList?.previousElementSibling;
    const alertsHeading = alertsList?.previousElementSibling;
    if (recentHeading && eventsList && alertsList && eventsHeading && alertsHeading) {
      const grid = document.createElement("div");
      grid.className = "dashboard-attention-grid";
      const alertsCol = document.createElement("div");
      const eventsCol = document.createElement("div");
      alertsHeading.classList.remove("mt-4");
      alertsCol.append(alertsHeading, alertsList);
      eventsCol.append(eventsHeading, eventsList);
      grid.append(alertsCol, eventsCol);
      recentHeading.before(grid);
    }
  }

  // 5. Cattle page: add header action button, result count, filter reset, and mobile cards
  const cattleSection = document.getElementById("view-cattle");
  const listTitle = document.getElementById("list-title");
  if (cattleSection && listTitle) {
    const header = document.createElement("div");
    header.className = "cattle-header-bar";
    const right = document.createElement("div");
    right.className = "d-flex align-items-center gap-2";
    const countBadge = document.createElement("span");
    countBadge.id = "cattle-list-count";
    countBadge.className = "badge bg-light text-dark border";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-success btn-sm";
    addBtn.innerHTML = '<i class="fas fa-plus me-1" aria-hidden="true"></i>Add Animal';
    addBtn.addEventListener("click", onAddAnimal);
    right.append(countBadge, addBtn);
    listTitle.before(header);
    header.append(listTitle, right);

    const filterRow = cattleSection.querySelector(".row.g-2.mb-3");
    if (filterRow) {
      const resetCol = document.createElement("div");
      resetCol.className = "col-md-3 d-flex align-items-center";
      resetCol.innerHTML = '<button type="button" id="cattle-reset-filters" class="btn btn-outline-secondary btn-sm" hidden>Reset filters</button>';
      resetCol.querySelector("button").addEventListener("click", onResetCattleFilters);
      filterRow.append(resetCol);
    }

    document.getElementById("list-body")?.closest(".table-responsive")?.classList.add("mobile-cards-table");
  }
}
