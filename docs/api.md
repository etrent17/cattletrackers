# API Reference

All bodies are JSON. Errors have the form `{ "error": "message" }`. Validation failures return 400 with the first message.

## Health

`GET /api/health` runs `SELECT 1` against the database. It returns 200 `{ "status": "healthy", "database": "up" }`, or 503 `{ "status": "unhealthy", "database": "down" }` when the database is unreachable or does not answer within 3 seconds. No authentication or session is needed.

## Auth (`/api/auth`)

| Method | Path | Notes |
|---|---|---|
| GET | `/status` | Returns `setupRequired`, `demoEnabled`, `authenticated`, `user` |
| POST | `/setup` | `email`, `password`. 201 with the new admin; 403 if already set up |
| POST | `/login` | `email`, `password`. 401 on bad credentials |
| POST | `/demo` | 201; 404 if demo mode is off; 503 if too many demo users |
| POST | `/logout` | Destroys the session |
| POST | `/password` | Sign-in required. `currentPassword`, `newPassword` (10 to 128 characters). 200 `{ "ok": true }`; see below |

### Changing the password

`POST /api/auth/password` checks `currentPassword` against the stored argon2 hash and stores `newPassword` hashed. On success every other session of the same user is deleted (other browsers and devices must sign in again) and the current session gets a new ID with a new cookie, so the caller stays signed in.

| Status | When |
|---|---|
| 400 | `Current password is incorrect`; `Enter your current password`; `New password must be 10 to 128 characters`; `New password must be different from the current one` |
| 401 | Not signed in, or the account no longer exists |
| 403 | `Demo accounts can't change their password` |
| 429 | More than 10 attempts in 15 minutes by the same user (counted per account, successful or not) |

A wrong current password answers 400, not 401, because the browser treats 401 as "signed out".

## Cattle (`/api/cattle`, sign-in required)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Your cattle, newest first |
| POST | `/` | Creates a record; 201. Demo users are limited to 25 |
| PUT | `/:id` | Updates a record; 404 if not yours |
| DELETE | `/:id` | Deletes a record; 404 if not yours |

Fields: `tagNumber` (required, 1 to 25 characters), `nameBreed` (max 100), `gender` (`female` or `male`), `birthDate`, `lastCalvingDate`, `expectedCalvingDate` (ISO 8601), `weight` (greater than 0, max 5000), `medications` (max 500), `healthStatus` (`healthy`, `under_treatment`, `quarantine`, `pregnant`), `notes` (max 2000).

A duplicate cow number returns 409 `Duplicate cow number`. `:id` must be a UUID.

## Users (`/api/users`, admin only)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Lists non-demo users |
| POST | `/` | `email`, `password`, optional `role`; 201 |
| DELETE | `/:id` | 400 if deleting yourself; 404 if missing |

## Not available

There are no financial, report, calving-history, or treatment endpoints.
