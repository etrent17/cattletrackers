// Performance Reports page (view "reports") and Health Reports page (view "health-reports").
// CattleController hands over from renderSecondaryView through handles()/render(), as it does
// for FinanceController. Both pages share one period, so switching between them keeps it.
import { presetRange } from "../services/FinanceService.js";
import { HEALTH_TABLES, PERFORMANCE_TABLES, ReportsService, csvFileName, reportCsv } from "../services/ReportsService.js";
import { ReportsView } from "../views/ReportsView.js";
import { downloadCsv } from "../utils/csv.js";
import { todayISO } from "../utils/DateHelpers.js";
import { showToast } from "../utils/feedback.js";

const PAGES = {
  reports: { title: "Performance Reports", tables: PERFORMANCE_TABLES, name: "performance report" },
  "health-reports": { title: "Health Reports", tables: HEALTH_TABLES, name: "health report" },
};

export class ReportsController {
  constructor({ getCurrentView }) {
    this.getCurrentView = getCurrentView;
    this.service = new ReportsService();
    this.view = new ReportsView();
    this.range = { preset: "12m", ...presetRange("12m") };
    this.report = null; // the report on screen, for the CSV exports
    this.loadToken = 0;
  }

  handles(viewName) {
    return Object.hasOwn(PAGES, viewName);
  }

  // Draws a report page into the secondary view and loads its figures. Never rejects.
  async render(viewName, titleEl, bodyEl) {
    titleEl.textContent = PAGES[viewName].title;
    this.view.renderLayout(bodyEl, { range: this.range });
    this.bind(viewName, bodyEl);
    await this.load(viewName);
  }

  bind(viewName, bodyEl) {
    const presetEl = bodyEl.querySelector("#rep-preset");
    const fromEl = bodyEl.querySelector("#rep-from");
    const toEl = bodyEl.querySelector("#rep-to");

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
    bodyEl.querySelector("#rep-filter").addEventListener("submit", (e) => e.preventDefault());
    bodyEl.querySelector("#rep-print-btn").addEventListener("click", () => window.print());

    bodyEl.querySelector("#rep-content").addEventListener("click", (e) => {
      const exportBtn = e.target.closest(".rep-export");
      if (e.target.closest("#rep-retry")) this.load(viewName);
      else if (exportBtn) this.exportCsv(viewName, exportBtn.dataset.export);
    });
  }

  // Loads and draws the page's report. A newer load, or leaving the page, makes an older
  // response be ignored.
  async load(viewName) {
    const contentEl = document.getElementById("rep-content");
    if (!contentEl) return;
    const token = ++this.loadToken;
    const isCurrent = () => token === this.loadToken && this.getCurrentView() === viewName && contentEl.isConnected;

    const { from, to } = this.range;
    const today = todayISO();
    this.report = null;
    this.view.renderPeriod(this.range, today);
    if (from && to && from > to) {
      this.view.renderMessage(contentEl, "The From date must be on or before the To date.");
      return;
    }

    this.view.renderLoading(contentEl);
    try {
      const report = viewName === "reports" ? await this.service.performance({ from, to }, today) : await this.service.health({ from, to }, today);
      if (!isCurrent()) return;
      this.report = report;
      if (viewName === "reports") this.view.renderPerformance(contentEl, report);
      else this.view.renderHealth(contentEl, report);
    } catch (err) {
      if (err.sessionExpired || !isCurrent()) return;
      console.error(err);
      this.view.renderError(contentEl, `Couldn't load the ${PAGES[viewName].name}. ${err.message}`);
    }
  }

  // Downloads one table of the report on screen. The file holds the same rows as the table.
  exportCsv(viewName, key) {
    const table = PAGES[viewName].tables[key];
    if (!table || !this.report) return;
    const rows = table.rows(this.report);
    if (rows.length <= 1) {
      showToast("This table has no rows to export.", "error");
      return;
    }
    downloadCsv(csvFileName(table, this.range, this.report.today), reportCsv(rows));
  }
}
