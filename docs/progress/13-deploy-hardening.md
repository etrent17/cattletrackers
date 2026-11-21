# 13 · Deployment hardening

| Branch | Phase | Status | Owner | Depends on |
|---|---|---|---|---|
| `feature/deploy-hardening` | 3 | In review | agent | none |

## Goal
The app is safe and reliable to run for real: correct configuration, a meaningful health check, HTTPS, and backups.

## Background
- The generated compose file does not pass `DEMO_MODE` or `COOKIE_SECURE`.
- `install.sh` overwrites the Dockerfile and compose file on every run, so hand edits are lost (known issue 10).
- `/api/health` reports healthy even if PostgreSQL is down (known issue 11).
- HSTS is off and cookies are not marked secure until HTTPS is in place.

## Tasks
- [x] Pass `DEMO_MODE` and `COOKIE_SECURE` through the compose file (also `HSTS`, `HSTS_MAX_AGE`, and `APP_BIND` for the published port)
- [x] Commit the Dockerfile and compose file instead of generating them (`install.sh` now only creates `.env` and runs Compose)
- [x] `/api/health` runs `SELECT 1` and returns 503 if the database is down (3 s timeout; registered before the session middleware; a pool `error` listener stops a dropped idle connection from crashing the process)
- [x] Compose healthchecks for the app and the database (validated with `docker compose config` only, see notes)
- [x] HTTPS guide: reverse proxy (e.g. Caddy) in front, then turn on `COOKIE_SECURE` and HSTS through environment variables (`HSTS=true` replaces the hard-coded `hsts: false`)
- [x] Backup script with `pg_dump`, and a documented restore (`scripts/backup.sh`, `scripts/restore.sh`)
- [x] Update `docs/deployment.md` (also `docs/api.md`, `docs/feature-inventory.md`)

## Acceptance
- [x] Stopping Postgres makes `/api/health` return 503. Simulated without Docker: with the app running, `ALTER DATABASE ... ALLOW_CONNECTIONS false` plus `pg_terminate_backend` on its connections gave 503, the process stayed up, and re-allowing connections gave 200. The shared PostgreSQL server and a Compose db container were not actually stopped.
- [ ] Setting `DEMO_MODE=true` in `.env` turns the demo button on after `docker compose up`. Not run end to end: no Docker daemon here. Verified the parts: `docker compose config` with `DEMO_MODE=true` in the env file passes `DEMO_MODE: "true"` to the app, and the app started with `DEMO_MODE=true` reports `demoEnabled: true` from `/api/auth/status`.
- [x] Re-running `install.sh` keeps local edits. Ran it twice in a scratch copy with a stub `docker` on `PATH`: hand-edited `Dockerfile`, `docker-compose.yml`, `.dockerignore` and `package-lock.json` were byte-identical afterwards; `.env` was created once (mode 600) and kept on the second run.
- [x] A backup can be restored into a fresh database and the app works. `scripts/backup.sh` (local `pg_dump`) then `scripts/restore.sh` into a new empty database; the app started against it, an admin from the backup signed in and listed their cattle. The Docker branches of both scripts were run with a stub `docker` that executes the container command locally; not tested against a real container.
- [x] Known issues 10 and 11 moved to Resolved

## Notes
- No Docker daemon was available while this was built, so the image build, `docker compose up`, the healthchecks in action, and the Caddy setup are untested. Compose files were checked with `docker compose config`.
- Existing installs: an `.env` from an older `install.sh` has no `DEMO_MODE`/`COOKIE_SECURE`/`HSTS` lines; Compose defaults them to off. The Compose project name and `pgdata` volume are unchanged, so data carries over.
- `install.sh` no longer syncs `package-lock.json`; the committed lockfile is used, and the Docker build's `npm ci` fails if it is stale.

## Progress log
| Date | Who | Note |
|---|---|---|
| 2026-11-21 | agent | Committed Docker files, slimmed `install.sh`, DB-aware health check, env-switchable HSTS, backup/restore scripts, deployment docs. Verified locally against PostgreSQL 16; Docker not available. Ready for review. |
