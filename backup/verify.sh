# A test restore. Sourced by cairn-backup, not run.
# shellcheck shell=bash

# Restores the database from the latest snapshot into a scratch directory and checks that it is
# a working Cairn: it passes SQLite's integrity check, and every photo and attachment file it
# refers to is in the snapshot (restic's file list, so the files are not downloaded). The bytes of
# everything are checked by "full", which reads every pack in the repository.
do_verify() {
  local mode=$1 tmp=$2
  require_config
  repo_reachable
  if [ "$mode" = full ]; then
    log "reading every pack in the repository (this can take a long time)"
    restic check --read-data
  fi

  log "restoring the database from the latest snapshot to $tmp"
  restic restore latest --host "$HOST" --tag cairn --target "$tmp" --include "$STAGE/cairn.db" >/dev/null
  local db="$tmp$STAGE/cairn.db"
  [ -f "$db" ] || die "the latest snapshot has no database"
  [ "$(sqlite3 "$db" 'PRAGMA integrity_check')" = ok ] ||
    die "the restored database fails SQLite's integrity check"

  local entries journals photos files
  entries=$(sqlite3 "$db" 'SELECT count(*) FROM entry WHERE deleted_at IS NULL')
  journals=$(sqlite3 "$db" 'SELECT count(*) FROM journal WHERE deleted_at IS NULL')
  photos=$(sqlite3 "$db" 'SELECT count(*) FROM photo WHERE deleted_at IS NULL')
  files=$(live_attachments "$db")

  # Every file the live photo and attachment rows name, against every file in the snapshot. A
  # listing that came back empty or in a form this doesn't expect shows up here as missing files,
  # never as a pass.
  local wanted="SELECT original_path FROM photo WHERE deleted_at IS NULL AND original_path <> ''
                UNION SELECT display_path FROM photo WHERE deleted_at IS NULL AND display_path <> ''
                UNION SELECT thumb_path FROM photo WHERE deleted_at IS NULL AND thumb_path <> ''"
  ! has_attachments_table "$db" ||
    wanted="$wanted UNION SELECT path FROM attachment WHERE deleted_at IS NULL AND path <> ''"
  sqlite3 "$db" "$wanted" | sed "s|^|$DATA_DIR/|" | sort -u >"$tmp/.wanted"
  restic ls latest --host "$HOST" --tag cairn --recursive | grep '^/' | sort -u >"$tmp/.listed"
  local missing first
  missing=$(comm -23 "$tmp/.wanted" "$tmp/.listed" | wc -l)
  first=$(comm -23 "$tmp/.wanted" "$tmp/.listed" | head -n 1)
  [ "$missing" -eq 0 ] || die "$missing photo or attachment file(s) the database lists are not in the backup (first: $first)"

  # The backup is up to a day old, so the live counts can be higher; only "empty" is wrong.
  local live
  live=$(sqlite3 -readonly "$DB" 'SELECT count(*) FROM entry WHERE deleted_at IS NULL' 2>/dev/null || echo '?')
  log "restored: $journals journal(s), $entries entr(ies), $photos photo(s), $files attachment(s), all files present (live now: $live entr(ies))"
  if [ "$entries" -eq 0 ] && [ "$live" != '?' ] && [ "$live" -gt 0 ]; then
    die "the backup has no entries but the live database has $live"
  fi
  printf '%s,%s,%s\n' "$entries" "$photos" "$journals" >"$tmp/.counts"
}

run_verify() {
  local mode=${1:-} tmp logf rc msg counts
  tmp=$(mktemp -d) && logf=$(mktemp)
  set +e
  (
    set -e
    do_verify "$mode" "$tmp"
  ) 2>&1 | tee "$logf" >&2
  rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" -eq 0 ]; then
    counts=$(cat "$tmp/.counts")
    record lastVerify true '' ",\"entries\":${counts%%,*}"
    log "test restore PASSED"
  else
    msg=$(tail_msg "$logf" 1)
    record lastVerify false "${msg:-test restore failed (exit $rc)}"
    log "test restore FAILED"
  fi
  rm -rf "$tmp" "$logf"
  return "$rc"
}
