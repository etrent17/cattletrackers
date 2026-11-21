# 09 · Breeding records

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/breeding-records` | 2 | Not started | — | 07 (pattern) |

## Goal
Breedings and pregnancy checks are recorded, and the expected calving date is calculated from them.

## Background
Today Breeding History is a filter for pregnant cows or cows with an expected calving date. The expected date is typed by hand.

## Tasks
- [ ] Table `breeding_events`: id, cattle_id, owner_id, date, method (AI, natural), sire (free text, or a link to a bull in the herd), technician, notes
- [ ] Table or columns for pregnancy checks: date, result (pregnant, open, unsure), method, notes
- [ ] Expected calving = breeding date + 283 days (setting), filled in automatically, editable
- [ ] Pregnancy check result updates health status to Pregnant (or clears it)
- [ ] Breeding History page: table, plus a list of cows bred but not yet checked
- [ ] Cow details modal: breeding tab
- [ ] Sire picker lists the herd's bulls

## Acceptance
- [ ] Recording a breeding fills the expected calving date
- [ ] A positive pregnancy check marks the cow Pregnant
- [ ] Cows bred more than 35 days ago without a check appear in the "needs check" list
- [ ] Owner isolation holds

## Progress log
| Date | Who | Note |
|---|---|---|
