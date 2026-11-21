# Known Issues

Found by reading source at commit `7fb8152`. None has been reproduced in a browser unless noted.

## Open

None.

## Resolved

- `getStatistics()` was missing from `CattleService`. Added in `e8d97e1`.
- Inactive views stayed visible, stacking reports under tables. Fixed in `29162f2`.
- The add/edit form used IDs that did not exist. Fixed in `7fb8152`; add and edit verified in a browser on `feature/fix-core-views`.
- **1. Dashboard element IDs did not match the page.** `DashboardView` now uses the IDs in `index.html`; the alerts code was removed because the page has no alerts list. Fixed on `feature/fix-core-views` (`0c99c91`), verified in a browser.
- **2. Cattle list element IDs did not match the page.** `ListView` now uses `list-title`, `list-body`, and `list-empty`. Fixed on `feature/fix-core-views` (`0c99c91`), verified in a browser.
- **3. Icons did not load.** `index.html` loads Font Awesome 6.5.2 from cdnjs. Fixed on `feature/fix-core-views` (`4b0841d`), verified in a browser.
- **12. Calving-month statistic mixed date handling.** Dates are parsed as local calendar dates (`parseLocalDate`). Fixed on `feature/fix-core-views` (`7a983c5`), verified with browser time zones either side of UTC.
- (10) Docker setup omitted some settings: compose did not pass `DEMO_MODE` or `COOKIE_SECURE`, and `install.sh` overwrote the Docker files on each run. The Docker files are now committed, `install.sh` only creates `.env` and runs Compose, and Compose passes `DEMO_MODE`, `COOKIE_SECURE`, and `HSTS`. Fixed on `feature/deploy-hardening` (compose validated with `docker compose config`; not run under a Docker daemon).
- (11) Health check ignored the database: `/api/health` now runs `SELECT 1` and returns 503 when PostgreSQL is unreachable. Fixed on `feature/deploy-hardening`.
- **8. Startup failures were silent.** Listeners are attached before the herd loads; a failed load or unreachable server shows an error banner with Retry, and `app.js` catches a failing start-up. Fixed on `feature/error-handling`, verified in a browser (server stopped, requests aborted or answered 500).
- **9. Delete had no error handling.** A failed delete shows an error toast; deleting a record already deleted in another tab says so and refreshes the list. Fixed on `feature/error-handling`, verified in a browser.
- (13) No automated tests: `npm test` now runs unit and API tests against PostgreSQL, `npm run test:e2e` runs a browser smoke test, and GitHub Actions runs both on every push and pull request. Added on `feature/automated-tests`; the workflow passed on GitHub for the branch push (run 44942939463).
- **6. Settings page was inaccurate.** The `localStorage` text and the sample-herd reset button are gone; System Settings now shows the signed-in account (email, role, demo status), a change-password form backed by `POST /api/auth/password`, and an accurate description of offline behaviour. The unused `StorageService.js` and `ApiClient.js` were deleted. Fixed on `feature/settings-cleanup`, verified in a browser (`e2e/settings.e2e.js`).
- **7. User Management screen was a placeholder.** Admins can now list, add, and delete users and change roles from the screen; the nav item is hidden for non-admins. The API gained `PATCH /api/users/:id`, reads the role from the database on each admin request (demotion takes effect immediately), ends a deleted user's sessions, and never removes the last admin. Fixed on `feature/user-management-ui`, verified in a browser (`e2e/users.e2e.js`).
- **5. No financial functionality.** A `transactions` table, `/api/transactions` (list, create, update, delete, summary) and a Financial Records page with add/edit dialog, period filter and CSV export now exist; the cow details dialog lists an animal's transactions. Fixed on `feature/financial-records`, verified in a browser and by API and browser tests.
- **4 (financial part). Financial Reports was a placeholder.** It now shows income, expenses, net, cost per head, a monthly breakdown and totals by category for a chosen period, summed exactly in SQL. Fixed on `feature/financial-records`, verified in a browser. Performance and Health reports remain open under item 4.
- **Weight 0 was accepted by the cattle API.** `POST` and `PUT /api/cattle` skipped the weight check for `0` (`optional({ values: 'falsy' })` treats 0 as "not given") and stored it, although the docs and the form require more than 0. The check now skips only a missing, `null` or empty weight; 0, `"0"` and anything that rounds to 0 return 400 `Invalid weight`. Weights of 0 already stored are cleared to "no weight" at startup. Fixed on `feature/weight-tracking` (`test/api/cattle.test.js`, formerly a `todo` test).
- **4. Performance and Health reports were placeholders.** They showed the same three herd statistics. Performance Reports now shows herd size over time, calvings, calving rate and interval, average daily gain and conception rate; Health Reports shows treatments by type and month, animals under treatment, in quarantine or in a withdrawal period, and overdue and upcoming follow-ups. Both are computed in SQL by `GET /api/reports/performance` and `/health` for a chosen period, with CSV export of each table and a print layout. Fixed on `feature/reports`, verified in a browser and by API and browser tests (`test/api/reports.test.js`, `e2e/reports.e2e.js`).

## Note on login graphics

The earlier `public/styles.css` contained hero, floating-card, and form styles (`.auth-shell`, `.auth-hero`, `.hero-stats`). The current `login.html` never used them: it loads `login.css` only. Commit `29162f2` replaced `styles.css` with app-only styles, so those rules are no longer in the working tree. They remain in git history at commit `e8d97e1` and can be restored for a redesigned login page.
