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

`lastCalvingDate` follows the animal's calving events (see Calvings). On `POST` a date given for a female or unspecified animal is saved as her first calving event; it is ignored for a male. On `PUT` the field is ignored: record, edit or delete a calving to change it.

`weight` follows the animal's weighings (see Weighings): it is always the newest one, or `null`. On `POST` a weight is saved as the animal's first weighing, dated `weightDate` (optional, ISO 8601, not in the future; the server's UTC date when left out). On `PUT` a weight that differs from the current one (compared to the cent) is saved as a new weighing dated `weightDate`, and the response carries the resulting current weight (which stays the newer weighing if `weightDate` is older). The same weight, an empty string, `null` or no weight records nothing and keeps the current weight; to remove a weight, delete its weighings.

Fields: `tagNumber` (required, 1 to 25 characters), `nameBreed` (max 100), `gender` (`female` or `male`), `birthDate`, `lastCalvingDate`, `expectedCalvingDate` (ISO 8601), `weight` (lbs, 0.01 to 5000; `0` is refused with `Invalid weight`, while `""` or `null` mean no weight), `weightDate` (see above), `medications` (max 500), `healthStatus` (`healthy`, `under_treatment`, `quarantine`, `pregnant`), `notes` (max 2000).

A duplicate cow number returns 409 `Duplicate cow number`. `:id` must be a UUID.

## Transactions (`/api/transactions`, sign-in required)

Income and expense records. Every route only sees the signed-in user's transactions.

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Your transactions, newest date first. Optional query: `from`, `to` (inclusive `YYYY-MM-DD`), `cattleId` (one animal) |
| GET | `/summary` | Report figures for the optional `from` / `to` range (below) |
| POST | `/` | Creates a transaction; 201. Demo users are limited to 200 |
| PUT | `/:id` | Replaces a transaction (fields left out are cleared); 404 if not yours |
| DELETE | `/:id` | Deletes a transaction; 404 if not yours |

Fields: `date` (required, `YYYY-MM-DD`, a real calendar date), `kind` (`income` or `expense`), `category` (required, 1 to 50 characters after trimming; the app suggests Feed, Vet and medicine, Breeding, Equipment, Labour, Sale of animals, Milk, Other), `amount` (required, greater than 0, at most 10 digits before the point and 2 after; a string such as `"125.50"` or a JSON number), `cattleId` (optional, the id of one of **your** animals; anything else returns 400 `Unknown animal`), `description` (max 500).

**Amounts are strings.** Responses return every amount and total as a decimal string with two decimals (`"1234.50"`, `"-0.30"`), exactly as PostgreSQL's `NUMERIC` holds it. Parse them as decimals or whole cents, not by adding JavaScript numbers. The amount is always positive; `kind` gives the direction.

A transaction in a response also has `id`, `cattleTagNumber` and `cattleName` (the linked animal, or `null`), `createdAt` and `updatedAt`. Deleting an animal keeps its transactions and sets `cattleId` to `null`.

`from` after `to`, a malformed date or a malformed `cattleId` returns 400.

### Summary

```json
{
  "from": "2026-01-01", "to": "2026-03-31", "count": 5,
  "income": "1710.40", "expenses": "200.00", "net": "1510.40",
  "herdSize": 3, "costPerHead": "66.67",
  "byCategory": [{ "kind": "income", "category": "Sale of animals", "total": "1500.00", "count": 1 }],
  "byMonth": [{ "month": "2026-02", "income": "1500.00", "expenses": "100.00", "net": "1400.00" }]
}
```

All sums are computed in SQL on `NUMERIC` values. `net` is income minus expenses. `byCategory` has one row per kind and category (income first, largest first); `byMonth` has one row per calendar month that has transactions, oldest first. `costPerHead` is the expenses in the range divided by the number of animals on record **now** (`herdSize`), rounded to the cent; it is `null` when you have no animals. It does not average the herd size over the period.

## Users (`/api/users`, admin only)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Lists non-demo users: `id`, `email`, `role`, `created_at`, `cattle_count` |
| POST | `/` | `email`, `password` (10 to 128 characters), optional `role` (`admin` or `user`, default `user`); 201 with the new user; 409 if the email is taken |
| PATCH | `/:id` | `role` (`admin` or `user`); 200 with the updated user. 404 for an unknown or demo user; 409 if it would demote the last admin |
| DELETE | `/:id` | Deletes the user, their cattle (cascade), and their sessions. 400 if deleting yourself; 404 if missing; 409 if it is the last admin |

The role is read from the database on every request to these routes, so a demoted admin gets 403 on their next request and a session whose user was deleted gets 401 `Session expired`. A bad `role` returns 400 `Role must be admin or user`. Role changes and deletions are serialised, so two admins acting on each other at the same time still leave one admin.

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

## Weighings (sign-in required)

An animal's weight history, in lbs.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/weighings` | Every weighing in your herd, newest first (date, then time recorded) |
| GET | `/api/cattle/:cattleId/weighings` | One animal's weighings, newest first; 404 `Cattle not found` if the animal is not yours |
| POST | `/api/cattle/:cattleId/weighings` | Records a weighing; 201. 404 if the animal is not yours |
| POST | `/api/weighings/batch` | Records weighings for several animals on one date (below) |
| PUT | `/api/weighings/:id` | Replaces the weighing's fields (fields left out are cleared); 404 `Weighing not found` if not yours. The animal cannot be changed |
| DELETE | `/api/weighings/:id` | Deletes the weighing; 404 if not yours |

Fields: `date` (required, ISO 8601, a real calendar date, not in the future: `Enter a valid weighing date`, `The weighing date cannot be in the future`), `weight` (required, a number or numeric string from 0.01 to 5000: `Invalid weight`), `notes` (max 2000: `Notes are too long`). Each weighing is returned as `{ id, cattleId, cattleTag, cattleName, date, weight, notes, createdAt }`, with `weight` as a number and `notes` as `""` when empty.

After every create, update and delete, the animal's `weight` is set to its newest weighing (latest date, then latest recorded; `null` when none are left), in the same transaction. Deleting an animal deletes its weighings.

### Batch entry

`POST /api/weighings/batch` with `{ "date": "2026-11-21", "rows": [{ "cattleId": "…", "weight": 1180, "notes": "" }, …] }` (1 to 500 rows). A bad `date` or a missing, empty or oversized `rows` is a 400 and nothing is saved (`Send 1 to 500 rows`).

Otherwise each row is judged on its own: every valid row is saved and every invalid one is reported, so one mistake does not lose a whole weigh day. The valid rows are written in one transaction (a server error saves none of them). The answer is always 200:

```json
{
  "date": "2026-11-21",
  "saved": [{ "index": 0, "weighing": { "id": "…", "cattleTag": "CT-001", "weight": 1180, "…": "…" } }],
  "failed": [{ "index": 1, "cattleId": "…", "error": "Invalid weight" }]
}
```

`index` is the row's position in `rows`. Row errors: `Invalid row` (not an object), `Choose an animal` (missing or malformed `cattleId`), `Invalid weight`, `Notes are too long`, `This animal is already in the batch` (the second row for the same animal), `Animal not found` (no such animal in your herd, including another user's).

## Not available

There are no performance-report, health-report, or treatment endpoints.
