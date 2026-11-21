# Feature Inventory

Based on commit `7fb8152`, reviewed 2026-11-21 from source code only. Every row is **Not tested** until [the testing checklist](testing-checklist.md) is run.

Status key: **Implemented** = code is present. **Partial** = some pieces work in code, others missing. **Placeholder** = a screen or label without distinct functionality. **Defective** = a confirmed defect blocks it (see [known issues](known-issues.md)). **Missing** = not in the code.

## Authentication and accounts

| Feature | Where | Status | Notes |
|---|---|---|---|
| First-admin setup | `POST /api/auth/setup`, `src/auth.js` | Implemented | Only works while no non-demo user exists |
| Login / logout | `/api/auth/login`, `/api/auth/logout` | Implemented | Rate limited to 20 requests per 15 minutes |
| Password show/hide | `public/login.html`, `src/auth.js` | Implemented | |
| Change password | `POST /api/auth/password`, `SettingsView.js` | Implemented | Needs the current password; 10 per 15 minutes per user; signs out the user's other sessions; refused for demo accounts |
| Session persistence | `app.js` | Implemented | Stored in PostgreSQL, 7-day cookie |
| Demo mode | `POST /api/auth/demo`, `lib/demo.js` | Implemented | Needs `DEMO_MODE=true` |
| User management API | `routes/users.js` | Implemented | Admin only; list, add, change role, delete; last admin protected |
| User management screen | `src/controllers/UsersController.js`, `src/views/UsersView.js` | Implemented | Admins only; nav item hidden for other users |

## Cattle records

| Feature | Where | Status | Notes |
|---|---|---|---|
| Add cattle | `FormView.js`, `POST /api/cattle` | Implemented | Form IDs fixed in `7fb8152`; untested |
| Edit cattle | `FormView.js`, `PUT /api/cattle/:id` | Implemented | Same fix; untested |
| View details modal | `CattleController.handleInspect` | Implemented | |
| Delete cattle | `routes/cattle.js` | Partial | Delete button exists only in the All Cattle table; that table does not render (see known issues) |
| Search and status filter | `CattleService.searchCattle` | Defective | Filters run, but the table they render into is not found |
| Duplicate cow-number check | client and database | Implemented | Case-insensitive, per owner |
| Cattle list table | `ListView.js` | Defective | Element IDs do not match `index.html` |

## Dashboard and views

| Feature | Where | Status | Notes |
|---|---|---|---|
| Statistics cards | `DashboardView.renderStats` | Defective | `getStatistics()` added in `e8d97e1`, but card IDs do not match |
| Recent cattle table | `DashboardView.renderRecentTable` | Defective | ID mismatch |
| Upcoming events and alerts | `DashboardView.renderUpcomingEvents`, `DashboardView.renderAlerts` | Implemented | Alerts list (`#alerts-list`) under Upcoming Events; each feature owns its alerts. Shows overdue treatments |
| Scheduled Treatments card | `DashboardView.renderTreatmentsDue`, `TreatmentController` | Implemented | Open treatment follow-ups due within 7 days, overdue included |
| Medical records | nav item `medical`, `routes/treatments.js`, `TreatmentController` | Implemented | Treatments, vaccinations, vet visits per animal; Upcoming and overdue follow-ups; withdrawal periods with a badge in the cattle tables and details; Treatments tab in the cow details |
| Breeding records (Breeding History page) | `routes/breedings.js`, `routes/pregnancy-checks.js`, `BreedingController` | Implemented | Replaces the Breeding filtered view (feature 09): breedings and pregnancy checks with add/edit/delete, needs-check list, sire picker of the herd's bulls, Breeding tab in the cow details; recording a breeding fills the expected calving date, a check sets or clears Pregnant. Tested by `test/api/breedings.test.js`, `test/api/pregnancy-checks.test.js`, `e2e/breeding.e2e.js` |
| Weight tracking | nav item `weights`, `routes/weighings.js`, `WeightController.js` | Implemented | Weighing history per animal (lbs); batch entry for many animals on one date with per-row results; cow details tab with chart and average daily gain; the animal's weight is its newest weighing. Tested by API, unit and browser tests. kg not supported yet |
| One-view-at-a-time navigation | `public/styles.css` | Implemented | Added in `29162f2` |

## Reports, settings, finance

| Feature | Where | Status | Notes |
|---|---|---|---|
| Performance reports | nav item `reports`, `ReportsController` | Implemented | Herd size over time, calvings, calving rate and interval, daily gain by animal and group, conception rate for a period (`GET /api/reports/performance`); CSV export per table, print layout |
| Health reports | nav item `health-reports`, `ReportsController` | Implemented | Treatments by type and month for a period; animals under treatment, in quarantine or in withdrawal, and overdue and upcoming follow-ups today (`GET /api/reports/health`); CSV export per table, print layout |
| Financial reports | nav item `financial-reports`, `FinanceController` | Implemented | Income, expenses, net, cost per head, by month and by category for a period (`GET /api/transactions/summary`) |
| Financial records | nav item `finance`, `routes/transactions.js` | Implemented | Add/edit/delete, period and animal filters, CSV export; cow details dialog lists an animal's transactions |
| System settings | nav item `settings`, `SettingsView.js` | Implemented | Shows email, role, and demo status; change-password form (not for demo accounts); describes offline behaviour |

## Platform

| Feature | Where | Status | Notes |
|---|---|---|---|
| Online/offline indicator | `src/utils/connectivity.js`, `SyncView.renderIndicator` | Implemented | Follows real reachability (`navigator.onLine` and whether API requests get an answer), also when the app starts offline |
| Static asset caching | `public/service-worker.js` | Implemented | App shell and the CDN files, so the page opens offline (HTTPS or localhost). API requests are never cached |
| Offline cattle viewing and editing | `OfflineStore.js`, `SyncEngine.js`, `SyncController.js` | Implemented | Cattle only: herd saved in IndexedDB, add/edit/delete queued and replayed on reconnect, server wins on conflict, refused changes kept under "Unsynced changes". Event records, reports and settings need a connection |
| Health endpoint | `GET /api/health` | Implemented | Returns 503 when the database is down |
| Security headers and CSP | `app.js` (helmet) | Implemented | HSTS off unless `HSTS=true` |
| Docker installer | `install.sh`, `docker-compose.yml` | Implemented | |
| Database backup and restore | `scripts/backup.sh`, `scripts/restore.sh` | Implemented | See deployment docs |
| Automated tests | `test/`, `e2e/`, `.github/workflows/test.yml` | Implemented | `npm test` (unit and API), `npm run test:e2e` (browser); see the README |
