# 15 · Apply Emil's design

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/emil-design` | 5 | Not started | cbik6 (runs it locally) | 01 to 13 (everything functional) |

## Goal
One review pass over the whole app, including the sign-in page, with the Emil design skill: find where motion would help and where the look can be improved, then apply those changes.

## Background
Design is deliberately done after the app is functional, so screens are restyled once rather than repeatedly. The app currently uses stock Bootstrap 5 (`public/styles.css`, `public/login.css`). Older sign-in hero styles are in git history at `e8d97e1` (`git show e8d97e1:public/styles.css`), in case any of it is useful.

## Decisions needed before starting
- [x] Emil is a skill the owner runs once in local Claude Code on this branch (decided 2026-11-21); it reviews the design for motion and visual improvements
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
