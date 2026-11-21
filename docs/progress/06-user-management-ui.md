# 06 · User management screen

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/user-management-ui` | 2 | Not started | — | 01 |

## Goal
Admins can list, add, and remove users, and change roles, from the app. Non-admins don't see the menu item.

## Background
`routes/users.js` already supports list, create, and delete (admin only). The User Management nav item shows herd statistics instead (known issue 7). Each user has their own separate herd.

Two gaps in the API:
- `requireAdmin` trusts the role saved in the session at login, so a demoted admin keeps admin rights until they sign out.
- Deleting a user does not end their open sessions (their next request fails, but only because of the foreign-key error handler).

## Tasks
- [ ] Hide the User Management nav item for non-admins (`window.currentUser.role`)
- [ ] Users table: email, role, created date, Delete button (not for yourself)
- [ ] Add-user form: email, temporary password, role
- [ ] API: `PATCH /api/users/:id` to change role; refuse demoting the last admin
- [ ] Load the role from the database on each admin request, or end that user's sessions when the role changes
- [ ] End a deleted user's sessions
- [ ] Confirm before deleting; warn that the user's cattle are deleted too (cascade)

## Acceptance
- [ ] A regular user does not see User Management, and `/api/users` returns 403 for them
- [ ] An admin can add a user, who can then sign in
- [ ] Demoting an admin takes effect immediately
- [ ] The last admin cannot be demoted or deleted
- [ ] Known issue 7 moved to Resolved

## Progress log
| Date | Who | Note |
|---|---|---|
