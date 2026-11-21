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

Admins can list, create, and delete users through the API. There is no screen for this yet. Admins cannot delete themselves. **Deleting a user also deletes all of that user's cattle** (database cascade).

## Data isolation

Every cattle query filters on the signed-in user's id, so users cannot read or change each other's animals.
