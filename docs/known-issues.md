# Known Issues

Found by reading source at commit `7fb8152`. None has been reproduced in a browser unless noted.

## Open

### 4. Report pages are placeholders
Performance, Health, and Financial reports show identical herd statistics.

### 5. No financial functionality
No table, API route, or form exists.

### 6. Settings page is inaccurate
It says offline storage uses `localStorage` and offers a sample-herd reset that only clears a key the app does not use.

### 7. User Management screen is a placeholder
The API exists; there is no interface.

### 8. Startup failures are silent
`CattleController.init()` attaches event listeners only after cattle load, and `app.js` does not catch a failed `init()`. A failed load leaves a page with dead buttons and no message.

### 9. Delete has no error handling
A failed delete request raises an unhandled error.


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
- (13) No automated tests: `npm test` now runs unit and API tests against PostgreSQL, `npm run test:e2e` runs a browser smoke test, and GitHub Actions runs both on every push and pull request. Added on `feature/automated-tests`; the workflow file was validated as YAML but had not yet run on GitHub when this was written.

## Note on login graphics

The earlier `public/styles.css` contained hero, floating-card, and form styles (`.auth-shell`, `.auth-hero`, `.hero-stats`). The current `login.html` never used them: it loads `login.css` only. Commit `29162f2` replaced `styles.css` with app-only styles, so those rules are no longer in the working tree. They remain in git history at commit `e8d97e1` and can be restored for a redesigned login page.
