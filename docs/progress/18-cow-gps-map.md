# 18 · Cow GPS map

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/cow-gps-map` | 4 | In progress | | 01 |

## Goal
A map page shows the field, and each cow can have a GPS tracker added so its location appears on the map.

## Background
The app has no map or location data today. Cattle records live in PostgreSQL and are served by the REST API in `routes/`. New screens use plain Bootstrap until the design phase (15, 16).

## Decisions needed before starting
- [x] Map library: **Leaflet with OpenStreetMap tiles**, and Leaflet.draw for drawing boundaries. Tiles need a connection. The public OpenStreetMap tile server is fine for a prototype; before wide use, switch to a tile provider or host tiles, because the public server has a usage policy.
- [ ] How tracker positions arrive: entered by hand, pushed by the tracker vendor's service (webhook or API), or polled.
- [ ] Tracker data model: one tracker per cow, or a tracker that can move between cows; what to store (tracker id, last position, time of last fix, battery).
- [ ] Whether boundaries are saved to the account (next step) and whether parcel or landowner overlays are wanted later.
- [ ] How this interacts with offline use (feature 14 covers cattle records only).

## Tasks
- [x] Prototype: map page `public/map.html` with OpenStreetMap tiles (open it at `/map.html`; no link in the main menu yet)
- [x] Prototype: draw, edit and delete boundaries by hand; shows total acres; kept in this browser (localStorage)
- [x] CSP: allow OpenStreetMap tiles and the drawing toolbar icons (`img-src`)
- [ ] Save boundaries to the account (table, API, tests) so they follow the user to other devices
- [ ] Add a Map link to the main menu in `public/index.html`
- [ ] Add the map files to `urlsToCache` in `public/service-worker.js` if the page should load offline
- [ ] Database: table for trackers (linked to a cow and its owner) and for positions
- [ ] API: add, view, edit and remove a tracker for a cow; read the latest positions (document in `docs/api.md`)
- [ ] Show a marker for each tracked cow, with cow number and time of last fix
- [ ] Option on the cow record to add or remove a GPS tracker
- [ ] Handle cows with no tracker or no recent fix
- [ ] Tests: unit, API and a browser test (`e2e/gps-map.e2e.js`)
- [ ] Docs: `docs/user-guide.md`, `docs/architecture-and-data.md`, `docs/feature-inventory.md`, `docs/testing-checklist.md`, README

## Acceptance
- [ ] A user can open the map and see the field.
- [ ] A user can draw a boundary on the map, and it is still there after a reload.
- [ ] A tracker can be added to a cow and the cow appears on the map.
- [ ] A tracker can be removed, and the cow leaves the map.
- [ ] One user never sees another user's cows or trackers.

## Notes
- Update only this sheet on this branch. The Status column in `docs/roadmap.md` is changed on `main` when the branch is merged.
- The map prototype is built on `prototype/map-boundary` and merged into this branch by pull request.
- Boundaries drawn by hand are approximate and not a legal survey.

## Not verified
- The prototype was written without running it: the page has not been opened in a browser and `npm test` has not been run on it.

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | | Branch created from `main`. Row 18 added to the roadmap. |
| 2026-11-21 | | Prototype map page with hand-drawn boundaries (browser storage only), on `prototype/map-boundary`. |
