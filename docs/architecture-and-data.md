# Architecture and Data

## Layout

```
server.js            Express app, security headers, sessions, routing
db.js                PostgreSQL pool, schema creation, demo cleanup
routes/              auth.js, cattle.js, users.js
middleware/auth.js   requireAuth, requireAdmin, validate
lib/                 password.js, demo.js
public/              index.html, login.html, CSS, service-worker.js
src/                 browser ES modules
  app.js             startup and sign-out
  auth.js            login page logic
  controllers/       CattleController
  services/          CattleService (API calls and statistics)
  views/             DashboardView, ListView, FormView
  models/ utils/     Cattle model, validators, date helpers
```

## Request flow

Browser view or controller, then `CattleService`, then `/api/cattle`, then the route handler, then PostgreSQL. After a change the controller refreshes its views from the in-memory list.

## Database

Created automatically at startup (`initSchema`).

**users**: `id`, `email` (unique), `password_hash`, `role` (admin or user), `created_at`, `is_demo`.

**cattle**: `id` (UUID), `owner_id` (users, cascade delete), `tag_number`, `name_breed`, `gender`, `birth_date`, `weight`, `last_calving_date`, `expected_calving_date`, `medications`, `health_status`, `notes`, `created_at`, `updated_at`. A unique index on owner and lower-cased tag number prevents duplicates.

**session**: managed by `connect-pg-simple`.

Date columns are returned as `YYYY-MM-DD` strings. The API uses camelCase names (`tagNumber`) while the database uses snake_case.

## Security configuration

Helmet sets a content security policy that allows scripts from the app and `cdn.jsdelivr.net`, and styles and fonts from jsdelivr and cdnjs. HSTS is disabled until HTTPS is in place. The server trusts one proxy hop.

## Service worker

Caches static assets and serves them when the network fails. Requests to `/api/` are never intercepted, so cattle data is not available offline.
