# Architecture and Data

## Layout

```
server.js            entry point: checks settings, prepares the database, listens
app.js               Express app (no listening): security headers, sessions, routing
db.js                PostgreSQL pool, schema creation, demo cleanup
routes/              auth.js, cattle.js, calvings.js, users.js, transactions.js
middleware/auth.js   requireAuth, requireAdmin, validate
lib/                 password.js, demo.js, records.js (helpers for event-record routes)
public/              index.html, login.html, CSS, service-worker.js
src/                 browser ES modules
  app.js             startup and sign-out
  auth.js            login page logic
  controllers/       CattleController, CalvingController, UsersController, FinanceController (financial pages)
  services/          CattleService (API calls and statistics), AccountService (password change), CalvingService, FinanceService
  views/             DashboardView, ListView, FormView, SettingsView, UsersView, CalvingView, FinanceView
  models/ utils/     Cattle model, validators, date helpers, escapeHtml, feedback, money (cents), csv
test/                unit tests (unit/), API tests (api/), shared setup (helpers/)
e2e/                 browser tests (Playwright): smoke test, one file per feature; shared setup in helpers.js and helpers/
```

## Request flow

Browser view or controller, then `CattleService`, then `/api/cattle`, then the route handler, then PostgreSQL. After a change the controller refreshes its views from the in-memory list.

Errors: `CattleService` errors carry the HTTP status (0 when the server is unreachable); a 401 sends the browser to the login page. A failed startup or herd load shows the error banner with Retry, and a failed action shows an error toast (`src/utils/feedback.js`). The app's event listeners are attached before data loads, so the page stays usable after a failure.

## Database

Created automatically at startup (`initSchema`).

**users**: `id`, `email` (unique), `password_hash`, `role` (admin or user), `created_at`, `is_demo`.

**cattle**: `id` (UUID), `owner_id` (users, cascade delete), `tag_number`, `name_breed`, `gender`, `birth_date`, `weight`, `last_calving_date`, `expected_calving_date`, `medications`, `health_status`, `notes`, `created_at`, `updated_at`. A unique index on owner and lower-cased tag number prevents duplicates.

**calving_events**: `id` (UUID), `cattle_id` (cattle, cascade delete), `owner_id` (users, cascade delete), `calving_date`, `calf_sex`, `calf_tag`, `birth_weight`, `ease` (unassisted, assisted, caesarean), `outcome` (alive, stillborn), `notes`, `created_at`. Only the date is required. Indexed by animal and by owner, each with the date.

`cattle.last_calving_date` is kept, not derived: it always equals the animal's newest calving event, or NULL when she has none. `routes/calvings.js` updates it in the same transaction as every event insert, update and delete. Keeping the column means the cattle list, dashboard and model read it as before without a join. To hold the rule, `POST /api/cattle` turns a typed last calving date into the first event, `PUT /api/cattle/:id` ignores the field, and the cattle form makes it read-only when editing. At startup, any animal that has a date but no events gets one event for it; this is how data from before calving events existed is carried over, and it cannot repeat because deleting an animal's last event also clears her date.

**breeding_events**: `id` (UUID), `cattle_id` (cattle, cascade delete), `owner_id` (users, cascade delete), `breeding_date`, `method` (ai, natural), `sire` (text), `sire_cattle_id` (cattle, set to null when that animal is deleted), `technician`, `notes`, `created_at`. Only the date is required. Indexed by animal and by owner, each with the date, and by sire. The API checks that `sire_cattle_id` is a male animal of the same owner, and copies the bull's number and name into `sire`.

**pregnancy_checks**: `id` (UUID), `cattle_id` (cattle, cascade delete), `owner_id` (users, cascade delete), `check_date`, `result` (pregnant, open, unsure; required), `method` (palpation, ultrasound, blood_test, other), `breeding_id` (breeding_events, set to null when the breeding is deleted), `notes`, `created_at`. Indexed by animal and by owner with the date, and by breeding. Checks are a table of their own rather than columns on a breeding: a cow can have several checks for one breeding (an early scan and a confirmation) or a check with no breeding on record (a bought-in cow), and each check keeps its own date and result.

`cattle.expected_calving_date` and `health_status` stay plain columns that the user can edit. The breeding routes update them in the same transaction as each breeding or check change, by the rules in `lib/breeding.js` (summarised in `docs/api.md`, "Breedings and pregnancy checks"): a new current breeding sets the expected date to breeding date + 283 days (`GESTATION_DAYS`, a constant rather than a setting); edits follow the records unless the date was changed by hand; the newest check marks a Healthy cow Pregnant or, when open, clears the date and Pregnant.

