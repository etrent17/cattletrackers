#!/usr/bin/env bash
# Back up the Cattle Trackers database with pg_dump (custom format, compressed).
#
# Usage: scripts/backup.sh [output-dir]       (default: ./backups)
#
# Where the database is:
#   - If DATABASE_URL is set in the environment, the local pg_dump connects to it
#     (manual installs; pg_dump must be the same major version as the server or newer).
#   - Otherwise pg_dump runs inside the Compose `db` container, so no local
#     PostgreSQL tools are needed.
#
# BACKUP_KEEP (default 14) is how many backups to keep; older ones are deleted.
# Set BACKUP_KEEP=0 to keep everything.
#
# Backups hold password hashes and all herd data: they are written with mode 600.
# Schedule it with cron, for example (daily at 02:15):
#   15 2 * * * cd /path/to/cattletrackers && scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."

out_dir=${1:-backups}
keep=${BACKUP_KEEP:-14}
[[ $keep =~ ^[0-9]+$ ]] || { echo "BACKUP_KEEP must be a whole number" >&2; exit 1; }

umask 077
mkdir -p "$out_dir"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$out_dir/cattle-$stamp.dump"
tmp="$file.partial"
trap 'rm -f -- "$tmp"' EXIT

if [[ -n ${DATABASE_URL:-} ]]; then
  command -v pg_dump >/dev/null || { echo "pg_dump not found; install the PostgreSQL client tools" >&2; exit 1; }
  echo "Backing up \$DATABASE_URL with local pg_dump"
  pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" --file="$tmp"
else
  command -v docker >/dev/null || { echo "Set DATABASE_URL, or install Docker to back up the Compose database" >&2; exit 1; }
  echo "Backing up the Compose db service"
  docker compose exec -T db sh -c 'pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$tmp"
fi

[[ -s $tmp ]] || { echo "Backup is empty; not saving it" >&2; exit 1; }
mv -- "$tmp" "$file"
echo "Wrote $file ($(du -h -- "$file" | cut -f1))"

if (( keep > 0 )); then
  # Timestamped names sort chronologically; delete all but the newest $keep
  mapfile -t old < <(find "$out_dir" -maxdepth 1 -name 'cattle-*.dump' -type f | sort | head -n -"$keep")
  for f in "${old[@]}"; do
    rm -f -- "$f"
    echo "Removed old backup $f"
  done
fi
