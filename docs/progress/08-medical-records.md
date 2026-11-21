# 08 · Medical records

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/medical-records` | 2 | Not started | — | 07 (pattern) |

## Goal
Treatments, vaccinations, and vet visits are recorded with dates, and follow-up treatments can be scheduled. The dashboard's "Scheduled Treatments" counts real scheduled treatments.

## Background
Today there is one free-text `medications` field and a health status. "Scheduled Treatments" on the dashboard counts animals marked Under Treatment, which is a stand-in.

## Tasks
- [ ] Table `treatments`: id, cattle_id, owner_id, date_given, type (treatment, vaccination, vet visit, other), product, dose, route, given_by, next_due_date, withdrawal_until, notes
- [ ] API following the 07 pattern
- [ ] Medical Records page: history table plus an "Upcoming and overdue" list
- [ ] Dashboard: Scheduled Treatments counts treatments due in the next 7 days; alerts for overdue treatments
- [ ] Withdrawal period: flag animals whose meat/milk withdrawal period is still running
- [ ] Cow details modal: treatment history tab
- [ ] Decide what happens to the free-text `medications` field (keep as "current medications", or derive it)

## Acceptance
- [ ] Recording a treatment with a next-due date makes it appear under Upcoming
- [ ] Overdue treatments show as dashboard alerts
- [ ] Animals within a withdrawal period are clearly marked
- [ ] Owner isolation holds

## Progress log
| Date | Who | Note |
|---|---|---|
