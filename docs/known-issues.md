# Known Issues

Found by reading source at commit `7fb8152`. None has been reproduced in a browser unless noted.

## Open

### 1. Dashboard element IDs do not match the page
`DashboardView` looks for `stat-total-cattle`, `stat-calving-month`, `stat-scheduled-treatments`, `stat-healthy-animals`, `recent-cattle-tbody`, `upcoming-events-list`, and `alerts-reminders-list`. `index.html` has `stat-total`, `stat-calving`, `stat-treatments`, `stat-healthy`, `recent-body`, and `events-list`, and no alerts list. `renderStats` will throw on the missing elements.
**Fix when:** the IDs agree and the dashboard shows data.

### 2. Cattle list element IDs do not match the page
`ListView` looks for `records-view-title` and `all-cattle-tbody`; `index.html` has `list-title` and `list-body`. The All Cattle table, and its delete buttons, never render.

### 3. Icons do not load
Views use Font Awesome classes (`fas fa-*`), but `index.html` does not include a Font Awesome stylesheet.

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

### 10. Docker setup omits some settings
The generated compose file does not pass `DEMO_MODE` or `COOKIE_SECURE`, and `install.sh` overwrites generated files on each run.

### 11. Health check ignores the database
`/api/health` reports healthy even if PostgreSQL is down.

### 12. Calving-month statistic mixes date handling
It compares a UTC month of the expected date with the local month of today, which can be off near month boundaries.

### 13. No automated tests
`npm test` prints an error and exits.

## Resolved

- `getStatistics()` was missing from `CattleService`. Added in `e8d97e1`.
- Inactive views stayed visible, stacking reports under tables. Fixed in `29162f2`.
- The add/edit form used IDs that did not exist. Fixed in `7fb8152` (untested).

## Note on login graphics

The earlier `public/styles.css` contained hero, floating-card, and form styles (`.auth-shell`, `.auth-hero`, `.hero-stats`). The current `login.html` never used them: it loads `login.css` only. Commit `29162f2` replaced `styles.css` with app-only styles, so those rules are no longer in the working tree. They remain in git history at commit `e8d97e1` and can be restored for a redesigned login page.
