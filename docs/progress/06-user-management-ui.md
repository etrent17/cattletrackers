# 06 · User management screen

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/user-management-ui` | 2 | In review | agent | 01 |

## Goal
Admins can list, add, and remove users, and change roles, from the app. Non-admins don't see the menu item.

## Background
`routes/users.js` already supports list, create, and delete (admin only). The User Management nav item shows herd statistics instead (known issue 7). Each user has their own separate herd.

Two gaps in the API:
- `requireAdmin` trusts the role saved in the session at login, so a demoted admin keeps admin rights until they sign out.
- Deleting a user does not end their open sessions (their next request fails, but only because of the foreign-key error handler).

## Tasks
- [x] Hide the User Management nav item for non-admins (`window.currentUser.role`; `applyUserManagementAccess()` called from `src/app.js` after the status check)
- [x] Users table: email, role, created date, Delete button (not for yourself) (also the number of animals; `GET /api/users` now returns `cattle_count`)
- [x] Add-user form: email, temporary password, role
- [x] API: `PATCH /api/users/:id` to change role; refuse demoting the last admin (409)
- [x] Load the role from the database on each admin request, or end that user's sessions when the role changes (`requireAdmin` reads the role from `users`; the PATCH also updates the role stored in that user's sessions)
- [x] End a deleted user's sessions (their rows in `session` are deleted in the same transaction)
- [x] Confirm before deleting; warn that the user's cattle are deleted too (cascade) (the confirmation names the number of cattle records)

## Acceptance
- [x] A regular user does not see User Management, and `/api/users` returns 403 for them
- [x] An admin can add a user, who can then sign in
- [x] Demoting an admin takes effect immediately
- [x] The last admin cannot be demoted or deleted
- [ ] Known issue 7 moved to Resolved (added to the Resolved list; per the parallel-work rule only the Resolved list was edited, so the integrator still removes item 7 from Open)

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Built the screen (`src/views/UsersView.js`, `src/controllers/UsersController.js`), added `PATCH /api/users/:id`, made `requireAdmin` read the role from the database (missing user: session ended, 401), deleted users' sessions are removed, and the last admin is protected under an advisory lock (a negative control without the lock let two admins delete each other). API tests in `test/api/users.test.js` (31 tests, incl. concurrent mutual demotion and deletion) and a browser test `e2e/users.e2e.js` (list, add, duplicate email, role change, cancel and confirm delete, regular user, self-demotion). `npm test`: 166 pass, 1 existing todo; `npm run test:e2e`: 19 pass. Also checked in Chromium that emails containing markup (`"<img src=x onerror=alert(1)>"@example.com`, `</td><b>…`) display literally, and the layout at 390 px wide. `test:e2e` now runs files one at a time because each file empties the shared database. |
