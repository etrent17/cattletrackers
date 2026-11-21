# 01 · Fix dashboard and cattle list

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/fix-core-views` | 1 | In review | agent | none |

## Goal
The dashboard, the cattle list, and the add/edit/delete/search workflows work in a browser, with icons showing.

## Background
`DashboardView` and `ListView` look up element IDs that `index.html` does not have (`stat-total-cattle` against `stat-total`, `all-cattle-tbody` against `list-body`, and others). `renderStats` throws on the first one, so every `refreshAllViews()` call crashes. As a result:
- After a successful add or edit, the record saves, but an error toast appears and the tables don't update.
- The All Cattle table never renders, so its Delete button is unreachable.

Covers known issues 1, 2, 3, and 12.

## Tasks
- [x] Decide which side changes: the JS IDs or the HTML IDs. Then make `DashboardView` and `ListView` match `index.html`
- [x] Dashboard: either add an alerts list to `index.html` or remove the alerts code from `renderEventsAndAlerts`
- [x] Upcoming events: show only future expected calvings, sorted by date (currently it takes the first three with any date)
- [x] Show `list-empty` (or the empty-table row) consistently when there are no results
- [x] Load Font Awesome 6 from `cdnjs.cloudflare.com` (the content security policy already allows cdnjs styles and fonts)
- [x] Calving-this-month: parse `YYYY-MM-DD` as a local date, not UTC (`CattleService.getStatistics`)
- [x] Remove the stale `/src/services/StorageService.js` reference, if any, from the service worker; bump `CACHE_NAME`
- [x] Run the Cattle records and Dashboard sections of the testing checklist

## Acceptance
- [x] Dashboard shows correct counts, the five most recent cattle, and upcoming calvings
- [x] Adding a cow updates the dashboard and list with a success toast and no error toast
- [x] Editing a cow updates both tables
- [x] All Cattle table renders; Delete removes the row after confirmation
- [x] Search and status filter narrow the table
- [x] Calving, Medical, and Breeding views show their filtered lists with the right titles
- [x] Icons appear on gender, action buttons, and events
- [x] Known issues 1, 2, 3, 12 moved to Resolved

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Reproduced the crash in Chromium (error toast "Cannot set properties of null" after Add). Changed the JS side to match `index.html` IDs (`DashboardView`, `ListView`); removed the dashboard alerts code (no alerts list on the page); upcoming events now come from `CattleService.getUpcomingCalvings()` (due today or later, males excluded, soonest first, max 5); `list-empty` shown when a list has no rows. Adjacent fix in `CattleController`: one `renderCattleList()` combines the current sub-view (All/Calving/Medical/Breeding) with search and status filter, so add/edit/delete no longer reset a filtered view to All Cattle. Font Awesome 6.5.2 loaded from cdnjs with SRI. `parseLocalDate`/`todayISO` added to `DateHelpers`; used by calving-this-month and `calculateAge` (age was also off by a month west of UTC). Service worker had no `StorageService.js` entry; `CACHE_NAME` bumped to v8. |
| 2026-11-21 | agent | Verified with Playwright/Chromium against PostgreSQL (demo herd + admin account), 41 scripted browser checks, no console errors: dashboard counts 8/1/1/4, 5 recent rows, sorted upcoming calvings excluding past dates; add (cow number only) and edit update both tables with a success toast; duplicate cow number (other case) and weights 0/6000 rejected; View dialog shows all fields; Delete removes the row after confirm (All Cattle and Calving views); search by number, name, medications, notes; status filter; Calving/Medical/Breeding titles and rows; reload persistence; one view visible at a time; icons render (font loaded); 390px phone width has no page overflow; empty herd shows empty states. Calving-this-month and age checked in America/Los_Angeles and Asia/Tokyo at month boundaries. CDNs are blocked in the test sandbox, so the browser was served byte-identical npm copies of Bootstrap 5.3.3 and Font Awesome 6.5.2 (SRI hash matched). Not ticked in `docs/testing-checklist.md` (shared file). Found for other features: (a) `src/app.js` redirects to login when `setupRequired` is true even for an authenticated demo user, so `/api/auth/demo` before setup loops between `/` and `/login.html`; (b) a cow saved without a gender displays as Female (`Cattle` model defaults gender to `female`). |
