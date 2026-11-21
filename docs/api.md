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
| POST | `/` | Creates a record; 201. Demo users are limited to 25. Optional `id`: see "Offline changes" |
| PUT | `/:id` | Updates a record; 404 if not yours. Optional `expectedUpdatedAt`: see "Offline changes" |
| DELETE | `/:id` | Deletes a record; 404 if not yours. Optional `expectedUpdatedAt`: see "Offline changes" |

`lastCalvingDate` follows the animal's calving events (see Calvings). On `POST` a date given for a female or unspecified animal is saved as her first calving event; it is ignored for a male. On `PUT` the field is ignored: record, edit or delete a calving to change it.

`weight` follows the animal's weighings (see Weighings): it is always the newest one, or `null`. On `POST` a weight is saved as the animal's first weighing, dated `weightDate` (optional, ISO 8601, not in the future; the server's UTC date when left out). On `PUT` a weight that differs from the current one (compared to the cent) is saved as a new weighing dated `weightDate`, and the response carries the resulting current weight (which stays the newer weighing if `weightDate` is older). The same weight, an empty string, `null` or no weight records nothing and keeps the current weight; to remove a weight, delete its weighings.

Fields: `tagNumber` (required, 1 to 25 characters), `nameBreed` (max 100), `gender` (`female` or `male`), `birthDate`, `lastCalvingDate`, `expectedCalvingDate` (ISO 8601), `weight` (lbs, 0.01 to 5000; `0` is refused with `Invalid weight`, while `""` or `null` mean no weight), `weightDate` (see above), `medications` (max 500), `healthStatus` (`healthy`, `under_treatment`, `quarantine`, `pregnant`), `notes` (max 2000).

Each animal is also returned with `withdrawalUntil`: the latest withdrawal date of its treatments, or `""` (see Treatments). It is read-only; `POST` and `PUT` ignore it.

A duplicate cow number returns 409 `Duplicate cow number`. `:id` must be a UUID.

### Offline changes

Three optional additions let the browser replay changes it queued while it had no connection. A request without them behaves exactly as described above.

**`id` on `POST`** (a UUID chosen by the client; `null` or left out means the server chooses). The new animal gets that id, so a request can be repeated safely:

| Situation | Answer |
|---|---|
| The id is free | 201 with the new animal |
| You already have an animal with that id (an earlier attempt got through but its answer was lost) | 200 with that animal as it is now; nothing is written, whatever the body says |
| The id belongs to another user, or lost a race with another request | 409 `This record could not be saved with that id. Add it again.` Nothing about the other record is returned |
| Not a UUID | 400 `Invalid id` |

**`expectedUpdatedAt` on `PUT`** (in the body) **and `DELETE`** (in the query string, `?expectedUpdatedAt=...`, or in a JSON body). It is the animal's `updatedAt` exactly as the client last received it. If the stored `updatedAt` differs, the animal has changed since (edited, or one of its calvings, weighings, treatments, breedings or pregnancy checks changed its summary fields), and the request is refused; the server's version stands:

```json
{
  "error": "This record was changed after you last loaded it. Your change was not saved.",
  "code": "stale",
  "current": { "id": "...", "tagNumber": "CT-001", "updatedAt": "..." }
}
```

The status is 409 and `current` is the whole animal as it is now. A refused `PUT` writes nothing, including no weighing. An empty value is treated as not given; anything that is not an ISO 8601 date-time returns 400 `Invalid expectedUpdatedAt`. An animal that no longer exists, or is not yours, is 404 `Cattle not found` as usual (never 409, and never with `current`). A duplicate cow number is still 409 `Duplicate cow number`, without `code` or `current`. Timestamps are compared to the millisecond, which is what the JSON carries.

**`weightDate`** (already described above) is how a replayed change keeps its date: the browser sends the user's local date on the day the change was made, so the weighing is dated then, not on the day it synced.

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

## Breedings and pregnancy checks (sign-in required)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/breedings` | Every breeding in your herd, newest breeding date first |
| GET | `/api/breedings/needs-check` | Cows that need a pregnancy check (below). Optional `today` (`YYYY-MM-DD`, the caller's local date; default the server's UTC date) |
| GET | `/api/cattle/:cattleId/breedings` | One animal's breedings, newest first; 404 `Cattle not found` if the animal is not yours |
| POST | `/api/cattle/:cattleId/breedings` | Records a breeding; 201. 404 if the animal is not yours; 400 if it is male |
| PUT | `/api/breedings/:id` | Replaces the breeding's fields (fields left out are cleared); 404 `Breeding record not found` if not yours. The animal cannot be changed |
| DELETE | `/api/breedings/:id` | Deletes the breeding; 404 if not yours. Its checks are kept, with `breedingId` set to `null` |
| GET | `/api/pregnancy-checks` | Every check in your herd, newest check date first |
| GET | `/api/cattle/:cattleId/pregnancy-checks` | One animal's checks, newest first; 404 `Cattle not found` if the animal is not yours |
| POST | `/api/cattle/:cattleId/pregnancy-checks` | Records a check; 201. 404 if the animal is not yours; 400 if it is male |
| PUT | `/api/pregnancy-checks/:id` | Replaces the check's fields; 404 `Pregnancy check not found` if not yours |
| DELETE | `/api/pregnancy-checks/:id` | Deletes the check; 404 if not yours |

Breeding fields: `breedingDate` (required, ISO 8601, not in the future), `method` (`ai` or `natural`), `sire` (free text, max 100), `sireCattleId` (the id of one of **your** animals recorded as `male`; anything else returns 400 `Choose a bull from your herd`), `technician` (max 100), `notes` (max 2000). With `sireCattleId`, `sire` is ignored and saved as the bull's number and name, so the breeding still names him after he is deleted (deleting the bull sets `sireCattleId` to `null`).

Each breeding is returned as `{ id, cattleId, cattleTag, cattleName, breedingDate, method, sire, sireCattleId, sireTag, sireName, technician, notes, expectedCalvingDate, checkResult, checkDate, createdAt }`. `sireTag` and `sireName` are the linked bull's current details (`""` without one). `expectedCalvingDate` is `breedingDate` + 283 days. `checkResult` and `checkDate` are from the newest check linked to this breeding (`""` without one). A `PUT` that would put the breeding after one of its linked checks returns 400.

Check fields: `checkDate` (required, ISO 8601, not in the future), `result` (required: `pregnant`, `open`, `unsure`), `method` (`palpation`, `ultrasound`, `blood_test`, `other`), `breedingId` (optional, one of **this animal's** breedings dated on or before the check; otherwise 400 `Unknown breeding record` or `The check date cannot be before the breeding date`), `notes` (max 2000). Each check is returned as `{ id, cattleId, cattleTag, cattleName, checkDate, result, method, breedingId, breedingDate, notes, createdAt }`.

### Expected calving date and health status

These run in the same transaction as the change (`lib/breeding.js`). The cow's *current breeding* is her newest breeding dated after her last calving; the date it *implies* is its date + 283 days, or none when the newest check since it is `open`.

- `POST` of a breeding that becomes the current breeding sets `expectedCalvingDate` to the implied date.
- `PUT`/`DELETE` of a breeding, `DELETE` of a check, and an `unsure` check move `expectedCalvingDate` from the old implied date to the new one, only while it still equals the old one (a date set by hand through `PUT /api/cattle/:id` is kept).
- `POST`/`PUT` of the cow's newest check, dated on or after her current breeding and after her last calving: `pregnant` changes `healthStatus` `healthy` to `pregnant` and fills an empty `expectedCalvingDate` with the implied date; `open` clears `expectedCalvingDate` and changes `pregnant` to `healthy`. Other statuses are not changed. Deleting a check never changes `healthStatus`.
- A calving recorded with `clearExpected: true` clears the date and Pregnant; the breeding before it is no longer current, so later breeding edits leave the date empty.

### Needs check

```json
{ "today": "2026-06-01", "checkAfterDays": 35, "gestationDays": 283,
  "cows": [{ "...breeding fields": "", "daysSinceBreeding": 92 }] }
```

One entry per cow whose current breeding is more than `checkAfterDays` days before `today` and has no check dated on or after it, oldest breeding first. Each entry is that breeding (fields as above) plus `daysSinceBreeding`.

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

## Treatments (sign-in required)

Medical records: treatments, vaccinations and vet visits.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/treatments` | Every treatment in your herd, newest date given first |
| GET | `/api/treatments/due` | Open follow-ups (see below), soonest next due date first, overdue ones included. Optional `until=YYYY-MM-DD` keeps those due on or before that date (400 `Enter a valid date` if malformed) |
| GET | `/api/cattle/:cattleId/treatments` | One animal's treatments, newest first; 404 `Cattle not found` if the animal is not yours |
| POST | `/api/cattle/:cattleId/treatments` | Records a treatment; 201. 404 if the animal is not yours |
| PUT | `/api/treatments/:id` | Replaces the treatment's fields (fields left out are cleared); 404 `Treatment not found` if not yours. The animal cannot be changed |
| DELETE | `/api/treatments/:id` | Deletes the treatment; 404 if not yours |

Fields: `dateGiven` (required, ISO 8601, not in the future), `type` (required: `treatment`, `vaccination`, `vet_visit`, `other`), `product` (max 100), `dose` (max 50), `route` (max 50), `givenBy` (max 100), `nextDueDate` (ISO 8601, after `dateGiven`), `withdrawalUntil` (ISO 8601, on or after `dateGiven`), `notes` (max 2000). Text is trimmed. Everything but the date and type is optional and comes back as `""` when not recorded.

Each treatment is returned as `{ id, cattleId, cattleTag, cattleName, dateGiven, type, product, dose, route, givenBy, nextDueDate, withdrawalUntil, notes, createdAt }`.

**Follow-ups.** A treatment with a `nextDueDate` is open until a later treatment of the same animal, the same `type` and the same `product` (ignoring case and surrounding spaces) is recorded; "later" means a later `dateGiven`, or the same date entered afterwards. Recording the follow-up therefore closes the earlier one without changing it, and deleting the follow-up reopens it. Clearing `nextDueDate` dismisses a follow-up. The server does not decide what is overdue: the browser compares `nextDueDate` with the user's own calendar date.

**Withdrawal.** After every create, update and delete, the animal's `withdrawalUntil` is set to the latest `withdrawalUntil` of its treatments (empty when none has one), in the same transaction. The app treats an animal as in a withdrawal period while that date is today or later. Deleting an animal deletes its treatments.

## Reports (`/api/reports`, sign-in required)

Read-only summaries of the signed-in user's records. Each request is computed in SQL inside one read-only snapshot, so the parts of a report always agree.

| Method | Path | Purpose |
|---|---|---|
| GET | `/performance` | Herd size, calvings, calving rate and interval, daily gain, conception rate |
| GET | `/health` | Treatments by type and month, and the animals needing attention today |

Both take the same optional query parameters:

- `from`, `to`: `YYYY-MM-DD`, inclusive. They select the events of the period. Leave one or both out for an open end. An invalid date, or `from` after `to`, returns 400.
- `today`: the caller's local calendar date (`YYYY-MM-DD`). It decides what "now" is (withdrawal periods, overdue follow-ups, the last month of the herd series). It defaults to the server's UTC date; the app always sends it.

Counts are integers. Rates and averages are JSON numbers rounded by the database (percentages, days and birth weights to one decimal, lbs per day to two); a rate or average with nothing to measure is `null`. The answer echoes `from`, `to` (`null` when not given) and `today`.

### Performance

```json
{
  "from": "2026-01-01", "to": "2026-06-30", "today": "2026-06-15",
  "herd": { "size": 6, "females": 4, "males": 1,
            "byMonth": [{ "month": "2026-06", "asOf": "2026-06-15", "added": 1, "size": 6 }] },
  "calvings": { "count": 3, "cows": 2,
                "byOutcome": { "alive": 2, "stillborn": 1, "unknown": 0 },
                "byEase": { "unassisted": 2, "assisted": 0, "caesarean": 1, "unknown": 0 },
                "birthWeights": 2, "averageBirthWeight": 77.5,
                "breedingAgeMonths": 15, "breedingFemales": 4, "cowsCalved": 2, "calvingRate": 50 },
  "calvingInterval": { "intervals": 2, "cows": 2, "averageDays": 345, "minDays": 315, "maxDays": 375 },
  "dailyGain": { "animals": 3, "herdAverage": 1,
                 "byGroup": [{ "group": "female", "animals": 1, "average": 1.5 }],
                 "byAnimal": [{ "cattleId": "…", "cattleTag": "A-1", "cattleName": "Daisy", "group": "female",
                                "firstDate": "2026-01-10", "firstWeight": 1000, "lastDate": "2026-04-20", "lastWeight": 1150,
                                "weighings": 3, "days": 100, "gain": 150, "dailyGain": 1.5 }] },
  "breeding": { "breedings": 4, "checked": 2, "pregnant": 1, "open": 1, "conceptionRate": 50 }
}
```

Definitions:

- **`herd.size`, `females`, `males`**: animals on record now. They do not depend on the period.
- **`herd.byMonth`**: one row per calendar month, from the month of `from` (or of the first animal, when `from` is not given) to the month of `to` or of `today`, whichever is earlier. `asOf` is the last day counted: the month's last day, or the end of the period or `today` in the final month. `size` is the number of animals on record now whose record had been created by `asOf`; `added` is how many were created in that month up to `asOf`. The creation time is read as a UTC date, but never later than `today`. **Limitations:** deleted animals are not tracked, so they are missing from every month; an animal entered late counts from the day it was entered, not from when it arrived. At most the newest 120 months are returned. The series is empty when the period starts after `today`, or when there are no animals and no `from`.
- **`calvings.count`**: calving records dated in the period (twins are two records). `cows` is how many different animals they belong to. `byOutcome` and `byEase` split `count`; `unknown` means the field was left empty. `averageBirthWeight` (lbs) averages the `birthWeights` records that have a weight.
- **`calvings.calvingRate`** = `cowsCalved` ÷ `breedingFemales` × 100. `breedingFemales` are the animals on record now that are not male and either have a calving dated on or before the end of the period, or are female and were at least `breedingAgeMonths` (15) months old at the end of the period; a female with no birth date counts. `cowsCalved` are those of them with a calving in the period, each counted once however long the period is. The end of the period is `to`, or `today` when `to` is later or not given. `null` when there are no breeding females.
- **`calvingInterval`**: for each calving date in the period, the days since the same cow's previous calving date (in or before the period). Calves born on the same day are one calving, and a cow's first calving has no interval. `averageDays` is the mean of those `intervals`; `cows` is how many cows they belong to.
- **`dailyGain.byAnimal`**: for each animal with weighings on at least two different dates in the period, the first and the last weighing in it (ties on a date go by entry order), `days` between them, `gain` = last − first (lbs) and `dailyGain` = gain ÷ days (lbs per day). Sorted by `dailyGain`, largest first. `group` is the animal's sex: `female`, `male` or `unknown`.
- **`dailyGain.herdAverage`** and **`byGroup[].average`**: the mean of the animals' daily gains (before rounding), each animal counting once whatever its weight or the length of its interval.
- **`breeding`**: `breedings` dated in the period. A breeding's result is the cow's newest `pregnant` or `open` check dated on or after the breeding and before her next breeding; `unsure` checks decide nothing, and the check's own `breedingId` link is not used. `checked` breedings have a result; `conceptionRate` = `pregnant` ÷ `checked` × 100, `null` when none is checked.

Weaning and sale weights are not recorded as such, so the report has no figures for them.

### Health

```json
{
  "from": null, "to": null, "today": "2026-06-15",
  "treatments": { "count": 6, "animals": 4,
                  "byType": [{ "type": "treatment", "count": 3, "animals": 2 }],
                  "byMonth": [{ "month": "2026-02", "treatment": 3, "vaccination": 0, "vet_visit": 1, "other": 0, "total": 4 }] },
  "herd": { "size": 6, "healthy": 3, "pregnant": 1, "underTreatment": 1, "quarantine": 1 },
  "underTreatment": [{ "cattleId": "…", "cattleTag": "A-2", "cattleName": "Bess", "medications": "Penicillin",
                       "lastTreatmentDate": "2026-02-20", "lastTreatmentType": "treatment", "lastTreatmentProduct": "Penicillin" }],
  "quarantine": [],
  "withdrawal": [{ "cattleId": "…", "cattleTag": "A-2", "cattleName": "Bess", "withdrawalUntil": "2026-06-20",
                   "daysLeft": 5, "product": "Penicillin", "dateGiven": "2026-02-20" }],
  "followUps": { "upcomingDays": 30,
                 "overdue": [{ "id": "…", "cattleId": "…", "cattleTag": "A-2", "cattleName": "Bess", "type": "treatment",
                               "product": "Penicillin", "dateGiven": "2026-02-20", "nextDueDate": "2026-06-10", "daysUntil": -5 }],
                 "upcoming": [] }
}
```

Definitions:

- **`treatments`** covers the period: `count` is the treatments dated in it and `animals` the different animals treated. `byType` always lists the four types in a fixed order, with zeros. `byMonth` lists only months that have treatments, oldest first.
- Everything else describes the herd on `today` and does not depend on the period.
- **`herd`**: animals on record by health status.
- **`underTreatment`**, **`quarantine`**: the animals with that status, by cow number, each with the `medications` text of its record and its newest treatment (`lastTreatmentDate` is `null` when it has none).
- **`withdrawal`**: animals whose `withdrawalUntil` is `today` or later (the last day counts), the one ending first at the top. `daysLeft` is 0 on the last day. `product` and `dateGiven` are those of the newest treatment that set the date.
- **`followUps`**: open follow-ups, by the same rule as `GET /api/treatments/due` (one shared SQL condition). `overdue` holds every one with `nextDueDate` before `today`; `upcoming` those due from `today` to `upcomingDays` (30) days ahead. `daysUntil` is negative when overdue. Sorted by `nextDueDate`.