**weighings**: `id` (UUID), `cattle_id` (cattle, cascade delete), `owner_id` (users, cascade delete), `date`, `weight` (`NUMERIC(7,2)`, lbs, `CHECK (weight > 0)`; the API allows 0.01 to 5000), `notes`, `created_at`. Indexed by animal and by owner, each with the date.

`cattle.weight` is kept, not derived, the same way as `last_calving_date`: it always equals the animal's newest weighing (latest `date`, then latest `created_at`), or NULL when it has none. `syncWeight()` in `lib/weights.js` sets it in the same transaction as every weighing insert, update and delete (`routes/weighings.js`, and `routes/cattle.js` where a typed weight becomes a weighing). `POST /api/cattle` (and a calf added with a calving) turns a weight into the first weighing; `PUT /api/cattle/:id` records a weighing only when the weight changed. At startup, weights of 0 or less (stored by an old validation bug) are cleared, then any animal that has a weight but no weighings gets one weighing for it, dated at the record's `updated_at` (as a date in the database server's time zone). This carries over data from before weighings existed and cannot repeat, because deleting an animal's last weighing also clears its weight.

**treatments**: `id` (UUID), `cattle_id` (cattle, cascade delete), `owner_id` (users, cascade delete), `date_given`, `type` (treatment, vaccination, vet_visit, other), `product`, `dose`, `route`, `given_by`, `next_due_date` (after `date_given`), `withdrawal_until` (on or after `date_given`), `notes`, `created_at`. Only the date and type are required. Indexed by animal and by owner, each with the date given.

A treatment with a `next_due_date` is an open follow-up until a later treatment of the same animal, type and product (compared ignoring case and surrounding spaces) exists; ties on the date go to the one created later. `GET /api/treatments/due` finds them with a `NOT EXISTS` query, so recording a follow-up needs no flag and leaves the earlier record unchanged. Whether one is overdue is decided in the browser against the local date.

`cattle.withdrawal_until` (added by the treatments schema) is kept, not derived on read: it always equals the latest `withdrawal_until` of the animal's treatments, or NULL. `routes/treatments.js` updates it in the same transaction as every treatment insert, update and delete, so the cattle list, dashboard and details can mark animals in a withdrawal period without a join. The cattle routes return it as `withdrawalUntil` and never write it. `cattle.medications` stays a free-text "current medications" note typed on the cattle form; it is not derived from treatments.

**transactions**: `id` (UUID), `owner_id` (users, cascade delete), `date`, `kind` (`income` or `expense`), `category` (1 to 50 characters), `amount` (`NUMERIC(12,2)`, greater than 0), `cattle_id` (cattle, optional, set to null when the animal is deleted), `description`, `created_at`, `updated_at`. Indexed on owner and date. The API checks that `cattle_id` belongs to the same owner. Amounts are returned as decimal strings.

**session**: managed by `connect-pg-simple`.

Date columns are returned as `YYYY-MM-DD` strings. The API uses camelCase names (`tagNumber`) while the database uses snake_case.

## Event records pattern

Calving records are the model for every dated record that belongs to an animal (treatments, breedings, weights). Copy the calving files and keep these conventions. Below, `records` stands for the plural name (`calvings`) and `Record` for the singular (`Calving`).

**Table** (`db.js`)

- One function per feature (`calvingSchema()`), in its own delimited block, called from `initSchema()`. Adding a feature adds one function and one line.
- Columns: `id UUID` primary key, `cattle_id UUID NOT NULL REFERENCES cattle(id) ON DELETE CASCADE`, `owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`, the event date as `DATE NOT NULL`, the feature's fields, `created_at`. Use `CHECK` for fixed lists. Optional fields are nullable; do not default a value nobody entered.
- Indexes on `(cattle_id, <date> DESC)` and `(owner_id, <date> DESC)`.
- Everything must be safe to run on every start: `CREATE ... IF NOT EXISTS`, and a data migration only behind a guard that is false once it has run.
- `test/helpers/api.js` empties tables with `TRUNCATE ... CASCADE` from `cattle` and `users`, so a table that references them needs no change there.

**API** (`routes/<records>.js`, mounted in `app.js`)

- The file exports two routers: `forCattle`, mounted at `/api/cattle/:cattleId/<records>` (GET one animal's history, POST a new event), and `router`, mounted at `/api/<records>` (GET the whole herd, `PUT /:id`, `DELETE /:id`). Mount `forCattle` before `/api/cattle`.
- Ownership on every route. Nested routes call `ownedCattle(db, cattleId, userId)` from `lib/records.js` and answer 404 `Cattle not found` when it returns nothing. Routes by event id filter on `id = $1 AND owner_id = $2` and answer 404 `<Record> not found`. `owner_id` and `cattle_id` are set from the session and the URL, never from the body. Another user's record is always a 404, never a 403.
- Validation with express-validator and `validate`, a message on every rule, `isoDate` for dates. `PUT` replaces all fields, like `PUT /api/cattle/:id`.
- Responses are camelCase through a `toApi` function. Events include `cattleId`, `cattleTag` and `cattleName` (joined from `cattle`), so a herd-wide list needs no second request. Lists are newest first.
- Anything that touches more than one row runs in `withTransaction()`. Take the animal's row lock first (`ownedCattle(..., { lock: true })`), and throw `httpError(status, message)` to roll back and answer. If the feature keeps a summary on `cattle` (as calvings keep `last_calving_date`), update it in that same transaction after every insert, update and delete.
- To create an animal from another route, call `createCattle()` from `routes/cattle.js` so the demo limit and duplicate-number rule apply.
- Add sample events to `lib/demo.js` so the page is not empty in demo mode.

**Front end**

- `src/services/<Record>Service.js`: the API calls (using `api` from `CattleService.js`, which gives errors a `status`) and pure, exported helpers for payloads, validation and filtering. No DOM.
- `src/views/<Record>View.js`: all HTML. Every record value goes through `escapeHtml()`.
- `src/controllers/<Record>Controller.js`: listeners and flow. It receives a `host` object from `CattleController` (`cattleService`, `reloadHerd()`, `openCowDetails(id, tabId)`) and has `init()`, `show()` (the page became visible: draw, fetch, draw), `hide()`, `render()` (redraw from memory) and `detailTab()`.
- In `CattleController`, a feature adds its controller to `recordPages` under its view name. That one entry routes the sidebar link to the section `#view-<name>`, and adds the feature's tab to the cow details modal. The tab is `{ id, label, appliesTo?(cow), render(cow, pane) }`; it is drawn the first time it is shown and fetches that animal's history each time.
- `public/index.html` gets the page section `#view-<name>` and the form modal. Give buttons feature-specific classes (`btn-calving-edit`), because `.btn-edit`, `.btn-view` and `.btn-delete` already mean the cattle actions; a `.btn-view` with a cattle id in `data-id` opens that cow's details from anywhere.
- Bootstrap shows one modal at a time. A form opened from the details modal closes it first and reopens it on the feature's tab when the form closes (see `CalvingController.openForm`).
- After any change, call `host.reloadHerd()` when the herd may have changed, then refetch the page.
- Add each new browser file to `urlsToCache` in `public/service-worker.js`.

**Tests**

- `test/api/<records>.test.js`: authentication on every route, create and read, validation (each rule, on create and update), update and delete, owner isolation on every route (another user and an admin, checking the owner's data is unchanged afterwards), cascade when the animal or user is deleted, and any summary kept on `cattle`.
- `test/unit/<record>-service.test.mjs`: the pure helpers and the request each API call sends.
- `e2e/<record>.e2e.js`: starts with `useBrowser()` from `e2e/helpers/browser.js`; record from the page and from the cow's details, see it in both places, edit, delete, and check that markup in user data is shown as text.

## Security configuration

Helmet sets a content security policy that allows scripts from the app and `cdn.jsdelivr.net`, and styles and fonts from jsdelivr and cdnjs. HSTS is disabled until HTTPS is in place. The server trusts one proxy hop.

## Rendering record fields

Always escape record fields in templates. Views build HTML with template strings and `innerHTML`, so every value that comes from a user or the API (cow number, name/breed, medications, notes, dates, ids, status labels) is wrapped in `escapeHtml()` from `src/utils/escapeHtml.js`, in element text and in quoted attribute values such as `data-id="${escapeHtml(c.id)}"`. Apply it to the final string, including any fallback: `${escapeHtml(c.nameBreed || "Unnamed")}`. Only fixed markup written in the template itself (icons, badges, `<br>`) stays unescaped. When a whole element holds one plain value, setting `textContent` (or an input's `value`) is simpler and needs no escaping. Never escape before saving: the API stores the text exactly as typed.

## Service worker

Caches static assets and serves them when the network fails. Requests to `/api/` are never intercepted, so cattle data is not available offline. Nothing is stored in `localStorage`. The System Settings screen describes this to users.
