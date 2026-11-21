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

`lastCalvingDate` follows the animal's calving events (see Calvings). On `POST` a date given for a female or unspecified animal is saved as her first calving event; it is ignored for a male. On `PUT` the field is ignored: record, edit or delete a calving to change it.

Fields: `tagNumber` (required, 1 to 25 characters), `nameBreed` (max 100), `gender` (`female` or `male`), `birthDate`, `lastCalvingDate`, `expectedCalvingDate` (ISO 8601), `weight` (greater than 0, max 5000), `medications` (max 500), `healthStatus` (`healthy`, `under_treatment`, `quarantine`, `pregnant`), `notes` (max 2000).

A duplicate cow number returns 409 `Duplicate cow number`. `:id` must be a UUID.

## Users (`/api/users`, admin only)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Lists non-demo users |
| POST | `/` | `email`, `password`, optional `role`; 201 |
| DELETE | `/:id` | 400 if deleting yourself; 404 if missing |

## Calvings (sign-in required)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/calvings` | Every calving in your herd, newest calving date first |
| GET | `/api/cattle/:cattleId/calvings` | One animal's calvings, newest first; 404 `Cattle not found` if the animal is not yours |
| POST | `/api/cattle/:cattleId/calvings` | Records a calving; 201. 404 if the animal is not yours; 400 if it is male |
| PUT | `/api/calvings/:id` | Replaces the calving's fields (fields left out are cleared); 404 `Calving record not found` if not yours. The animal cannot be changed |
| DELETE | `/api/calvings/:id` | Deletes the calving; 404 if not yours. A calf that was added as an animal is kept |

Fields: `calvingDate` (required, ISO 8601, not in the future), `calfSex` (`female` or `male`), `calfTag` (max 25), `birthWeight` (greater than 0, max 500), `ease` (`unassisted`, `assisted`, `caesarean`), `outcome` (`alive`, `stillborn`), `notes` (max 2000). Everything but the date is optional and comes back as `""` (`null` for the weight) when not recorded.

Each calving is returned as `{ id, cattleId, cattleTag, cattleName, calvingDate, calfSex, calfTag, birthWeight, ease, outcome, notes, createdAt }`.

`POST` also accepts two booleans:

- `addCalf: true` adds the calf to the herd as a new animal: `calfTag` becomes its cow number (so it is required), `calfSex` its gender, `calvingDate` its birth date and `birthWeight` its weight. The response then has the new animal under `calf` (otherwise `calf` is `null`). The usual rules apply: a duplicate cow number returns 409 and a demo account at its 25-animal limit returns 403. In both cases nothing is saved, the calving included. Not allowed with `outcome: "stillborn"` (400).
- `clearExpected: true` clears the mother's `expectedCalvingDate` and changes a `pregnant` health status to `healthy`.

After every create, update and delete, the animal's `lastCalvingDate` is set to her newest calving date (empty when she has none), in the same transaction. Deleting an animal deletes her calvings.

## Not available

There are no financial, report, or treatment endpoints.
