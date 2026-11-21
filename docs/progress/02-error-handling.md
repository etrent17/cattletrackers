# 02 · Error handling

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/error-handling` | 1 | In review | agent | 01 |

## Goal
When something fails (server down, session expired, a request rejected), the user sees a clear message instead of a page with dead buttons or a silent failure.

## Background
- `CattleController.init()` attaches event listeners only after cattle load, and `app.js` does not catch a failed `init()`. A failed load leaves buttons that do nothing (known issue 8).
- `handleDelete` has no try/catch; a failed delete is an unhandled error (known issue 9).
- Sign out ignores a failed request.

## Tasks
- [x] Attach event listeners before loading data in `init()`
- [x] Catch a failed initial load: show an error banner with a Retry button
- [x] Catch errors in `app.js` around `init()`
- [x] Wrap `handleDelete` in try/catch and show an error toast
- [x] Make `refreshAllViews` resilient so one failing view does not stop the others
- [x] Sign out: on failure, still go to the login page, or show a toast
- [x] Disable the Save button while a save is in flight (prevents double submits)

## Acceptance
- [x] With the server stopped, loading the app shows an error banner; Retry works once the server is back
- [x] Deleting a record that was already deleted (two tabs) shows an error toast
- [x] Double-clicking Save creates one record, not two
- [x] An expired session on any action returns to the login page
- [x] Known issues 8 and 9 moved to Resolved

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Implemented. `CattleController.init()` attaches listeners first, then `loadData()`, which on failure shows a new error banner (`#error-banner`, under the top bar) with Retry that reloads the herd in place. `app.js` shows the same banner when `/api/auth/status` is unreachable or not OK (Retry re-runs startup) and catches a failing controller start-up (Retry reloads the page). `handleDelete` catches errors: error toast; a 404 (already deleted elsewhere) says so and resyncs the list. `refreshAllViews` renders each part in its own try/catch and shows one error toast if any part fails. Sign out: on a failed request, error toast and stay (the session was not ended), button disabled while in flight. Save disabled and re-entry guarded while a save is in flight. `CattleService` errors carry `status` (0 = unreachable, readable message) and `sessionExpired` on 401 (redirect as before; callers skip their own toast). Toast/banner helpers in new `src/utils/feedback.js` (service worker caches it, `CACHE_NAME` v9); a newer toast is no longer cut short by an older toast's timer; error toasts stay 6 s. Also fixed two issues found during 01: (a) `app.js` sent authenticated sessions to login while `setupRequired`, so a demo session created before any admin looped between `/` and `/login.html`; both pages now use "authenticated -> app, else -> login" (`auth.js` already did; it still shows only the setup form while no admin exists). (b) The `Cattle` model defaulted a missing gender to `female`; it now keeps `""`, shown as a muted "—" in both tables and the details dialog via `formatGender()`, and the edit form shows "Select Gender". The Calving view now excludes only males (as upcoming calvings already did), so unknown-gender cows with calving dates stay listed. |
| 2026-11-21 | agent | Verified with Playwright/Chromium against PostgreSQL (admin via `/api/auth/setup`, one demo session): real outage (service worker cached the shell, own server process stopped, reload shows "Can't reach the server" banner, Retry while down keeps it, Retry after restart loads 5 rows and hides it, Add button works); `/api/cattle` aborted and answered 500 (banner, Add modal and navigation still work, Retry recovers); `/api/auth/status` aborted and 503; Bootstrap JS missing (start-up banner, Retry reloads). Delete in tab 2 then tab 1: error toast "already deleted", list resynced; aborted delete: error toast, row kept. Double-click Save with a 700 ms delayed POST: Save disabled in flight, 1 POST, 1 record. Expired session (rows deleted from the `session` table) on save new, save edit, delete, reload, cattle load (401 after status) and sign out: each lands on `/login.html`. Sign out aborted: error toast, stays, button re-enabled. A view made to throw: stats, recent and list tables still render, error toast shown. Demo session before setup: stays on `/` with no redirect loop; `login.html` sends it back to `/`. Unknown gender: "—" in dashboard, list and details dialog; edit form shows "Select Gender"; saving unchanged keeps it unknown; setting Female saves `female`. Banner checked at 390 px (no horizontal overflow). Not covered: with the server stopped before any visit (no cached shell) the browser shows its own offline page; while `/api/auth/status` fails the nav links and Add button stay inert until Retry succeeds (the banner explains). |
