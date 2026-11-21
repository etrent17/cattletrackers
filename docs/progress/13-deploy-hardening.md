# 13 · Deployment hardening

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/deploy-hardening` | 3 | Not started | — | none |

## Goal
The app is safe and reliable to run for real: correct configuration, a meaningful health check, HTTPS, and backups.

## Background
- The generated compose file does not pass `DEMO_MODE` or `COOKIE_SECURE`.
- `install.sh` overwrites the Dockerfile and compose file on every run, so hand edits are lost (known issue 10).
- `/api/health` reports healthy even if PostgreSQL is down (known issue 11).
- HSTS is off and cookies are not marked secure until HTTPS is in place.

## Tasks
- [ ] Pass `DEMO_MODE` and `COOKIE_SECURE` through the compose file
- [ ] Commit the Dockerfile and compose file instead of generating them (or generate them only if missing)
- [ ] `/api/health` runs `SELECT 1` and returns 503 if the database is down
- [ ] Compose healthchecks for the app and the database
- [ ] HTTPS guide: reverse proxy (e.g. Caddy) in front, then turn on `COOKIE_SECURE` and HSTS through environment variables
- [ ] Backup script with `pg_dump`, and a documented restore
- [ ] Update `docs/deployment.md`

## Acceptance
- [ ] Stopping Postgres makes `/api/health` return 503
- [ ] Setting `DEMO_MODE=true` in `.env` turns the demo button on after `docker compose up`
- [ ] Re-running `install.sh` keeps local edits
- [ ] A backup can be restored into a fresh database and the app works
- [ ] Known issues 10 and 11 moved to Resolved

## Progress log
| Date | Who | Note |
|---|---|---|
