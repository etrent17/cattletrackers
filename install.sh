#!/usr/bin/env bash
# Installs or updates Cattle Trackers with Docker Compose.
#
# Dockerfile, docker-compose.yml and .dockerignore are part of the repository.
# This script never writes them, so local edits survive re-runs. It only:
#   1. creates .env with generated secrets if it does not exist yet, and
#   2. runs `docker compose up -d --build`.
set -euo pipefail

cd "$(dirname "$0")"

for f in server.js package.json package-lock.json Dockerfile docker-compose.yml; do
  [[ -f $f ]] || { echo "$f not found; run this script from a full checkout of the repository"; exit 1; }
done
command -v docker >/dev/null || { echo "Docker is not installed"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required"; exit 1; }

# Stop the old single-container version if it exists
docker rm -f cattle-app >/dev/null 2>&1 || true

# .env: generated once, never overwritten (the DB password is fixed
# into the volume on first start, so regenerating it would lock you out)
if [[ ! -f .env ]]; then
  command -v openssl >/dev/null || { echo "openssl is required to generate secrets"; exit 1; }
  umask 077
  cat > .env <<EOF
APP_PORT=3036
# Use 127.0.0.1 when a reverse proxy on this host serves HTTPS
APP_BIND=0.0.0.0
DB_USER=cattle
DB_NAME=cattle
DB_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 32)
# Set to true to show the "Try the live demo" button
DEMO_MODE=false
# Set both to true only once the app is served over HTTPS (see docs/deployment.md)
COOKIE_SECURE=false
HSTS=false
EOF
  echo "Created .env with generated secrets"
else
  echo "Keeping existing .env"
fi

docker compose up -d --build

PORT=$(grep '^APP_PORT=' .env | cut -d= -f2 || true)
echo
echo "App:    http://localhost:${PORT:-3000}"
echo "Health: http://localhost:${PORT:-3000}/api/health"
echo "Logs:   docker compose logs -f"
