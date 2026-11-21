# 15 · Apply Emil's design

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/emil-design` | 5 | Not started | — | 01 to 13 (everything functional) |

## Goal
The whole app, including the sign-in page, uses Emil's design.

## Background
Design is deliberately done after the app is functional, so screens are restyled once rather than repeatedly. The app currently uses stock Bootstrap 5 (`public/styles.css`, `public/login.css`). Older sign-in hero styles are in git history at `e8d97e1` (`git show e8d97e1:public/styles.css`), in case any of it is useful.

## Decisions needed before starting
- [ ] Where Emil's design lives (Figma, a design file, or a repo) and add the link here
- [ ] Keep Bootstrap underneath, or replace it

## Tasks
- [ ] Capture the design's colours, type, spacing, and components as CSS variables in one place
- [ ] Sign-in, setup, and demo screens
- [ ] App shell: navigation bar, sidebar, layout at phone width
- [ ] Dashboard: stat cards, tables, events and alerts
- [ ] Cattle list, filters, add/edit form, details modal
- [ ] Records pages (calving, medical, breeding, weights), financial pages, reports, settings, user management
- [ ] Toasts, empty states, loading and error states
- [ ] Any new external fonts or styles added to the content security policy in `server.js`
- [ ] New files added to the service worker cache list; bump `CACHE_NAME`

## Acceptance
- [ ] Every screen matches the design on desktop and phone
- [ ] No functional regressions: the testing checklist and automated tests still pass

## Progress log
| Date | Who | Note |
|---|---|---|
