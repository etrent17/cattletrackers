# 05 · Settings and account

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/settings-cleanup` | 2 | In review | agent | 01 |

## Goal
The System Settings page is accurate and useful: it shows the signed-in account and lets the user change their password.

## Background
The page says data is stored in `localStorage` and offers a "Reset to Blueprint Sample Herd" button that only clears a key the app does not use (known issue 6). `src/services/StorageService.js` is never imported.

## Tasks
- [x] Remove the `localStorage` text and the reset button
- [x] Delete the unused `StorageService.js`
- [x] Show the account email, role, and whether it is a demo account
- [x] API: `POST /api/auth/password` (current password plus new password, 10 to 128 characters, rate limited)
- [x] Change-password form on the settings page
- [x] Hide or disable password change for demo accounts
- [x] Describe offline behaviour accurately (static files cached, data needs a connection)

## Acceptance
- [x] Changing the password with the wrong current password is refused
- [x] After a change, the old password no longer works and the new one does
- [x] Settings page contains no reference to `localStorage`
- [ ] Known issue 6 moved to Resolved (entry appended to Resolved; removing it from Open is left to the integrator, per the rule that parallel branches only append to the Resolved list)

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Added `POST /api/auth/password` (`routes/auth.js`): current password checked with argon2 `verifyPassword`, new password 10 to 128 characters and different from the current one, 403 for demo accounts, 400 (not 401) for a wrong current password so the browser does not treat it as signed out, rate limited to 10 attempts per 15 minutes keyed by user ID. On success it updates the hash and deletes the user's other sessions in one transaction, then regenerates the current session: a password change usually means the old one may be known to someone else, so other devices are signed out and a session ID that leaked earlier stops working, while the person changing it stays signed in. New `SettingsView` (+ `AccountService`; `CattleService` now exports `api()`) replaces the settings branch of `renderSecondaryView`; user values escaped. Offline text checked in Chromium with the service worker active and the context offline: the cached page opens and shows the can't-reach-server banner. Deleted `StorageService.js` and `ApiClient.js` (grep: no imports). Tests: `test/api/password.test.js` (12), `test/api/password-rate-limit.test.js` (limiter on), `test/unit/settings-view.test.mjs`, `e2e/settings.e2e.js` (8, includes a second browser being signed out and escaping of the email). `npm test` 170 tests: 169 pass, 1 existing TODO (weight 0), 0 fail; `npm run test:e2e` 17 pass. `test:e2e` now runs files one at a time. |
