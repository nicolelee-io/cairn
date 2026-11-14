# Backups

Cairn's data is one SQLite database plus folders of photos and attachments (PDFs, videos, audio), all in the `cairn_data` volume. The **backup container** copies them every night into an encrypted [restic](https://restic.net) repository somewhere else, keeps a rolling history, and reports back to Settings. An export (Settings > Export) is a different thing: a readable copy you can open or import elsewhere. A backup is for disaster recovery: restoring the whole instance, exactly as it was.

The backup container is optional and separate from the app. It is configured with environment variables only, and restic can write to many places, so you choose where:

| Where                                | `RESTIC_REPOSITORY`                                         |
| ------------------------------------ | ----------------------------------------------------------- |
| Cloudflare R2                        | `s3:https://<account id>.r2.cloudflarestorage.com/<bucket>` |
| Backblaze B2, AWS S3, MinIO, Wasabi… | `s3:https://<endpoint>/<bucket>` or `b2:<bucket>:<path>`    |
| SFTP                                 | `sftp:user@host:/path`                                      |
| Google Drive (and others) via rclone | `rclone:<remote>:<path>`                                    |
| A folder on this machine or a drive  | `/backups` (mount it into the container)                    |

Everything is encrypted on this machine before it leaves: the place you store it only ever sees ciphertext.

## What a backup contains

- A consistent copy of `cairn.db`, made with SQLite's own backup (never a copy of the live file), and checked with `PRAGMA integrity_check` before it is stored. It includes accounts, the Google API key saved in Settings, and everything else in the database.
- Everything in `photos/` (originals and the WebP copies made from them, plus profile pictures) and `attachments/` (PDFs, videos and audio). Files there never change once written, so reading them while Cairn runs is safe. Identical files are stored once, and each night only what is new is uploaded. (Before November 2026 the backup left `attachments/` out; the first run after updating uploads all of it.)

