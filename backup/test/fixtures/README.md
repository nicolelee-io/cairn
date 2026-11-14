`backup-status.json` as the scripts write it (`set_status` in `lib.sh`), shared by both sides: `backup/test/run.sh` checks the scripts still write files of this shape (same keys, same JSON types), and `apps/server/src/backup/status.test.ts` checks the app reads them. Change the format here first, then both tests show what else has to follow.

- `status-ok.json`: a successful backup and test restore.
- `status-failing.json`: a failed run after an earlier success.
