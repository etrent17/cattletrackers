# 09 · Breeding records

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/breeding-records` | 2 | In review | agent | 07 (pattern) |

## Goal
Breedings and pregnancy checks are recorded, and the expected calving date is calculated from them.

## Background
Today Breeding History is a filter for pregnant cows or cows with an expected calving date. The expected date is typed by hand.

## Tasks
- [x] Table `breeding_events`: id, cattle_id, owner_id, date, method (AI, natural), sire (free text, or a link to a bull in the herd), technician, notes
- [x] Table or columns for pregnancy checks: date, result (pregnant, open, unsure), method, notes
- [x] Expected calving = breeding date + 283 days (setting), filled in automatically, editable
- [x] Pregnancy check result updates health status to Pregnant (or clears it)
- [x] Breeding History page: table, plus a list of cows bred but not yet checked
- [x] Cow details modal: breeding tab
- [x] Sire picker lists the herd's bulls

## Acceptance
- [x] Recording a breeding fills the expected calving date
- [x] A positive pregnancy check marks the cow Pregnant
- [x] Cows bred more than 35 days ago without a check appear in the "needs check" list
- [x] Owner isolation holds

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Added `breeding_events` and `pregnancy_checks` (separate table: several checks per breeding, or a check with no breeding on record; optional `breeding_id`, set to null when the breeding is deleted), `routes/breedings.js` and `routes/pregnancy-checks.js` (each `{ forCattle, router }`), `GET /api/breedings/needs-check?today=`, rules in `lib/breeding.js`, the Breeding History page (needs-check list, breedings and checks tables, search), the Breeding tab in the cow details, and the two forms. Sire: a herd bull (`sire_cattle_id`, male, same owner, ON DELETE SET NULL; his number and name are copied into `sire`) or free text. Decisions: expected calving = breeding date + 283 days (`GESTATION_DAYS` constant, sent to the app with the needs-check list; not a user setting). A new current breeding (newest after last calving) sets the expected date, replacing a typed one; edits and deletes move it only while it still equals the date the records implied, so a date typed on the cattle form is kept. The cow's newest check: pregnant turns Healthy into Pregnant and fills an empty date; open clears the date and turns Pregnant into Healthy; unsure changes nothing; Under Treatment / In Quarantine are never overwritten; deleting a check never changes the status. Calving `clearExpected` still clears both, and the breeding before the calving no longer counts. Needs check: current breeding more than 35 days before today, no check dated on or after it. Demo: 5 breedings, 4 checks; three cows' demo calving dates moved back so every breeding falls after her last calving and 283 days before her expected date. |
| 2026-11-21 | agent | Verified: `npm test` 455 tests (454 pass, 1 earlier todo), of which 53 in `test/api/breedings.test.js`, 43 in `test/api/pregnancy-checks.test.js` and 18 unit tests; `npm run test:e2e` 65 pass (13 new in `e2e/breeding.e2e.js`). Page, forms and tab checked in screenshots with the demo herd at desktop and phone width. |
| 2026-11-21 | Claude (lead) | Decision, delegated by the project owner: a positive pregnancy check changes Healthy to Pregnant but does not overwrite Under Treatment or In Quarantine, so a health flag is never hidden. The pregnancy and expected calving date are still recorded. Kept as built. |
