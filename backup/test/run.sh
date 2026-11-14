#!/usr/bin/env bash
# Tests the backup scripts against stand-ins for restic, sqlite3 and curl (test/stubs), so they
# check the scripts' own behaviour: status files, pings, failure handling, restore layout. They
# say nothing about restic itself; for that, run the real thing (docs/backup.md, "Test it").
# usage: backup/test/run.sh
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
CLI="$HERE/../cairn-backup"
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
check() { local d=$1; shift; if "$@"; then ok "$d"; else bad "$d"; fi; }
has() { grep -q -- "$1" "$2"; }

# A fresh world: a data dir with a small real database and photos, an empty "repository".
fresh() {
  W=$(mktemp -d)
  export DATA_DIR="$W/data" RESTIC_REPOSITORY="$W/repo" RESTIC_PASSWORD=pw
  export CAIRN_BACKUP_STAGE="$W/stage" FAKE_CURL_LOG="$W/curl.log" BACKUP_PING_URL=https://ping.test/uuid
  export PATH="$HERE/stubs:$PATH"
  unset FAKE_RESTIC_FAIL FAKE_INTEGRITY FAKE_CURL_FAIL BACKUP_TIME
  mkdir -p "$DATA_DIR/photos/u/originals" "$DATA_DIR/photos/u/thumb"
  echo original >"$DATA_DIR/photos/u/originals/a.jpg"
  echo thumb >"$DATA_DIR/photos/u/thumb/a.webp"
  mkdir -p "$DATA_DIR/attachments/u"
  echo video >"$DATA_DIR/attachments/u/b.mp4"
  python3 -I - "$DATA_DIR/cairn.db" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.executescript("""
create table journal(id, deleted_at);
create table entry(id, deleted_at);
create table photo(original_path, display_path, thumb_path, deleted_at);
create table attachment(path, deleted_at);
insert into journal values ('j', null);
insert into entry values ('e1', null), ('e2', null), ('gone', 5);
insert into photo values ('photos/u/originals/a.jpg', null, 'photos/u/thumb/a.webp', null);
insert into attachment values ('attachments/u/b.mp4', null), ('attachments/u/old.pdf', 5);
""")
c.commit()
PY
  STATUS="$DATA_DIR/backups/backup-status.json"
}
json_ok() { python3 -I -c 'import json,sys; json.load(open(sys.argv[1]))' "$1"; }
field() { python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); v=d
for k in sys.argv[2].split("."):
    v=v[k] if v is not None else None
print("" if v is None else v)' "$STATUS" "$1"; }
quiet() { "$@" >"$W/out.log" 2>&1; }
# The status file has the same keys, with the same JSON types, as a fixture in test/fixtures, which
# apps/server/src/backup/status.test.ts reads too: the shared contract between the two sides.
same_shape() { python3 -I - "$STATUS" "$HERE/fixtures/$1" <<'PY'
import json, sys
def shape(v, path=""):
    if isinstance(v, dict):
        return {k2: t for k, x in v.items() for k2, t in shape(x, f"{path}.{k}").items()}
    return {path: type(v).__name__}
got, want = (shape(json.load(open(f))) for f in sys.argv[1:3])
if got != want:
    for k in sorted(set(got) | set(want)):
        if got.get(k) != want.get(k):
            print(f"    {k}: wrote {got.get(k)}, fixture has {want.get(k)}")
    sys.exit(1)
PY
}

echo "init and a first backup"
fresh
check "init creates the repository" quiet "$CLI" init
check "now succeeds" quiet "$CLI" now
check "status file is valid JSON" json_ok "$STATUS"
check "lastRun ok" test "$(field lastRun.ok)" = True
snap=$(field lastSuccess.snapshotId)
check "lastSuccess has an 8-character snapshot id" test "${#snap}" -eq 8
check "and the bytes added" test "$(field lastSuccess.bytesAdded)" = 4242
check "the DB snapshot and the photos are in the snapshot" bash -c "
  s=\$(ls -t '$RESTIC_REPOSITORY/snaps' | head -1)
  test -f '$RESTIC_REPOSITORY/snaps/'\$s'$CAIRN_BACKUP_STAGE/cairn.db' && test -f '$RESTIC_REPOSITORY/snaps/'\$s'$DATA_DIR/photos/u/originals/a.jpg'"
