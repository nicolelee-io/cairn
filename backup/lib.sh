# Shared helpers for the backup scripts. Sourced, not run.
# shellcheck shell=bash

DATA_DIR="${DATA_DIR:-/data}"
DB="$DATA_DIR/cairn.db"
# Where the snapshot of the DB is staged. restic stores absolute paths, so this is also where
# the DB sits inside every snapshot (and so inside a restored tree).
STAGE=${CAIRN_BACKUP_STAGE:-/tmp/stage}
# One fixed host name, so snapshots chain and retention counts them together whatever the
# container is called.
HOST=cairn
# The file folders inside the data dir that a backup carries beside the DB (photos, plus the
# attachment files: PDFs, videos, audio). Both are named by sha256 and never change once written.
MEDIA_DIRS="photos attachments"
STATUS_DIR="$DATA_DIR/backups/status.d"
STATUS_FILE="$DATA_DIR/backups/backup-status.json"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "error: $*"; exit 1; }

now_ms() { printf '%s000' "$(date +%s)"; }

# Attachments came with migration 0010; a database from an older snapshot has no such table.
has_attachments_table() {
  [ "$(sqlite3 "$1" "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'attachment'")" = 1 ]
}
live_attachments() {
  if has_attachments_table "$1"; then
    sqlite3 "$1" 'SELECT count(*) FROM attachment WHERE deleted_at IS NULL'
  else
    echo 0
  fi
}

# A JSON string from any text (control characters dropped, so this can't produce invalid JSON).
json_str() {
  local s
  s=$(printf '%s' "$1" | tr -d '\000-\010\013\014\016-\037')
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\t'/\\t}
  printf '"%s"' "$s"
}

# Log lines without their timestamp and "error:" label, for showing to a person.
plain() { sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z (error: )?//'; }

# The last few lines of a log, as one short line: what to show in Settings and send to the ping.
tail_msg() {
  local msg
  msg=$(plain <"$1" | grep -v '^[[:space:]]*$' | tail -n "${2:-3}" | tr '\n' ' ')
  printf '%s' "${msg:0:300}"
}

require_config() {
  [ -n "${RESTIC_REPOSITORY:-}" ] || die "RESTIC_REPOSITORY is not set (see docs/backup.md)"
  [ -n "${RESTIC_PASSWORD:-}${RESTIC_PASSWORD_FILE:-}${RESTIC_PASSWORD_COMMAND:-}" ] ||
    die "set RESTIC_PASSWORD, RESTIC_PASSWORD_FILE or RESTIC_PASSWORD_COMMAND"
  case "${BACKUP_TIME:-03:00}" in
    [01][0-9]:[0-5][0-9] | 2[0-3]:[0-5][0-9]) ;;
    *) die "BACKUP_TIME must be HH:MM (24-hour), got '${BACKUP_TIME}'" ;;
  esac
}

# The repository can be read with the password we have (so: it exists, the network and the
# credentials work). Not finding it is the usual first-run mistake, so say what to do.
repo_reachable() {
  local out
  if ! out=$(restic cat config 2>&1 >/dev/null); then
    log "$out"
    die "cannot open the restic repository. First time? Run: cairn-backup init"
  fi
}

# healthchecks.io-style: <url> = success, <url>/start, <url>/fail. A body is optional context.
ping() {
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  local suffix="${1:-}" body="${2:-}"
  curl -fsS -m 10 --retry 3 ${body:+--data-raw "$body"} "${BACKUP_PING_URL%/}${suffix:+/$suffix}" \
    >/dev/null 2>&1 || log "warning: could not reach BACKUP_PING_URL"
}

# Status is three small pieces (what Settings shows in the app), recomposed into one file after
# any change. Written atomically, since the app may read it at any moment.
# usage: set_status lastRun|lastSuccess|lastVerify '<json object>'
set_status() {
  mkdir -p "$STATUS_DIR"
  printf '%s\n' "$2" >"$STATUS_DIR/$1.json"
  local frag out=()
  for frag in lastRun lastSuccess lastVerify; do
    if [ -s "$STATUS_DIR/$frag.json" ]; then out+=("$(cat "$STATUS_DIR/$frag.json")"); else out+=(null); fi
  done
  printf '{"lastRun":%s,"lastSuccess":%s,"lastVerify":%s}\n' "${out[@]}" >"$STATUS_FILE.tmp"
  mv "$STATUS_FILE.tmp" "$STATUS_FILE"
}

# Record the outcome of one attempt.
# usage: record_run <lastRun|lastVerify> <ok:true|false> <error text or ''> [extra json fields, e.g. ',"entries":3']
record() {
  local key=$1 ok=$2 err=$3 extra=${4:-}
  local errj=null
  [ -z "$err" ] || errj=$(json_str "$err")
  set_status "$key" "{\"at\":$(now_ms),\"ok\":$ok,\"error\":$errj$extra}"
}
