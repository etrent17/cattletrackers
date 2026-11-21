# Authentication and Users

## Roles

- **admin**: full access, including the `/api/users` routes
- **user**: access to their own cattle only

## First-time setup

When no non-demo user exists, the login page switches to setup mode and creates the first account as admin. Setup is locked with a database advisory lock and refuses to run again once a user exists.

## Sessions

- Stored in PostgreSQL in a `session` table created automatically
- Cookie: httpOnly, SameSite lax, 7-day lifetime; `secure` only when `COOKIE_SECURE=true`
- A new session is created at login to prevent session fixation
- Over plain HTTP, leave `COOKIE_SECURE` unset or the session will not be saved

## Passwords

Between 10 and 128 characters. Hashing is handled by `lib/password.js`. Login compares against a dummy hash when the email is unknown.

## Limits

- Setup and login: 20 requests per 15 minutes per client
- Demo creation: 10 per hour per client; refused when 200 demo users exist

## Demo mode

Enabled by `DEMO_MODE=true`. Each demo session creates a temporary user (`demo-<random>@demo.invalid`) with eight sample animals. Sessions last four hours, demo users are capped at 25 animals, and expired demo users are deleted every 15 minutes.

## Managing users

Admins manage users on the **User Management** screen (or through `/api/users`, see [api.md](api.md)). The nav item is shown to admins only, and the API returns 403 to everyone else.

- **List**: email, role, number of animals, date added. Demo users are not listed.
- **Add**: email, temporary password (10 to 128 characters), and role. Give the password to the new user privately; they sign in with it. There is no password change or reset screen yet.
- **Change role**: pick Admin or User in the table. It takes effect on the user's next request without signing them out.
- **Delete**: asks for confirmation first and says how many cattle records go with the user. **Deleting a user also deletes all of that user's cattle** (database cascade) and signs them out everywhere.

Rules, enforced by the server:

- There is always at least one admin: the last admin cannot be demoted or deleted (409). Promote someone else first.
- Admins cannot delete themselves. They can remove their own admin access while another admin remains (the screen asks first).

### How role changes and deletions take effect

The session saved at sign-in holds the user's id and role, but the role there is not trusted for admin access:

- `requireAdmin` (`middleware/auth.js`) loads the user's current role from the `users` table on every `/api/users` request. A demoted admin gets 403 on their next admin request, and a promoted user gets admin access straight away. If the user no longer exists, the session is ended and the request gets 401. This costs one primary-key lookup per admin request; ordinary cattle requests are unaffected.
- `PATCH /api/users/:id` also rewrites the `role` stored in that user's open sessions, so nothing reading `req.session.role` sees a stale value.
- `DELETE /api/users/:id` deletes the user's rows from the `session` table in the same transaction (connect-pg-simple stores the session as JSON with `userId`), so all their open sessions end at once and their next request gets 401.
- Role changes and deletions take a PostgreSQL advisory lock, so two admins demoting or deleting each other at the same moment cannot leave the app without an admin.

## Data isolation

Every cattle query filters on the signed-in user's id, so users cannot read or change each other's animals.
