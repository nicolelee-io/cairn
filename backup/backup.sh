# One backup run, and the startup check. Sourced by cairn-backup, not run.
# shellcheck shell=bash

# A consistent copy of the live DB (SQLite's own backup, never a file copy), checked, then
# restic: the copy plus the photo and attachment files (immutable once written, so safe to read
# while the app runs). Then retention and a repository check. Writes the restic summary to $1.
do_backup() {
  local result=$1
  require_config
  [ -f "$DB" ] || die "no database at $DB (is the data volume mounted at $DATA_DIR?)"
  repo_reachable
  restic unlock >/dev/null 2>&1 || true # only removes locks that have gone stale

  rm -rf "$STAGE" && mkdir -p "$STAGE"
  log "snapshotting the database"
  sqlite3 -cmd '.timeout 30000' "$DB" ".backup '$STAGE/cairn.db'"
  [ "$(sqlite3 "$STAGE/cairn.db" 'PRAGMA integrity_check')" = ok ] ||
    die "the database snapshot failed its integrity check; not backing it up"

  local paths=("$STAGE/cairn.db")
  local dir
  for dir in $MEDIA_DIRS; do
    [ ! -d "$DATA_DIR/$dir" ] || paths+=("$DATA_DIR/$dir")
  done
  log "backing up ${paths[*]}"
  restic backup --host "$HOST" --tag cairn --json "${paths[@]}" |
    grep '"message_type":"\(summary\|error\)"' >"$result"
  grep -q '"message_type":"summary"' "$result" || die "restic did not finish: $(tail -n 1 "$result")"

  log "applying retention (daily ${BACKUP_KEEP_DAILY:-7}, weekly ${BACKUP_KEEP_WEEKLY:-4}, monthly ${BACKUP_KEEP_MONTHLY:-12})"
  restic forget --host "$HOST" --prune \
    --keep-daily "${BACKUP_KEEP_DAILY:-7}" \
    --keep-weekly "${BACKUP_KEEP_WEEKLY:-4}" \
    --keep-monthly "${BACKUP_KEEP_MONTHLY:-12}"

  # Structure always; a slice of the actual data each night, so all of it is read over time.
  log "checking the repository"
  local subset=${BACKUP_CHECK_SUBSET-1%} # unset = 1%; set to empty to check structure only
  restic check ${subset:+--read-data-subset="$subset"}
  rm -rf "$STAGE"
}

# Runs do_backup, reports the outcome (status file, ping) and returns its exit code. Never
# exits the process: the scheduler keeps going after a failed night.
run_backup() {
  local started logf result rc msg id added
  started=$(now_ms)
  logf=$(mktemp) && result=$(mktemp)
  ping start
  set +e
  (
    set -e
    do_backup "$result"
  ) 2>&1 | tee "$logf" >&2
  rc=${PIPESTATUS[0]}
  set -e

  if [ "$rc" -eq 0 ]; then
    id=$(sed -n 's/.*"snapshot_id":"\([0-9a-f]*\)".*/\1/p' "$result" | tail -n 1)
    added=$(sed -n 's/.*"data_added":\([0-9]*\).*/\1/p' "$result" | tail -n 1)
    record lastRun true '' ",\"durationMs\":$(($(now_ms) - started))"
    set_status lastSuccess "{\"at\":$(now_ms),\"snapshotId\":$(json_str "${id:0:8}"),\"bytesAdded\":${added:-0}}"
    log "backup finished (snapshot ${id:0:8}, ${added:-0} bytes added)"
    ping '' "snapshot ${id:0:8}, ${added:-0} bytes added"
  else
    msg=$(tail_msg "$logf" 3)
    record lastRun false "${msg:-backup failed (exit $rc)}" ",\"durationMs\":$(($(now_ms) - started))"
    log "backup FAILED (exit $rc)"
    ping fail "${msg:-backup failed (exit $rc)}"
  fi
  rm -f "$logf" "$result"
  return "$rc"
}

# At startup: say loudly, and in Settings, if this can't work, instead of waiting for the first
# night. Doesn't stop the container (the network may simply not be up yet).
preflight() {
  local out rc
  set +e
  out=$( (
    set -e
    require_config
    repo_reachable
  ) 2>&1)
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '%s\n' "$out" >&2
    out=$(printf '%s' "$out" | plain | tr '\n' ' ')
    record lastRun false "setup problem: ${out:0:250}"
    ping fail "setup problem: ${out:0:250}"
  else
    log "repository reachable"
  fi
  return 0
}
