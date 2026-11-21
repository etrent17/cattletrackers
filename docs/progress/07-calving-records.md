# 07 · Calving records

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/calving-records` | 2 | Not started | — | 01, 02 |

## Goal
Each cow has a dated history of calvings, and the Calving Records page shows that history instead of a filtered cattle list.

## Background
Today a cow has a single `last_calving_date` and `expected_calving_date`. The Calving page is a filter over the cattle list. This branch sets the pattern (table, nested API, page, tab in the details modal) that 08, 09, and 10 copy.

## Tasks
- [ ] Table `calving_events`: id, cattle_id (cascade), owner_id, calving_date, calf_sex, calf_tag, birth_weight, ease (unassisted, assisted, caesarean), outcome (alive, stillborn), notes, created_at
- [ ] API: `GET/POST /api/cattle/:id/calvings`, `PUT/DELETE /api/calvings/:id`, `GET /api/calvings` (whole herd); owner checks on every route
- [ ] Keep `last_calving_date` in sync (most recent event), or derive it in the cattle query
- [ ] Option on save: "Add the calf as a new animal", prefilling its birth date and sex
- [ ] Calving Records page: herd-wide table sorted by date, with filters; upcoming expected calvings at the top
- [ ] Cow details modal: calving history tab
- [ ] Migration: turn existing `last_calving_date` values into one event each
- [ ] Write down the pattern (in the architecture doc) for 08 to 10 to follow

## Acceptance
- [ ] Recording a calving appears on the Calving page and in the cow's details
- [ ] The cow's last calving date updates
- [ ] "Add calf" creates a new cattle record
- [ ] Another user's calving events are never visible or editable
- [ ] Existing data survives the migration

## Progress log
| Date | Who | Note |
|---|---|---|