Not included: `backups/` (the pre-migration database snapshots Cairn makes before an upgrade, and this container's status files), and `.env` files. Keep your own copy of those, and of the restic password.

## Set it up

### 1. A place to put it (Cloudflare R2 as the example)

R2 has no egress fees, and a free allowance that a journal will not come near for a long time (check Cloudflare's current limits).

```bash
cf r2 buckets create-by-name cairn-backup
```

Then, in the Cloudflare dashboard, R2 > Manage API tokens: create a token with **Object Read & Write**, limited to that bucket. Keep the **Access Key ID** and **Secret Access Key** it shows (you see the secret once). Your **account id** is on the R2 overview page. These are long-lived keys, unlike `cf r2 temporary-credentials`.

### 2. Configure

```bash
cp .env.backup.example .env.backup
```

Fill in `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` (choose a long random one), `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. `.env.backup` is only read by the backup container, and is git-ignored.

**Save the restic password somewhere that is not this machine, such as a password manager.** There is no recovery: lose it and every backup is unreadable.

### 3. Start it

```bash
docker compose --profile backup run --rm backup init     # once: creates the repository
docker compose --profile backup run --rm backup now      # a first backup, now, to see it work
docker compose --profile backup up -d                    # then daily at BACKUP_TIME
```

On a deployment that pulls the images, add the `backup` service from this repo's `docker-compose.yml` to it: the image is `ghcr.io/nicolelee-io/cairn-backup:1` (same tags as the app, see [deployment.md](deployment.md#quick-start)), built by CI next to the app. It must mount the **same named volume** as the app (`cairn_data:/data`), not a bind mount. SQLite's backup reads the live database through the volume, and the two containers have to share its shared-memory file properly.

After the first backup, Settings > Backups shows "Last backup … ago". If it still says nothing has reported, look at `docker logs cairn-backup`.

### 4. Do a test restore

Do this before you trust it, and now and then afterwards:

```bash
docker compose --profile backup run --rm backup verify
```

This restores the database from the latest backup into a scratch folder and checks that it is a working Cairn: it passes SQLite's integrity check, and every photo and attachment file it refers to is in the backup (checked against restic's file list, so the files are not downloaded). The result shows in Settings. `verify full` also reads every byte in the repository, which is slow and downloads everything; once a quarter is plenty.

## Day to day

| Command (after `docker compose --profile backup run --rm backup`) | Does                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `now`                                                             | back up right now                                        |
| `snapshots`                                                       | list the backups                                         |
| `verify` / `verify full`                                          | the test restore above                                   |
| `restore <empty dir> [snapshot id]`                               | restore into an empty directory (below)                  |
| `restic <anything>`                                               | run restic with this configuration (`restic ls latest`…) |

Settings > Backups turns red if the last attempt failed (with the reason), or if there has been no success for 36 hours. For an alert you hear without opening Cairn, set `BACKUP_PING_URL` to a [healthchecks.io](https://healthchecks.io)-style check: it is pinged on success, at `/fail` on failure (with the reason), and at `/start` when a run begins, so a night that never happens is noticed too.

Retention is the newest backup of each of the last 7 days, 4 weeks and 12 months (`BACKUP_KEEP_*`). Each night restic also reads about 1% of the stored data to prove it is readable (`BACKUP_CHECK_SUBSET`; empty to check structure only).

## Restoring

A restore never touches the live data. It writes a complete Cairn data folder (`cairn.db`, `photos/` and `attachments/`) into an **empty** directory:

```bash
docker compose --profile backup run --rm -v cairn_restored:/restore backup restore /restore
```

To bring Cairn back with it, stop the app and copy the folder over its data volume. On a brand-new machine with an empty `cairn_data` volume, restore straight into it:

```bash
docker compose --profile backup run --rm -v cairn_data:/restore backup restore /restore
docker compose up -d
```

Cairn applies any newer migrations itself when it starts. For an older snapshot, add its id: `restore /restore 1a2b3c4d` (ids are in `snapshots`). With only a new machine and the repository details: install Docker, put your `.env.backup` back, and the lines above are the whole procedure. If you have restic installed, `restic -r <repository> restore latest --target <dir>` also works, and puts the files under `<dir>/tmp/stage/cairn.db`, `<dir>/data/photos` and `<dir>/data/attachments`.

## Other places

Anything restic supports works: put its settings in `.env.backup` (see the [restic docs](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)).

- **Backblaze B2 / AWS S3 / MinIO:** an `s3:` or `b2:` repository, with the matching `AWS_*` or `B2_ACCOUNT_ID`/`B2_ACCOUNT_KEY` variables.
- **SFTP:** `sftp:user@host:/path`; mount an SSH key and config into the container.
- **A local folder:** `RESTIC_REPOSITORY=/backups`, and add `- /path/on/host:/backups` to the service's `volumes`. The container runs as uid 1000, so the folder must be writable by it (`chown 1000:1000` it, or a named volume `chown`ed once). This is the "write an encrypted copy somewhere I sync myself" option, but a backup on the same disk as the data protects against less.
- **Google Drive:** through rclone, which restic drives for you. Use your **own OAuth client** (Google Cloud console, Drive API) and publish its consent screen to **Production**: in Testing mode the refresh token expires after 7 days and the backups quietly stop. Make the token on a machine with a browser (`rclone authorize "drive" "<client id>" "<client secret>"`), then define the remote with variables in `.env.backup`:

  ```
  RESTIC_REPOSITORY=rclone:gdrive:cairn-backup
  RCLONE_CONFIG_GDRIVE_TYPE=drive
  RCLONE_CONFIG_GDRIVE_CLIENT_ID=...
  RCLONE_CONFIG_GDRIVE_CLIENT_SECRET=...
  RCLONE_CONFIG_GDRIVE_SCOPE=drive
  RCLONE_CONFIG_GDRIVE_TOKEN={"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}
  ```

  Drive has request and bandwidth limits that make `verify full` and large first uploads slow; R2 or B2 are easier for a large photo library.

## Troubleshooting

- **`error getting credentials … A specified logon session does not exist` on `docker compose pull` (Windows):** Docker's credential helper keeps registry logins in Windows Credential Manager, which a session without a real logon (an SSH session) cannot read. Run the pull from the machine's desktop (RDP or local), or in the SSH session point `DOCKER_CONFIG` at a folder whose `config.json` is `{"credsStore":""}` and `docker login` there. Once the image is pulled, running it doesn't need a login.
- **Settings says "No backup has reported in yet" after starting it:** the container hasn't finished a run. `docker logs cairn-backup` shows why. A repository or password mistake is reported as "setup problem" in Settings.
- **`permission denied` creating a local-folder repository:** the folder must be writable by uid 1000 (see "Other places").

## How it works, and what is tested

`backup/` is a small Alpine image: restic, rclone, the SQLite command line, and the shell scripts in this folder (`cairn-backup` is the entry point; `backup.sh`, `verify.sh`, `restore.sh` and `lib.sh` are what it runs). It runs as uid 1000, the same user as the app, so the files it writes in the data volume belong to the same owner. It writes `backups/backup-status.json` in the data volume, which the app reads (`GET /api/backup/status`, shown in Settings). The app never sees the repository address or any credential: the status holds only times, a snapshot id and error text.

`backup/test/run.sh` (also run in CI) tests the scripts against stand-ins for restic, sqlite3 and curl: status files, pings, failures, `verify`, `restore`'s layout and its refusals. It does not test restic itself. The commands in "Set it up" and "Do a test restore", against a real repository, do (they were run by hand against restic 0.18.1 and a local repository, including losing a photo file, which `verify` caught).

Snapshots are stored under a fixed host name (`cairn`) and tag, whatever the container is called, so history and retention stay together if it is recreated.
