#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

[[ -f server.js ]]    || { echo "server.js not found"; exit 1; }
[[ -f package.json ]] || { echo "package.json not found"; exit 1; }
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
DB_USER=cattle
DB_NAME=cattle
DB_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 32)
EOF
  echo "Created .env with generated secrets"
else
  echo "Keeping existing .env"
fi

# .dockerignore
cat > .dockerignore <<'EOF'
node_modules
npm-debug.log
.git
.env
Dockerfile
.dockerignore
docker-compose.yml
EOF

# Dockerfile
cat > Dockerfile <<'EOF'
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER node
EXPOSE 3000
CMD ["node", "server.js"]
EOF

# docker-compose.yml (${VARS} are read from .env by Compose)
cat > docker-compose.yml <<'EOF'
services:
  app:
    build: .
    ports:
      - "${APP_PORT:-3000}:3000"
    environment:
      PORT: 3000
      NODE_ENV: production
      DATABASE_URL: postgres://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
      SESSION_SECRET: ${SESSION_SECRET}
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/health || exit 1"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 15s
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

volumes:
  pgdata:
EOF

# --- Lockfile: create it if missing, sync it if stale -------------------
run_npm() {
  if command -v npm >/dev/null 2>&1; then
    npm "$@"
  else
    echo "npm not found on host; using a temporary node:22-alpine container"
    docker run --rm \
      --user "$(id -u):$(id -g)" \
      -e HOME=/tmp \
      -v "$PWD":/app -w /app \
      node:22-alpine npm "$@"
  fi
}

if [[ ! -f package-lock.json ]]; then
  echo "package-lock.json not found; generating it"
else
  echo "Checking package-lock.json is in sync with package.json"
fi

# Creates the lockfile if absent, adds missing entries if stale,
# and does nothing if it is already in sync. Does not create node_modules.
run_npm install --package-lock-only --ignore-scripts --no-audit --no-fund

[[ -f package-lock.json ]] || { echo "Failed to create package-lock.json"; exit 1; }

docker compose up -d --build

PORT=$(grep '^APP_PORT=' .env | cut -d= -f2)
echo
echo "App:    http://localhost:${PORT:-3000}"
echo "Health: http://localhost:${PORT:-3000}/api/health"
echo "Logs:   docker compose logs -f"