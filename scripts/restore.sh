#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh. This REPLACES the data in the target database.
#
# Usage: scripts/restore.sh [--yes] <backup.dump>
#
# Where it restores to:
#   - If DATABASE_URL is set in the environment, the local pg_restore loads into that
#     database (it must already exist; an empty one made with createdb is fine).
#     Stop any app using that database first.
#   - Otherwise it restores into the Compose `db` service. The app container is
#     stopped during the restore and started again afterwards.
#
# The restore runs in a single transaction: if anything fails, the database is left as it was.
set -euo pipefail

cd "$(dirname "$0")/.."

assume_yes=false
if [[ ${1:-} == --yes ]]; then assume_yes=true; shift; fi
backup=${1:-}
[[ -n $backup ]] || { echo "Usage: scripts/restore.sh [--yes] <backup.dump>" >&2; exit 1; }
[[ -s $backup ]] || { echo "Backup file not found or empty: $backup" >&2; exit 1; }

if [[ -n ${DATABASE_URL:-} ]]; then
  target='the database in $DATABASE_URL'
else
  target='the Compose db service'
fi

if ! $assume_yes; then
  read -r -p "Replace all data in $target with $backup? Type 'yes' to continue: " answer
  [[ $answer == yes ]] || { echo "Aborted"; exit 1; }
fi

restore_opts=(--clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error)

if [[ -n ${DATABASE_URL:-} ]]; then
  command -v pg_restore >/dev/null || { echo "pg_restore not found; install the PostgreSQL client tools" >&2; exit 1; }
  pg_restore "${restore_opts[@]}" --dbname="$DATABASE_URL" "$backup"
else
  command -v docker >/dev/null || { echo "Set DATABASE_URL, or install Docker to restore into the Compose database" >&2; exit 1; }
  docker compose stop app
  # Start the app again even if the restore fails, so the site does not stay down
  trap 'docker compose start app' EXIT
  docker compose exec -T db sh -c "pg_restore ${restore_opts[*]} -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"" < "$backup"
fi

echo "Restored $backup into $target"
