# Cattle Trackers

Cattle Trackers is a livestock management web application: an Express server, a PostgreSQL database, a REST API, and a Bootstrap-based browser interface written as ES modules.

> **Status: early prototype.** These docs describe the source at commit `7fb8152`. Nothing has been verified by browser testing yet. Read [known issues](docs/known-issues.md) before relying on any workflow.

## What exists today

- Admin account setup, login, logout, and an optional temporary demo mode
- Per-user cattle records: add, view, edit, delete, search, and filter by health status
- A dashboard, plus calving, medical, and breeding views that filter the cattle list
- Financial records (income and expenses, optionally per animal) with CSV export, and a Financial Reports page
- An admin-only user-management API
- A Docker-based installer
- Automated tests (unit, API, and a browser smoke test) that also run on GitHub for every push and pull request

## What does not exist yet

- Distinct performance or health reports (those screens are placeholders)
- A user-management screen
- Offline editing of cattle data

## Quick start

Requires Docker with Compose v2 and openssl.

```
./install.sh
```

Open the printed URL and create the first admin account. See [deployment](docs/deployment.md) for details and manual setup.

## Running the tests

Requires Node 22 and a PostgreSQL database that can be wiped. **The tests delete every user, animal, and session in it**, so they only run against the database named in `TEST_DATABASE_URL`; they ignore `DATABASE_URL` and `.env`.

```
createdb cattle_test
npm ci
export TEST_DATABASE_URL=postgres://postgres@localhost:5432/cattle_test
npm test
```

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | Unit and API tests: every `test/**/*.test.js` or `.test.mjs` file | PostgreSQL |
| `npm run test:unit` | Front-end unit tests only (`test/unit/`) | nothing |
| `npm run test:api` | API tests only (`test/api/`) | PostgreSQL |
| `npm run test:e2e` | Browser tests (`e2e/`), one file at a time: the smoke test (set up, sign in, add a cow, see it on the dashboard and list, delete it) and financial records (add income and expenses, check the report, export CSV) | PostgreSQL, Chromium |

Before the first `npm run test:e2e`, install the browser once with `npx playwright install chromium` (add `--with-deps` on a fresh Linux machine).

How it fits together:

- Tests use Node's built-in runner (`node:test`), `supertest` for the API, and Playwright for the browser. To run one file: `node --test test/api/cattle.test.js`.
- `app.js` builds the Express app without listening, so tests import it directly; `server.js` is the entry point that starts it.
- `test/helpers/api.js` prepares the schema, empties the tables before each test, and has helpers for creating users and signed-in sessions. A new API test file starts with `useDatabase()`.
- Test files run one at a time because they share one database.
- The login rate limit (20 attempts per 15 minutes) would stop the suite, so the helper sets `RATE_LIMIT_DISABLED=true`. This switch is for tests only; never set it on a real server. `test/api/rate-limit.test.js` runs with the limiter on to check it still works.
- The browser test answers CDN requests locally (Bootstrap from `node_modules`, an empty stylesheet for Font Awesome) so it does not depend on the network. Set `E2E_REAL_CDN=true` to load the real CDN files.
- GitHub Actions (`.github/workflows/test.yml`) runs `npm test` and `npm run test:e2e` with a PostgreSQL 16 service on every push and pull request.

## Documentation

- [Roadmap and progress sheets](docs/roadmap.md)
- [Feature inventory](docs/feature-inventory.md)
- [User guide](docs/user-guide.md)
- [Reports and records](docs/reports-and-records.md)
- [Authentication and users](docs/authentication-and-users.md)
- [Architecture and data](docs/architecture-and-data.md)
- [API reference](docs/api.md)
- [Deployment](docs/deployment.md)
- [Known issues](docs/known-issues.md)
- [Testing checklist](docs/testing-checklist.md)

## Original roadmap

- refactor the code for ease of testing & reading
- working prototype
- function login/password handling
- consider performance with pure js over other options
