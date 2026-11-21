# 10 · Weight tracking

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/weight-tracking` | 2 | Not started | — | 07 (pattern) |

## Goal
Each animal has a history of weighings, so growth can be tracked and reported.

## Background
Today `weight` is a single number that gets overwritten. Performance reports (12) need history.

## Tasks
- [ ] Table `weighings`: id, cattle_id, owner_id, date, weight, notes
- [ ] API following the 07 pattern
- [ ] The cattle record's weight shows the latest weighing
- [ ] Migration: turn existing weights into one weighing each, dated at the record's last update
- [ ] Quick "record weights" screen for entering several animals at once
- [ ] Cow details modal: weight history with a simple chart and average daily gain
- [ ] Decide units (lbs only, or a setting for kg)

## Acceptance
- [ ] Recording a weighing updates the current weight
- [ ] Average daily gain is correct between two weighings
- [ ] Batch entry saves every row, or reports which rows failed
- [ ] Owner isolation holds

## Progress log
| Date | Who | Note |
|---|---|---|
