# Deployment

## Docker (recommended)

Requires Docker, Compose v2, and openssl.

```
./install.sh
```

The script creates a `.env` once with generated secrets (it never overwrites an existing one), writes `Dockerfile`, `docker-compose.yml`, and `.dockerignore`, syncs `package-lock.json`, and runs `docker compose up -d --build`. **Re-running it overwrites those three generated files.**

The stack is the app (Node 22) plus PostgreSQL 16 with a persistent `pgdata` volume. The default host port is 3036 from `APP_PORT` in `.env`.

## Manual

1. Install Node and PostgreSQL.
2. `npm ci`
3. Set the environment variables below.
4. `npm start`

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Session signing secret; the server exits without it |
| `PORT` | No | Defaults to 3000 |
| `COOKIE_SECURE` | No | Set `true` only when served over HTTPS |
| `DEMO_MODE` | No | Set `true` to enable demo sessions |

The generated `docker-compose.yml` passes only `PORT`, `NODE_ENV`, `DATABASE_URL`, and `SESSION_SECRET`. To use demo mode or secure cookies in Docker, add those variables to the compose `environment` section.

## Operations

- Health check: `GET /api/health` (used by the container healthcheck)
- Logs: `docker compose logs -f`
- The server shuts down cleanly on SIGTERM and SIGINT
- Back up the `pgdata` volume; it holds all accounts and cattle
- Before serving over HTTPS, set `COOKIE_SECURE=true` and re-enable HSTS in `server.js`
