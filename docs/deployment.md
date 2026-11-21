# Deployment

## Docker (recommended)

Requires Docker, Compose v2, and openssl.

```
./install.sh
```

The script does two things:

1. Creates `.env` with generated secrets if it does not exist. It never overwrites an existing `.env`: the database password is fixed into the volume on first start, so regenerating it would lock you out.
2. Runs `docker compose up -d --build`.

`Dockerfile`, `docker-compose.yml`, and `.dockerignore` are part of the repository. The script does not write them, so re-running it keeps local edits. Re-run it after `git pull` to rebuild and restart.

The stack is the app (Node 22) plus PostgreSQL 16 with a persistent `pgdata` volume. The default host port is 3036 from `APP_PORT` in `.env`.

### Local changes to the stack

Small changes can go straight into `docker-compose.yml`. To keep `git pull` free of conflicts, put them in `docker-compose.override.yml` instead: Compose loads it automatically, and it is gitignored.

The Docker build runs `npm ci`, which needs `package-lock.json` to match `package.json`. If you change dependencies, run `npm install` to update the lockfile before rebuilding.

### Changing settings

Edit `.env`, then run `docker compose up -d` (or `./install.sh`). Compose recreates the app container with the new values. For example, `DEMO_MODE=true` shows the "Try the live demo" button on the login page.

## Manual

1. Install Node 22 and PostgreSQL 16.
2. `npm ci`
3. Set the environment variables below, in the environment or in a `.env` file.
4. `npm start`

## Environment variables

Variables read by the app:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Session signing secret; the server exits without it |
| `PORT` | No | Defaults to 3000 |
| `DEMO_MODE` | No | `true` enables demo sessions and the demo button |
| `COOKIE_SECURE` | No | `true` marks the session cookie `Secure`. Only behind HTTPS: over plain HTTP, login stops working |
| `HSTS` | No | `true` sends `Strict-Transport-Security`. Only behind HTTPS |
| `HSTS_MAX_AGE` | No | HSTS lifetime in seconds; default 31536000 (one year) |

Additional `.env` variables used by `docker-compose.yml`:

| Variable | Purpose |
|---|---|
| `APP_PORT` | Host port for the app (install.sh sets 3036) |
| `APP_BIND` | Host address the port is published on; default `0.0.0.0`. Set `127.0.0.1` behind a reverse proxy on the same host |
| `DB_USER`, `DB_NAME`, `DB_PASSWORD` | PostgreSQL account; `DATABASE_URL` is built from them |
| `SESSION_SECRET` | Passed through to the app |

Compose passes `DEMO_MODE`, `COOKIE_SECURE`, `HSTS`, and `HSTS_MAX_AGE` to the app; missing values default to off. An `.env` made by an older install.sh lacks these lines; add them as needed.

## HTTPS

The app speaks plain HTTP. Serve it over HTTPS by putting a reverse proxy in front. Caddy is the simplest choice: it gets and renews Let's Encrypt certificates on its own.

You need a domain name whose DNS points at the server, and ports 80 and 443 open to the internet.

### Caddy on the host

