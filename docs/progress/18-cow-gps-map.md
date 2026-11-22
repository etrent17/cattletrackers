# 18 · Cow GPS map

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/cow-gps-map` | 4 | Not started | | 01 |

## Goal
A map page shows the field, and each cow can have a GPS tracker added so its location appears on the map.

## Background
The app has no map or location data today. Cattle records live in PostgreSQL and are served by the REST API in `routes/`. New screens use plain Bootstrap until the design phase (15, 16).

## Decisions needed before starting
- [ ] Map library (for example Leaflet with OpenStreetMap tiles, or Mapbox) and whether tiles must work offline.
- [ ] How tracker positions arrive: entered by hand, pushed by the tracker vendor's service (webhook or API), or polled.
- [ ] Tracker data model: one tracker per cow, or a tracker that can move between cows; what to store (tracker id, last position, time of last fix, battery).
- [ ] Whether the map needs field boundaries (drawn pasture outlines) in the first version.
- [ ] How this interacts with offline use (feature 14 covers cattle records only).

## Tasks
- [ ] Database: table for trackers (linked to a cow and its owner) and for positions
- [ ] API: add, view, edit and remove a tracker for a cow; read the latest positions (document in `docs/api.md`)
- [ ] Map page: show the field and a marker for each tracked cow, with cow number and time of last fix
- [ ] Option on the cow record to add or remove a GPS tracker
- [ ] Handle cows with no tracker or no recent fix
- [ ] Add every new browser module to `urlsToCache` in `public/service-worker.js`
- [ ] Tests: unit, API and a browser test (`e2e/gps-map.e2e.js`)
- [ ] Docs: `docs/user-guide.md`, `docs/architecture-and-data.md`, `docs/feature-inventory.md`, `docs/testing-checklist.md`, README

## Acceptance
- [ ] A user can open the map and see the field.
- [ ] A tracker can be added to a cow and the cow appears on the map.
- [ ] A tracker can be removed, and the cow leaves the map.
- [ ] One user never sees another user's cows or trackers.

## Notes
- Update only this sheet on this branch. The Status column in `docs/roadmap.md` is changed on `main` when the branch is merged.

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | | Branch created from `main`. Row 18 added to the roadmap. |
