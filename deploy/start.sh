#!/usr/bin/env bash
# Cattle Trackers on a dev/test Docker host, from the pre-built image.
#
#   ./start.sh            start (or update) the app and print its address
#   ./start.sh stop       stop it (data is kept)
#   ./start.sh status     show the containers and the address
#   ./start.sh logs       follow the app's logs
#
# First run: creates .env with generated secrets, downloads the compose file if
# it isn't next to this script, picks a free host port (3036 or the next free
# one above it), and remembers that port in .env for later runs.
# Settings you can put in .env: APP_PORT, IMAGE_TAG (dev or latest), DEMO_MODE.
set -euo pipefail

cd "$(dirname "$0")"
COMPOSE_FILE=docker-compose.dev.yml
COMPOSE_URL=https://raw.githubusercontent.com/etrent17/cattletrackers/main/deploy/docker-compose.dev.yml
DEFAULT_PORT=3036

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Docker is not installed."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (the 'docker compose' command)."
docker info >/dev/null 2>&1 || die "Can't talk to the Docker daemon. Is it running, and may this user use it?"

if [[ ! -f $COMPOSE_FILE ]]; then
  say "Downloading $COMPOSE_FILE ..."
  curl -fsSL "$COMPOSE_URL" -o "$COMPOSE_FILE" || die "Couldn't download $COMPOSE_URL"
fi
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

env_get() { [[ -f .env ]] && sed -n "s/^$1=//p" .env | tail -n 1 || true; }
env_set() {
  if grep -q "^$1=" .env 2>/dev/null; then
    local tmp; tmp=$(mktemp); sed "s/^$1=.*/$1=$2/" .env > "$tmp" && cat "$tmp" > .env && rm -f "$tmp"
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}
random_hex() {
  if command -v openssl >/dev/null; then openssl rand -hex "$1"
  else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# The host port our own app container currently publishes, if it is running.
own_port() { compose port app 3000 2>/dev/null | sed -n 's/.*:\([0-9]*\)$/\1/p' | head -n 1; }

port_in_use() {
  local p=$1
  if command -v ss >/dev/null && ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$p\$"; then return 0; fi
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then return 0; fi
  if docker ps --format '{{.Ports}}' | tr ',' '\n' | grep -Eq ":$p->"; then return 0; fi
  return 1
}

pick_port() {
  local want=$1 running p
  running=$(own_port)
  if [[ -n $running ]]; then echo "$running"; return; fi
  for ((p = want; p < want + 200 && p <= 65535; p++)); do
    if ! port_in_use "$p"; then echo "$p"; return; fi
  done
  die "No free port found between $want and $((want + 199)). Set APP_PORT in .env."
}

host_address() {
  local ip=""
  if command -v hostname >/dev/null; then ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true); fi
  echo "${ip:-localhost}"
}

start() {
  if [[ ! -f .env ]]; then
    umask 077
    {
      echo "# Created by start.sh. Keep this file: DB_PASSWORD is fixed into the database on first start."
      echo "SESSION_SECRET=$(random_hex 32)"
      echo "DB_PASSWORD=$(random_hex 24)"
      echo "DEMO_MODE=true"
    } > .env
    say "Created .env with new secrets."
  fi
  [[ -n $(env_get SESSION_SECRET) && -n $(env_get DB_PASSWORD) ]] || die ".env must set SESSION_SECRET and DB_PASSWORD."

  local saved port
  saved=$(env_get APP_PORT)
  port=$(pick_port "${saved:-$DEFAULT_PORT}") || exit 1
  if [[ -n $saved && $saved != "$port" ]]; then say "Port $saved is in use by something else; using $port instead."; fi
  [[ $saved == "$port" ]] || env_set APP_PORT "$port"

  say "Pulling the latest image ..."
  compose pull --quiet || say "Pull failed; trying with the images already on this host."
  compose up -d --remove-orphans

  say "Waiting for the app to answer on port $port ..."
  local i
  for ((i = 0; i < 60; i++)); do
    if curl -fsS "http://localhost:$port/api/health" >/dev/null 2>&1; then
      say ""
      say "Cattle Trackers is running: http://$(host_address):$port"
      say "Create the first admin account there, or use \"Try the live demo\" (DEMO_MODE in .env)."
      return
    fi
    sleep 2
  done
  say "The app didn't answer within 2 minutes. Recent logs:"
  compose logs --tail 40 app
  exit 1
}

case "${1:-start}" in
  start|up) start ;;
  stop|down) compose down ;;
  status)
    compose ps
    p=$(own_port); [[ -n $p ]] && say "Address: http://$(host_address):$p" ;;
  logs) compose logs -f app ;;
  *) die "Usage: $0 [start|stop|status|logs]" ;;
esac
