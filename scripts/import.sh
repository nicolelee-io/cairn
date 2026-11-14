#!/usr/bin/env bash
# Import a Day One or Cairn export zip into the running container, with a backup before and a
# backup plus test restore after. Run from the folder with docker-compose.yml.
#
#   scripts/import.sh Export.zip [--no-backup] [importer options...]
#
# Importer options (--user, --archived "Journal", --force) go to import-journal.js unchanged.
# --no-backup skips the backups (no backup sidecar, or a throwaway instance). Without it, a failed
# backup stops the import before anything is written.
set -euo pipefail

zip=${1:-}
if [ -z "$zip" ] || [ ! -f "$zip" ]; then
  echo "usage: $0 <export.zip> [--no-backup] [--user NAME] [--archived \"Journal\"]... [--force]" >&2
  exit 2
fi
shift

backup=true
args=()
for a in "$@"; do
  if [ "$a" = --no-backup ]; then backup=false; else args+=("$a"); fi
done

backup_cmd() { docker compose --profile backup run --rm backup "$@"; }

if $backup; then
  echo '== Backup before the import'
  backup_cmd now || { echo 'The backup failed, so nothing was imported. Fix it, or pass --no-backup.' >&2; exit 1; }
fi

echo '== Import'
# The zip goes in over stdin: no copy to clean up, and the container's own user writes the temp file.
status=0
docker exec -i cairn node import-journal.js - ${args[@]+"${args[@]}"} < "$zip" || status=$?

if $backup; then
  echo '== Backup and test restore after the import'
  backup_cmd now && backup_cmd verify
fi
exit "$status"
