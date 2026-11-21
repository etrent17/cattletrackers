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
  app.js             startup (also from the saved copy when offline), sign-out, service worker registration
  auth.js            login page logic
  controllers/       CattleController, CalvingController, UsersController, FinanceController (financial pages), ReportsController (performance and health reports), SyncController (offline banner, replay, unsynced changes)
  services/          CattleService (API calls and statistics), AccountService (password change), CalvingService, FinanceService, OfflineStore (IndexedDB), SyncEngine (outbox and replay)
  views/             DashboardView, ListView, FormView, SettingsView, UsersView, CalvingView, FinanceView, SyncView
  models/ utils/     Cattle model, validators, date helpers, escapeHtml, feedback, money (cents), csv, connectivity (online/offline state)
test/                unit tests (unit/), API tests (api/), shared setup (helpers/)
e2e/                 browser tests (Playwright): smoke test, one file per feature; shared setup in helpers.js and helpers/
```

## Request flow

Browser view or controller, then `CattleService`, then `/api/cattle`, then the route handler, then PostgreSQL. After a change the controller refreshes its views from the in-memory list. When the server can't be reached, cattle reads come from the copy saved in the browser and cattle writes go to an outbox; see "Offline editing" below.

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

`public/service-worker.js` keeps the app shell so the page opens without a connection: every file in `urlsToCache` (fetched when the worker installs; network first, cache as fallback) and the three CDN files `index.html` needs (Bootstrap's stylesheet and script, Font Awesome's stylesheet; cache first, since their URLs carry a version). The worker fetches the CDN files itself, and a worker's `fetch()` is checked against the `connect-src` directive of the content security policy, so `app.js` lists both CDNs there. Without that entry every CDN request from a page the worker controls fails, online too; `e2e/offline.e2e.js` runs the real worker against a local stand-in for the CDNs to catch this.

Requests to `/api/` are never intercepted and no API answer is ever put in the worker's cache. Cattle data kept for offline use lives in IndexedDB (next section). Nothing is stored in `localStorage`. A service worker only runs on HTTPS or `localhost`. The System Settings screen describes offline behaviour to users.

## Offline editing

Scope: **cattle records only.** The dashboard, the cattle list and a cow's Details tab work from a saved copy, and cattle can be added, edited and deleted. Event records (calvings, weighings, treatments, breedings, transactions), reports, user management and the password form are online-only: while offline `CattleController.switchView` shows the `#view-needs-connection` section instead of the page (so none of its buttons can be reached and nothing is fetched), the cow details dialog shows only its Details tab, and the password form is disabled.

Conflict rule: **the server wins, and no change is dropped silently.**

**Connectivity** (`src/utils/connectivity.js`). "Online" means `navigator.onLine` is true *and* the last API request got an answer. `CattleService.api()` reports every request; a network error or a 502/503/504 counts as unreachable. `app.js` wires the top-bar indicator to this before anything else, so it is right even when startup stops early (it used to say Online when the app started offline).

**The saved copy** (`src/services/OfflineStore.js`). One IndexedDB database (`cattle-trackers-offline`) with one record:

| Field | Holds |
|---|---|
| `user` | the account the copy belongs to (`id`, `email`, `role`, `isDemo`) |
| `herd`, `herdSavedAt` | the rows of the last successful `GET /api/cattle`, kept current after every accepted change; when they were last written |
| `outbox` | changes not yet accepted by the server, oldest first |
| `unsynced` | changes the server refused, each with the reason and the server's row, until the user re-applies or discards it |
| `nextSeq` | counter for outbox and unsynced keys |

Every change to it is one read-modify-write inside a single IndexedDB transaction (`store.update(fn)`), so a change is never half-moved (out of the outbox but not yet in `unsynced`) and two tabs cannot overwrite each other. The herd shown on screen is always `applyOutbox(herd, outbox)`: the server's rows with the queued changes laid on top (rows touched carry `pendingSync`). Removing an entry from the outbox therefore puts the server's version back on screen by itself. Where IndexedDB is unavailable the store is in memory and nothing is ever queued; the app then behaves as it did before this feature.

**Writes** (`CattleService.write`). Online with an empty outbox, a change goes straight to the server as before (no `expectedUpdatedAt`: two online tabs still overwrite each other, last write wins), and the answer updates the saved herd. It is queued instead when the app is offline, when the request gets no answer, or when older changes are still queued (so order is kept). New animals always get their id in the browser (`newUuid`), online too, so a create whose answer was lost can be sent again.

**An outbox entry** holds `type` (create, edit, delete), `cattleId`, `data` (the form's fields), `expectedUpdatedAt` (the saved row's `updatedAt` when the change was made), `weightDate` (the user's local date when the change was made; this is what dates the weighing, not the day of the sync), `queuedAt`, and counters. Deleting an animal that was added offline and never sent just removes its entries.

**Replay** (`SyncEngine.replay`) runs when the browser reports a connection, at startup, right after a change is queued, on **Sync now**, and on a timer while something is waiting (a few quick tries after a failure, then every 30 seconds). It first asks `/api/auth/status` whose session this is and sends nothing unless it is the account the outbox belongs to. Then it sends entries oldest first, one at a time (a Web Lock keeps other tabs from replaying at the same moment):

| The server's answer | What happens |
|---|---|
| Accepted | The entry leaves the outbox and the saved row becomes the server's. Later entries for the same animal are rebased onto the new `updatedAt` |
| No answer: network error, 502/503/504, 401, 408, 429 | Replay **stops**. This entry and all later ones stay queued, in order |
| Refused: 409 `stale` (changed elsewhere), duplicate cow number, validation, 404 (deleted elsewhere), demo limit, id not available | The server's version stands. The entry moves to `unsynced` with the reason, together with later entries for the same animal (they were made on top of it). Replay **continues** with other animals |
| Server error (500) | Treated as no answer twice, refused on the third attempt, so one bad record cannot block the queue for good |

Two answers are recognised as success although they look like failures, because a request can reach the server and lose its answer: a `DELETE` that gets 404 (already gone), and an edit that gets 409 `stale` while the server's row already holds every value the edit asked for. A repeated create is handled by the server (same id, same owner: 200).

**Unsynced changes** are shown in the banner and in a dialog (`SyncController`, `SyncView`): what the user changed, the server's value beside it, why it was refused, and Apply again or Discard. Apply again goes through the normal form and write path as a new change (keeping the original `weightDate`); the entry is removed only after that change is saved or queued.

**Accounts and privacy.** Signing out clears the record (after a warning when the outbox or unsynced list is not empty). At startup, a copy that belongs to a different user id is cleared before anything is shown, and the user is told if unsent changes went with it. A session that merely expired keeps the copy, so the same user's queued changes survive signing in again. With no connection at startup the app runs as the saved `user` without checking the session; the first request after reconnecting does. The saved herd is not encrypted.

**Known limits.** An edit queued offline is compared with the server by `updatedAt` only, so any change to the animal in between counts as a conflict, even to a different field. A change made directly online carries no check. Calvings and other event records cannot be recorded offline.

Server side this needs three optional things on `/api/cattle` (see `docs/api.md`, "Offline changes"): a client `id` on create, and `expectedUpdatedAt` on update and delete.
