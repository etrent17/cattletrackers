# 07 · Calving records

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/calving-records` | 2 | In review | agent | 01, 02 |

## Goal
Each cow has a dated history of calvings, and the Calving Records page shows that history instead of a filtered cattle list.

## Background
Today a cow has a single `last_calving_date` and `expected_calving_date`. The Calving page is a filter over the cattle list. This branch sets the pattern (table, nested API, page, tab in the details modal) that 08, 09, and 10 copy.

## Tasks
- [x] Table `calving_events`: id, cattle_id (cascade), owner_id, calving_date, calf_sex, calf_tag, birth_weight, ease (unassisted, assisted, caesarean), outcome (alive, stillborn), notes, created_at
- [x] API: `GET/POST /api/cattle/:id/calvings`, `PUT/DELETE /api/calvings/:id`, `GET /api/calvings` (whole herd); owner checks on every route
- [x] Keep `last_calving_date` in sync (most recent event), or derive it in the cattle query
- [x] Option on save: "Add the calf as a new animal", prefilling its birth date and sex
- [x] Calving Records page: herd-wide table sorted by date, with filters; upcoming expected calvings at the top
- [x] Cow details modal: calving history tab
- [x] Migration: turn existing `last_calving_date` values into one event each
- [x] Write down the pattern (in the architecture doc) for 08 to 10 to follow

## Acceptance
- [x] Recording a calving appears on the Calving page and in the cow's details
- [x] The cow's last calving date updates
- [x] "Add calf" creates a new cattle record
- [x] Another user's calving events are never visible or editable
- [x] Existing data survives the migration

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Added the `calving_events` table, the calving API (`routes/calvings.js`), the Calving Records page, the Calving history tab in the cow details, and the record/edit form with "Add the calf as a new animal". Decision: `last_calving_date` stays as a column and is set to the newest event in the same transaction as every event change; a date typed for a new cow becomes her first event, and the field is read-only when editing. Extra: optional "clear her expected calving date" when recording. Demo herd has 9 sample calvings. Pattern for 08 to 10 is in `docs/architecture-and-data.md` ("Event records pattern"). |
| 2026-11-21 | agent | Verified: `npm test` 240 tests (239 pass, 1 earlier todo), of which 63 calving API tests and 25 unit tests; `npm run test:e2e` 24 pass (15 new in `e2e/calving.e2e.js`). Migration checked on a database created by the integration-branch code with two cows that had a last calving date: one event each after the first start, still two after two more restarts. Page, form and tab also checked in screenshots at desktop and phone width with the demo herd. |
