# Architecture and Data

## Layout

```
server.js            entry point: checks settings, prepares the database, listens
app.js               Express app (no listening): security headers, sessions, routing
db.js                PostgreSQL pool, schema creation, demo cleanup
routes/              auth.js, cattle.js, users.js
middleware/auth.js   requireAuth, requireAdmin, validate
lib/                 password.js, demo.js
public/              index.html, login.html, CSS, service-worker.js
src/                 browser ES modules
  app.js             startup and sign-out
  auth.js            login page logic
  controllers/       CattleController
  services/          CattleService (API calls and statistics), AccountService (password change)
  views/             DashboardView, ListView, FormView, SettingsView
  models/ utils/     Cattle model, validators, date helpers, escapeHtml
test/                unit tests (unit/), API tests (api/), shared setup (helpers/)
e2e/                 browser tests (Playwright); shared setup in e2e/helpers.js
```

## Request flow

Browser view or controller, then `CattleService`, then `/api/cattle`, then the route handler, then PostgreSQL. After a change the controller refreshes its views from the in-memory list.

Errors: `CattleService` errors carry the HTTP status (0 when the server is unreachable); a 401 sends the browser to the login page. A failed startup or herd load shows the error banner with Retry, and a failed action shows an error toast (`src/utils/feedback.js`). The app's event listeners are attached before data loads, so the page stays usable after a failure.

## Database

Created automatically at startup (`initSchema`).

**users**: `id`, `email` (unique), `password_hash`, `role` (admin or user), `created_at`, `is_demo`.

**cattle**: `id` (UUID), `owner_id` (users, cascade delete), `tag_number`, `name_breed`, `gender`, `birth_date`, `weight`, `last_calving_date`, `expected_calving_date`, `medications`, `health_status`, `notes`, `created_at`, `updated_at`. A unique index on owner and lower-cased tag number prevents duplicates.

**session**: managed by `connect-pg-simple`.

Date columns are returned as `YYYY-MM-DD` strings. The API uses camelCase names (`tagNumber`) while the database uses snake_case.

## Security configuration

Helmet sets a content security policy that allows scripts from the app and `cdn.jsdelivr.net`, and styles and fonts from jsdelivr and cdnjs. HSTS is disabled until HTTPS is in place. The server trusts one proxy hop.

## Rendering record fields

Always escape record fields in templates. Views build HTML with template strings and `innerHTML`, so every value that comes from a user or the API (cow number, name/breed, medications, notes, dates, ids, status labels) is wrapped in `escapeHtml()` from `src/utils/escapeHtml.js`, in element text and in quoted attribute values such as `data-id="${escapeHtml(c.id)}"`. Apply it to the final string, including any fallback: `${escapeHtml(c.nameBreed || "Unnamed")}`. Only fixed markup written in the template itself (icons, badges, `<br>`) stays unescaped. When a whole element holds one plain value, setting `textContent` (or an input's `value`) is simpler and needs no escaping. Never escape before saving: the API stores the text exactly as typed.

## Service worker

Caches static assets and serves them when the network fails. Requests to `/api/` are never intercepted, so cattle data is not available offline. Nothing is stored in `localStorage`. The System Settings screen describes this to users.
