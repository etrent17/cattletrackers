# 04 · Automated tests and CI

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/automated-tests` | 1 | Not started | — | 01 |

## Goal
`npm test` runs real tests, and GitHub runs them on every push and pull request.

## Background
There are no tests; `npm test` prints an error (known issue 13). The original roadmap asks to "refactor the code for ease of testing".

## Tasks
- [ ] Choose tools: suggested `node:test` and `supertest` for the API, Playwright for a browser smoke test
- [ ] Split `server.js` so the Express `app` can be imported without listening (export `app`, start it in a separate entry)
- [ ] Test database: use `DATABASE_URL` pointing at a disposable Postgres; reset tables between tests
- [ ] API tests: setup (first admin, refused second time), login and logout, cattle create/read/update/delete, duplicate cow number (any case), validation errors, owner isolation (user A cannot see or edit user B's cattle), admin-only users API
- [ ] Unit tests: validators, date helpers, `CattleService.getStatistics`, `searchCattle`
- [ ] Browser smoke test: sign in, add a cow, see it on the dashboard, delete it
- [ ] GitHub Actions workflow with a Postgres service container
- [ ] Document how to run tests in the README

## Acceptance
- [ ] `npm test` passes locally against a fresh database
- [ ] CI runs on pull requests and shows a pass/fail check
- [ ] Owner-isolation test exists and passes
- [ ] Known issue 13 moved to Resolved

## Progress log
| Date | Who | Note |
|---|---|---|