check "and the attachments" bash -c "
  s=\$(ls -t '$RESTIC_REPOSITORY/snaps' | head -1)
  test -f '$RESTIC_REPOSITORY/snaps/'\$s'$DATA_DIR/attachments/u/b.mp4'"
check "the staging copy is cleaned up" test ! -e "$CAIRN_BACKUP_STAGE"
check "pings start, then success" bash -c "head -1 '$FAKE_CURL_LOG' | grep -q 'ping.test/uuid/start' && tail -1 '$FAKE_CURL_LOG' | grep -q 'ping.test/uuid\$\| ping.test/uuid '"
check "no /fail ping" bash -c "! grep -q '/fail' '$FAKE_CURL_LOG'"

echo "before init (the usual first mistake)"
fresh
check "now fails" bash -c "! '$CLI' now >'$W/out.log' 2>&1"
check "status says failed, and what to do" bash -c "json_ok() { :; }; grep -q '\"ok\":false' '$STATUS' && grep -q 'cairn-backup init' '$STATUS'"
check "pings /fail with the reason" bash -c "grep -q 'ping.test/uuid/fail' '$FAKE_CURL_LOG' && grep -q 'cairn-backup init' '$FAKE_CURL_LOG'"
check "status is valid JSON" json_ok "$STATUS"

echo "a failure after a success keeps the last success"
fresh
quiet "$CLI" init
quiet "$CLI" now
good=$(field lastSuccess.snapshotId)
quiet "$CLI" verify
export FAKE_RESTIC_FAIL=backup
check "now fails" bash -c "! '$CLI' now >'$W/out.log' 2>&1"
err=$(field lastRun.error)
check "lastRun not ok, with restic's message (quotes and backslashes survive)" bash -c '[[ "$1" == *"Fatal: backup failed on purpose (\"quoted\" and \\ backslash)"* ]]' _ "$err"
check "status is valid JSON" json_ok "$STATUS"
check "lastSuccess still the earlier one" test "$(field lastSuccess.snapshotId)" = "$good"
check "status has the shape of fixtures/status-failing.json" same_shape status-failing.json
unset FAKE_RESTIC_FAIL
quiet "$CLI" now
check "recovers on the next run" test "$(field lastRun.ok)" = True

echo "a database that fails its integrity check is not backed up"
fresh
quiet "$CLI" init
export FAKE_INTEGRITY=bad
check "now fails" bash -c "! '$CLI' now >'$W/out.log' 2>&1"
check "says why" has "integrity" "$STATUS"
check "nothing was added to the repository" test -z "$(ls "$RESTIC_REPOSITORY/snaps")"

echo "no database"
fresh
quiet "$CLI" init
rm "$DATA_DIR/cairn.db"
check "now fails and names the problem" bash -c "! '$CLI' now >'$W/out.log' 2>&1 && grep -q 'no database' '$STATUS'"

echo "configuration mistakes"
fresh
export BACKUP_TIME=25:99
check "a bad BACKUP_TIME is reported" bash -c "! '$CLI' now >'$W/out.log' 2>&1 && grep -q 'BACKUP_TIME' '$STATUS'"
fresh
unset RESTIC_PASSWORD
check "no password is reported" bash -c "! '$CLI' now >'$W/out.log' 2>&1 && grep -q 'RESTIC_PASSWORD' '$STATUS'"
fresh
unset BACKUP_PING_URL
quiet "$CLI" init
check "works without a ping URL" quiet "$CLI" now
check "and makes no ping calls" test ! -e "$FAKE_CURL_LOG"
fresh
quiet "$CLI" init
export FAKE_CURL_FAIL=1
check "a ping that can't be reached doesn't fail the backup" quiet "$CLI" now

