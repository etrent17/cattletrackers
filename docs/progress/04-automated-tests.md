# 04 · Automated tests and CI

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/automated-tests` | 1 | In review | agent | 01 |

## Goal
`npm test` runs real tests, and GitHub runs them on every push and pull request.

## Background
There are no tests; `npm test` prints an error (known issue 13). The original roadmap asks to "refactor the code for ease of testing".

## Tasks
- [x] Choose tools: suggested `node:test` and `supertest` for the API, Playwright for a browser smoke test
- [x] Split `server.js` so the Express `app` can be imported without listening (export `app`, start it in a separate entry)
- [x] Test database: use `DATABASE_URL` pointing at a disposable Postgres; reset tables between tests
- [x] API tests: setup (first admin, refused second time), login and logout, cattle create/read/update/delete, duplicate cow number (any case), validation errors, owner isolation (user A cannot see or edit user B's cattle), admin-only users API
- [x] Unit tests: validators, date helpers, `CattleService.getStatistics`, `searchCattle`
- [x] Browser smoke test: sign in, add a cow, see it on the dashboard, delete it
- [x] GitHub Actions workflow with a Postgres service container
- [x] Document how to run tests in the README

## Acceptance
- [x] `npm test` passes locally against a fresh database
- [ ] CI runs on pull requests and shows a pass/fail check
- [x] Owner-isolation test exists and passes
- [x] Known issue 13 moved to Resolved

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Tools: `node:test`, `supertest`, Playwright (all dev dependencies; `bootstrap` added as a dev dependency so the browser test can serve it without the CDN). `server.js` split: `app.js` exports the app, `server.js` checks settings, runs `initSchema()` and listens; `npm start` checked by hand (health, static page, login limiter 429 on the 21st attempt). Tests run only against `TEST_DATABASE_URL` (they wipe it; `DATABASE_URL` and `.env` are ignored) and reset the tables before each test. `RATE_LIMIT_DISABLED=true` (read once at startup, off by default) relaxes the limiters under test; `test/api/rate-limit.test.js` runs with them on. Local run on PostgreSQL 16, Node 22, fresh database and clean clone: `npm test` 146 tests, 145 pass, 0 fail, 1 todo (API accepts weight 0, see below); `npm run test:e2e` 9 of 9 pass in headless Chromium. Fixed two trivial 500s the tests found: impossible dates such as `2026-02-30` and malformed JSON bodies now return 400. Found, not fixed: the API stores `weight: 0` although docs/api.md says greater than 0 (recorded as a `todo` test); a missing or non-text cow number answers "Invalid value" instead of "Invalid cow number". The GitHub Actions workflow parses as valid YAML and mirrors the local commands, but it has not run on GitHub yet, so "CI runs on pull requests" stays unticked until the first run is seen. |
