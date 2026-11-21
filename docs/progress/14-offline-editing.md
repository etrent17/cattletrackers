# 14 · Offline editing

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/offline-editing` | 4 | In review | agent | 02, 04 |

## Goal
Herd records can be viewed and edited without a connection (for example, out in a barn), and changes sync when the connection returns.

## Background
The service worker caches static files only; `/api/` requests are never cached, so the app is unusable offline. This is a large feature, so settle the scope first.

## Decisions needed before starting
- [x] Which data must work offline: cattle only, or events too? **Cattle records only** (project lead). Viewing the herd (dashboard, All Cattle list, a cow's Details tab) and adding, editing and deleting cattle work offline. Event-record pages (calving, medical, breeding, weights, financial), reports, user management and the password form are online-only: offline they show a "needs a connection" state instead of errors, and their buttons cannot be reached.
- [x] Conflict rule when the same record changed online and offline (last write wins, or ask the user). **The server wins, and nothing is lost silently** (project lead). A queued edit or delete carries the record's `updatedAt` as last seen (`expectedUpdatedAt`); the server answers 409 if the row changed since. On a conflict or any other refusal (duplicate cow number, validation, deleted elsewhere) the server's version is kept and the user's change goes to a visible "Unsynced changes" list, where it can be viewed, applied again as a new change, or discarded.

Decisions made while building (documented in `docs/architecture-and-data.md`, "Offline editing"):
- **Partial failure during replay.** No answer from the server (network error, 502/503/504, 401, 408, 429) **stops** the replay and keeps every remaining change queued in order. A refusal moves that change to Unsynced changes, together with later changes to the same animal (they were made on top of it), and replay **continues** with the other animals. A server error (500) is retried twice, then treated as a refusal so one bad record cannot block the queue.
- **Online behaviour is unchanged.** A change made while online goes straight to the server without `expectedUpdatedAt` (last write wins, as before). Only changes that had to be queued carry it.
- **A lost answer is not a conflict.** New animals always get their id in the browser, so a repeated create returns the existing row; a delete answered 404 counts as done; an edit answered "changed since" whose values the server already holds counts as done.
- **A different account never receives queued changes.** Before sending, replay checks that the session still belongs to the account the outbox was filled under.
- **Session expiry keeps the copy; sign-out and a different account clear it.** A user whose session ran out while offline keeps their queued changes and syncs after signing in again.

## Tasks
- [x] Cache the herd in IndexedDB after each successful load (and after every accepted change): `src/services/OfflineStore.js`
- [x] Show cached data when offline, with a clear "offline" banner (says when the herd was last updated; the top-bar indicator follows real reachability)
- [x] Queue creates, edits, and deletes made offline: the outbox in `src/services/SyncEngine.js`; the list shows them at once, marked "Not synced", and the banner counts them
- [x] Replay the queue on reconnect; report failures, such as a duplicate cow number. Also at startup, right after queueing, on "Sync now", and on a timer while something is waiting
- [x] Client-generated IDs (UUIDs) so offline-created records keep their identity: `POST /api/cattle` accepts `id`; a replay of the same create is idempotent; another user's id is refused with a generic error
- [x] Conflict handling per the decision above: `expectedUpdatedAt` on `PUT` and `DELETE /api/cattle/:id` (409 with the current row), "Unsynced changes" banner and dialog with Apply again and Discard
- [x] Clear cached data on sign out (with a warning first when changes are waiting or unsynced), and when a different user signs in
- [x] Weight changed offline is dated the day the change was made, not the day it synced (`weightDate` stored with the queued change)
- [x] Service worker: every file in `urlsToCache` exists (checked by the browser test); the new modules are listed; the CDN files the page needs are cached too; no `/api/` answer is cached. `CACHE_NAME` is now `cattle-trackers-v16` because the worker's logic changed
- [x] Fixed: the top bar said "Online" when the app started offline (`boot()` returned before `setupOnlineStatus` ran)
- [x] Online-only pages show "This page needs a connection" while offline; the cow details dialog shows only Details; the password form is disabled
- [x] Docs: `docs/api.md`, `docs/user-guide.md`, `docs/architecture-and-data.md`, `docs/feature-inventory.md`, `docs/testing-checklist.md`, `docs/known-issues.md` (Resolved), README

## Acceptance
- [x] With the network off, the herd is visible and a new cow can be added (and an existing one edited and deleted). Browser test, `e2e/offline.e2e.js`
- [x] Reconnecting syncs the new cow to the server, with the id chosen offline and its weighing dated the day it was added. Browser test
- [x] Signing out removes the offline copy (IndexedDB is empty afterwards; opening the app offline then shows no herd). Browser test
- [x] A conflict (the same cow edited in a second, online browser first) lands in Unsynced changes and the server version is shown; the change can be applied again or discarded. Browser test
- [x] The app starts with the network off from the saved copy, and the indicator says Offline. Browser test with the real service worker
- [x] A different account signing in on the same browser neither sees the previous copy nor receives its queued changes. Browser test

## Notes
- **Shared files touched** (for the integrator): `app.js` (one CSP line, `connect-src`), `routes/cattle.js`, `public/index.html` (sync banner, needs-connection section, Unsynced changes dialog), `public/service-worker.js` (`CACHE_NAME` v16, five new files in `urlsToCache`, CDN caching), `src/app.js` (rewritten startup), `src/controllers/CattleController.js` (`switchView`, `handleInspect`, `handleFormSubmit`, `handleDelete`, new methods; `renderSecondaryView` and `setupEventListeners` bodies are otherwise untouched; `setupOnlineStatus` removed), `src/controllers/UsersController.js` (two lines), `src/services/CattleService.js`, `src/models/Cattle.js` (`pendingSync`), `src/views/ListView.js` (badge), `src/views/SettingsView.js` (the "Working offline" text), `e2e/helpers/browser.js` (options; existing calls unchanged), `e2e/settings.e2e.js` and `test/api/app.test.js` (one assertion each). `public/styles.css` is not touched.
- **The CSP line is required**, not cosmetic. The service worker fetches the CDN files itself, and a worker's `fetch()` is checked against `connect-src`. Without the entry, every Bootstrap request from a page the worker controls fails, online as well. Found by running the real worker; the browser test now fails without it.
- Any new browser module must still be added to `urlsToCache` (the reports modules from feature 12 included), or the app will not start offline. The browser test checks that every listed file exists and is cached, not that the list is complete.
- New e2e dependency: the `openssl` command, used to make a throwaway certificate for a local HTTPS server that stands in for the CDNs (`e2e/helpers/cdn.js`). Playwright cannot answer a service worker's own requests, so the usual route stubs do not work for that one test.

## Not verified
- The real CDNs (cdn.jsdelivr.net, cdnjs.cloudflare.com) are blocked where this was built. The worker was verified against a local HTTPS stand-in serving Bootstrap from `node_modules`; Font Awesome there is an empty stylesheet, so its icon fonts (fetched by the stylesheet, cached by the worker on first use) and its `integrity` check on a cached copy were not exercised.
- Only Chromium was tested. Firefox and Safari (IndexedDB, service worker, `navigator.locks`) are untested.
- Two tabs replaying at the same time is guarded by a Web Lock and by idempotent requests; the lock path is unit-tested with a fake, not with two real tabs.
- The fallback for a browser without IndexedDB (no queueing, behaviour as before) is unit-tested, not tried in a real private window.
- Behind a reverse proxy over HTTPS (the deployment guide's Caddy setup) was not run.

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Decisions recorded (cattle only; server wins, nothing lost silently). API: client `id` on create, `expectedUpdatedAt` on update and delete. Browser: IndexedDB copy of the herd, outbox with ordered replay, Unsynced changes list, offline banner and indicator fix, online-only pages gated, service worker caches the CDN files (needs `connect-src` in the CSP). Tests: 26 API, 68 unit, 13 browser (one with the real service worker). `npm test` and `npm run test:e2e` pass. Ready for review. |