echo "test restore (verify)"
fresh
quiet "$CLI" init
quiet "$CLI" now
check "passes on a good backup" quiet "$CLI" verify
check "records it" test "$(field lastVerify.ok)" = True
check "with the entry count (2, not the deleted one)" test "$(field lastVerify.entries)" = 2
check "the backup status is still there" test "$(field lastRun.ok)" = True
check "status has the shape of fixtures/status-ok.json" same_shape status-ok.json
s=$(ls -t "$RESTIC_REPOSITORY/snaps" | head -1)
rm "$RESTIC_REPOSITORY/snaps/$s$DATA_DIR/photos/u/originals/a.jpg"
check "fails when a photo file is missing from the backup" bash -c "! '$CLI' verify >'$W/out.log' 2>&1"
check "and says which kind of thing is wrong" has "attachment file(s)" "$STATUS"
check "status is valid JSON" json_ok "$STATUS"
fresh
quiet "$CLI" init
quiet "$CLI" now
s=$(ls -t "$RESTIC_REPOSITORY/snaps" | head -1)
rm "$RESTIC_REPOSITORY/snaps/$s$DATA_DIR/attachments/u/b.mp4"
check "fails when an attachment file is missing from the backup" bash -c "! '$CLI' verify >'$W/out.log' 2>&1"
check "and names it" has "attachments/u/b.mp4" "$STATUS"
fresh
sqlite3 "$DATA_DIR/cairn.db" 'drop table attachment'
rm -r "$DATA_DIR/attachments"
quiet "$CLI" init
quiet "$CLI" now
check "passes on a database from before attachments existed" quiet "$CLI" verify
fresh
check "fails when there is no backup at all" bash -c "! '$CLI' verify >'$W/out.log' 2>&1"

echo "restore"
fresh
quiet "$CLI" init
quiet "$CLI" now
T="$W/restored"
check "restores into an empty directory" quiet "$CLI" restore "$T"
check "as a Cairn data dir: database, photos and attachments" bash -c "test -f '$T/cairn.db' && test -f '$T/photos/u/originals/a.jpg' && test -f '$T/photos/u/thumb/a.webp' && test -f '$T/attachments/u/b.mp4'"
check "with the rows intact" test "$(sqlite3 "$T/cairn.db" 'select count(*) from entry where deleted_at is null')" = 2
check "no scratch left behind" test ! -e "$T/.restore"
check "refuses a directory that has files" bash -c "! '$CLI' restore '$T' >'$W/out.log' 2>&1"
check "refuses the live data directory" bash -c "! '$CLI' restore '$DATA_DIR' >'$W/out.log' 2>&1 && grep -q 'live data' '$W/out.log'"
check "needs a directory argument" bash -c "! '$CLI' restore >'$W/out.log' 2>&1"
id=$(ls "$RESTIC_REPOSITORY/snaps" | head -1)
check "restores a given snapshot id" quiet "$CLI" restore "$W/byid" "$id"

echo "schedule"
fresh
source "$HERE/../lib.sh"
secs=$(bash -c "source '$HERE/../lib.sh'; $(sed -n '/^seconds_until()/,/^}/p' "$CLI"); seconds_until 03:00")
check "next run is within a day" bash -c "[ $secs -ge 1 ] && [ $secs -le 86400 ]"
secs=$(bash -c "$(sed -n '/^seconds_until()/,/^}/p' "$CLI"); seconds_until $(date -d '+2 minutes' +%H:%M)")
check "a time two minutes ahead is a couple of minutes away" bash -c "[ $secs -ge 1 ] && [ $secs -le 180 ]"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
