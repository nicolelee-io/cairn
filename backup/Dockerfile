# syntax=docker/dockerfile:1
# The backup sidecar: restic over Cairn's database, photos and attachments. See docs/backup.md.
# Pinned to the Alpine release whose restic (0.18.1) the scripts were checked against; bump it
# together with re-running the manual checks in backup/CLAUDE.md.
FROM alpine:3.24
# restic does the backups and rclone lets it reach Google Drive and many other places. sqlite
# makes the consistent copy of the database. bash and coreutils are for the scripts (arrays, GNU
# date); curl sends the success/failure ping; tzdata makes TZ work.
RUN apk add --no-cache bash coreutils curl restic rclone sqlite tzdata ca-certificates \
 && adduser -D -u 1000 backup
COPY lib.sh backup.sh verify.sh restore.sh cairn-backup /opt/cairn-backup/
RUN chmod +x /opt/cairn-backup/cairn-backup \
 && ln -s /opt/cairn-backup/cairn-backup /usr/local/bin/cairn-backup
# uid 1000 is the `node` user the app runs as, so the files here and in /data belong to one
# user. SQLite's backup needs write access to the database's -shm file, even to read it.
USER backup
ENV DATA_DIR=/data \
    RESTIC_CACHE_DIR=/tmp/restic-cache
ENTRYPOINT ["cairn-backup"]
CMD ["run"]
