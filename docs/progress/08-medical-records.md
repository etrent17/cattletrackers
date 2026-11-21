# 08 · Medical records

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/medical-records` | 2 | In review | agent | 07 (pattern) |

## Goal
Treatments, vaccinations, and vet visits are recorded with dates, and follow-up treatments can be scheduled. The dashboard's "Scheduled Treatments" counts real scheduled treatments.

## Background
Today there is one free-text `medications` field and a health status. "Scheduled Treatments" on the dashboard counts animals marked Under Treatment, which is a stand-in.

## Tasks
- [x] Table `treatments`: id, cattle_id, owner_id, date_given, type (treatment, vaccination, vet visit, other), product, dose, route, given_by, next_due_date, withdrawal_until, notes
- [x] API following the 07 pattern
- [x] Medical Records page: history table plus an "Upcoming and overdue" list
- [x] Dashboard: Scheduled Treatments counts treatments due in the next 7 days; alerts for overdue treatments
- [x] Withdrawal period: flag animals whose meat/milk withdrawal period is still running
- [x] Cow details modal: treatment history tab
- [x] Decide what happens to the free-text `medications` field (keep as "current medications", or derive it)

## Acceptance
- [x] Recording a treatment with a next-due date makes it appear under Upcoming
- [x] Overdue treatments show as dashboard alerts
- [x] Animals within a withdrawal period are clearly marked
- [x] Owner isolation holds

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Added the `treatments` table, the treatments API (`routes/treatments.js`, including `GET /api/treatments/due` for open follow-ups), the Medical Records page (Upcoming and Overdue, Withdrawal Periods, history with search and type filter), the Treatments tab in the cow details, and the record/edit/follow-up form. Decisions: a follow-up is open until a later treatment of the same animal, type and product is recorded (no extra column; clearing the next due date dismisses it). Scheduled Treatments = open follow-ups due within 7 days, overdue included, labelled as such; overdue ones are dashboard alerts in a new Alerts list. `cattle.withdrawal_until` is kept equal to the latest withdrawal date of the animal's treatments (same transaction, like `last_calving_date`) and shown as a badge in the dashboard and cattle tables and the details. `cattle.medications` stays free-text "current medications" with a hint on the form. Demo herd has 11 sample treatments (one overdue, two due this week, two running withdrawals). |
| 2026-11-21 | agent | Verified: `npm test` 435 tests (434 pass, 1 earlier todo), of which 57 treatment API tests (auth, CRUD, every validation rule on create and update, owner isolation for another user and an admin on every route, cascade on animal and user delete, follow-up and withdrawal rules, demo data) and 37 unit tests with a frozen clock; `npm run test:e2e` 68 pass (16 new in `e2e/treatment.e2e.js`: a treatment with a next-due date appears under Upcoming and on the dashboard count; an overdue one becomes an alert; the follow-up clears it; withdrawal badge; markup shown as text). Schema upgrade checked by running the new code on a test database created by the integration-branch code. Pages, tab and form checked in screenshots at desktop and phone width with the demo herd; no sideways scroll at 390px. |