1. [Install Caddy](https://caddyserver.com/docs/install).
2. In `.env`, set `APP_BIND=127.0.0.1` so the app is reachable only through Caddy, then run `docker compose up -d`.
3. Put this in `/etc/caddy/Caddyfile` (use your domain and `APP_PORT`), then `sudo systemctl reload caddy`:

   ```
   cattle.example.com {
       reverse_proxy 127.0.0.1:3036
   }
   ```

4. Open `https://cattle.example.com` and confirm that it loads and you can sign in.
5. Turn on the HTTPS-only settings in `.env` and run `docker compose up -d`:

   ```
   COOKIE_SECURE=true
   HSTS=true
   ```

### Caddy in Compose

Instead of installing Caddy on the host, add it to the stack with a `docker-compose.override.yml`:

```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on:
      - app
    restart: unless-stopped

volumes:
  caddy_data:
```

with a `Caddyfile` next to it:

```
cattle.example.com {
    reverse_proxy app:3000
}
```

Set `APP_BIND=127.0.0.1` so the app's own port is not exposed to the network, then continue from step 4 above.

### Notes

- The app trusts one proxy hop (`trust proxy` is 1 in `server.js`) and uses the proxy's `X-Forwarded-Proto` header to know a request arrived over HTTPS. Caddy sets that header. Any other proxy (nginx, Traefik) must set it as well, or the secure cookie is never sent and login fails.
- HSTS tells browsers to refuse plain HTTP for the whole `HSTS_MAX_AGE`, and that cannot be undone from the server. To try it out, start with `HSTS_MAX_AGE=300` and raise it once HTTPS has been working for a while. The header does not cover subdomains.
- If sign-in fails with "the session was not saved", `COOKIE_SECURE=true` is set while the site is reached over plain HTTP.

## Health checks

`GET /api/health` runs `SELECT 1` against PostgreSQL:

- `200 {"status":"healthy","database":"up"}` when the database answers
- `503 {"status":"unhealthy","database":"down"}` when it is unreachable or does not answer within 3 seconds

In Compose, the db service is checked with `pg_isready` and the app with `/api/health`. The app starts only once the database is healthy. `docker compose ps` shows each service's health. Docker does not restart an unhealthy container by itself, so use the health endpoint for external monitoring (an uptime checker, for example) as well.

If the database is unreachable when the app starts, the app exits and Compose restarts it until the database is back. If the database goes away while the app is running, the app keeps running, `/api/health` returns 503, and requests that need the database fail until it comes back.

## Backups

`scripts/backup.sh` writes a compressed `pg_dump` (custom format) to `./backups/cattle-<UTC timestamp>.dump` and keeps the newest 14 (`BACKUP_KEEP`; `0` keeps all). Backups contain password hashes and all herd data, so they are created readable only by their owner.

- **Docker:** run `scripts/backup.sh`. It runs `pg_dump` inside the db container, so you do not need PostgreSQL tools on the host.
- **Manual install:** run `DATABASE_URL=postgres://... scripts/backup.sh`. Your local `pg_dump` must be the same major version as the server or newer.

Pass a directory to write somewhere else: `scripts/backup.sh /mnt/nas/cattle`.

Run it daily with cron (`crontab -e`):

```
15 2 * * * cd /opt/cattletrackers && scripts/backup.sh >> backups/backup.log 2>&1
```

A backup on the same disk does not survive a disk failure. Copy `./backups` to another machine or to cloud storage as well.

## Restore

`scripts/restore.sh <file>` replaces all data in the target database with the backup. It asks for confirmation; pass `--yes` to skip the prompt. It runs in a single transaction, so a failed restore leaves the database unchanged.

**Docker, same server:**

```
scripts/restore.sh backups/cattle-20261121T021500Z.dump
```

The script stops the app container, restores into the db service, and starts the app again. Existing sessions in the backup stay valid; everyone else signs in again.

**Docker, new server (disaster recovery):**

1. Clone the repository and copy over your old `.env`. If you lost it, a new one from `install.sh` works too: accounts and data come from the backup, and only active sessions are lost.
2. `./install.sh`, which starts an empty database.
3. `scripts/restore.sh <file>`
4. Sign in with an account from the backup.

**Manual install, or a fresh database:**

```
createdb cattle_restored
DATABASE_URL=postgres://user:pass@host:5432/cattle_restored scripts/restore.sh <file>
```

Stop any app using the target database first, then point `DATABASE_URL` at the restored database and start the app.

Without the script, the equivalent command is:

```
pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error -d "$DATABASE_URL" <file>
```

Test a restore into a scratch database now and then. A backup you have never restored is not a backup you can count on.

## Operations

- Logs: `docker compose logs -f`
- Status and health: `docker compose ps`
- Update: `git pull && ./install.sh`
- The server shuts down cleanly on SIGTERM and SIGINT
