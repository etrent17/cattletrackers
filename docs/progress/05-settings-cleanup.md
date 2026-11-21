# 05 · Settings and account

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/settings-cleanup` | 2 | Not started | — | 01 |

## Goal
The System Settings page is accurate and useful: it shows the signed-in account and lets the user change their password.

## Background
The page says data is stored in `localStorage` and offers a "Reset to Blueprint Sample Herd" button that only clears a key the app does not use (known issue 6). `src/services/StorageService.js` is never imported.

## Tasks
- [ ] Remove the `localStorage` text and the reset button
- [ ] Delete the unused `StorageService.js`
- [ ] Show the account email, role, and whether it is a demo account
- [ ] API: `POST /api/auth/password` (current password plus new password, 10 to 128 characters, rate limited)
- [ ] Change-password form on the settings page
- [ ] Hide or disable password change for demo accounts
- [ ] Describe offline behaviour accurately (static files cached, data needs a connection)

## Acceptance
- [ ] Changing the password with the wrong current password is refused
- [ ] After a change, the old password no longer works and the new one does
- [ ] Settings page contains no reference to `localStorage`
- [ ] Known issue 6 moved to Resolved

## Progress log
| Date | Who | Note |
|---|---|---|
