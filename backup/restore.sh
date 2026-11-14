# Restoring into a fresh directory. Sourced by cairn-backup, not run.
# shellcheck shell=bash

# $1 = an empty directory to restore into, $2 = a snapshot id (default: the latest). The result is
# a complete Cairn data dir (cairn.db, photos/ and attachments/). It never touches the live data.
run_restore() {
  local target=${1:-} snap=${2:-latest}
  [ -n "$target" ] || die "usage: cairn-backup restore <empty directory> [snapshot id]"
  require_config
  mkdir -p "$target"
  [ "$(realpath "$target")" != "$(realpath "$DATA_DIR")" ] ||
    die "refusing to restore over the live data directory ($DATA_DIR)"
  [ -z "$(ls -A "$target")" ] || die "$target is not empty"
  repo_reachable

  local scratch="$target/.restore" filter=()
  [ "$snap" != latest ] || filter=(--host "$HOST" --tag cairn)
  log "restoring snapshot $snap into $target"
  restic restore "$snap" "${filter[@]}" --target "$scratch" >/dev/null
  [ -f "$scratch$STAGE/cairn.db" ] || { rm -rf "$scratch"; die "that snapshot has no database"; }
  mv "$scratch$STAGE/cairn.db" "$target/cairn.db"
  local dir
  for dir in $MEDIA_DIRS; do
    [ ! -d "$scratch$DATA_DIR/$dir" ] || mv "$scratch$DATA_DIR/$dir" "$target/$dir"
  done
  rm -rf "$scratch"

  [ "$(sqlite3 "$target/cairn.db" 'PRAGMA integrity_check')" = ok ] ||
    die "restored, but the database fails SQLite's integrity check"
  log "restored: $(sqlite3 "$target/cairn.db" 'SELECT count(*) FROM entry WHERE deleted_at IS NULL') entries, $(sqlite3 "$target/cairn.db" 'SELECT count(*) FROM photo WHERE deleted_at IS NULL') photos, $(live_attachments "$target/cairn.db") attachments"
  log "$target now holds a Cairn data directory. To use it, stop Cairn and put these files in its data volume (docs/backup.md)."
}
