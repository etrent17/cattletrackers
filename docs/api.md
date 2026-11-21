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
| GET | `/` | Lists non-demo users: `id`, `email`, `role`, `created_at`, `cattle_count` |
| POST | `/` | `email`, `password` (10 to 128 characters), optional `role` (`admin` or `user`, default `user`); 201 with the new user; 409 if the email is taken |
| PATCH | `/:id` | `role` (`admin` or `user`); 200 with the updated user. 404 for an unknown or demo user; 409 if it would demote the last admin |
| DELETE | `/:id` | Deletes the user, their cattle (cascade), and their sessions. 400 if deleting yourself; 404 if missing; 409 if it is the last admin |

The role is read from the database on every request to these routes, so a demoted admin gets 403 on their next request and a session whose user was deleted gets 401 `Session expired`. A bad `role` returns 400 `Role must be admin or user`. Role changes and deletions are serialised, so two admins acting on each other at the same time still leave one admin.

## Not available

There are no financial, report, calving-history, or treatment endpoints.
