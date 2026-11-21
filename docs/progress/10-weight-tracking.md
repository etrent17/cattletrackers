# 10 · Weight tracking

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/weight-tracking` | 2 | In review | agent | 07 (pattern) |

## Goal
Each animal has a history of weighings, so growth can be tracked and reported.

## Background
Today `weight` is a single number that gets overwritten. Performance reports (12) need history.

## Tasks
- [x] Table `weighings`: id, cattle_id, owner_id, date, weight, notes
- [x] API following the 07 pattern
- [x] The cattle record's weight shows the latest weighing
- [x] Migration: turn existing weights into one weighing each, dated at the record's last update
- [x] Quick "record weights" screen for entering several animals at once
- [x] Cow details modal: weight history with a simple chart and average daily gain
- [x] Decide units (lbs only, or a setting for kg)

## Acceptance
- [x] Recording a weighing updates the current weight
- [x] Average daily gain is correct between two weighings
- [x] Batch entry saves every row, or reports which rows failed
- [x] Owner isolation holds

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Added the `weighings` table (`db.js` `weighingSchema()`), `routes/weighings.js` (`/api/cattle/:cattleId/weighings`, `/api/weighings`, `POST /api/weighings/batch`), shared helpers in `lib/weights.js`, the Weights page (batch entry and herd-wide history with change and ADG since the previous weighing), the Weight history tab in the cow details (inline SVG chart, ADG first to last and between consecutive weighings) and a record/edit form. Demo herd has 3 or 4 weighings per animal. |
| 2026-11-21 | agent | Decisions. **Current weight**: `cattle.weight` stays a column, set to the newest weighing (date, then created_at) in the same transaction as every change, like `last_calving_date`. **Cattle form**: the weight field stays editable; on a new animal it becomes the first weighing, and on edit a *changed* weight becomes a new weighing dated today (the user's local date, sent as `weightDate`), while the same or a blank weight records nothing. Chosen over a read-only field because updating a weight is the most common edit; history is never rewritten from the form. A calf added with a calving gets its birth weight as a weighing on the calving date. **Batch**: per-row results, not all-or-nothing: valid rows are saved together in one transaction, invalid rows (bad weight, no or unknown animal, another user's animal, the same animal twice) are reported by position and stay in the form with the reason, so one typo does not lose a weigh day. **Units**: lbs only; a kg display setting is left for later (store lbs, convert on display). |
| 2026-11-21 | agent | Fixed the known bug: `POST`/`PUT /api/cattle` accepted `weight: 0`. The `todo` test is now a normal passing test, plus tests for `"0"`, values that round to 0, booleans, and `""`/`null` still meaning no weight. Stored zeros are cleared at startup (they are not weights). Entry added under Resolved in `docs/known-issues.md`. |
| 2026-11-21 | agent | Verified: `npm test` 424 pass, 0 todo (62 in `test/api/weighings.test.js`, 18 in `test/unit/weight-service.test.mjs`); `npm run test:e2e` 66 pass (14 in `e2e/weight.e2e.js`: batch entry with failed rows, current weight and ADG in the details, record from the details, edit, delete, cattle form, markup shown as text). Migration checked on a database created by the integration-branch code with four animals (weights 1200 with an older `updated_at`, 0, none, 850.5): after the first start 1200 and 850.5 had one weighing each, dated at their `updated_at`, and the 0 was cleared; still the same after a restart. Page, batch errors and tab checked in screenshots at desktop and phone width with the demo herd. |
