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
| GET | `/` | Lists non-demo users |
| POST | `/` | `email`, `password`, optional `role`; 201 |
| DELETE | `/:id` | 400 if deleting yourself; 404 if missing |

## Not available

There are no performance-report, health-report, calving-history, or treatment endpoints.
