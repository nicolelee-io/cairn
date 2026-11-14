# Changelog

All notable changes to Cairn are listed here, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/) as described in [docs/releasing.md](docs/releasing.md):
a minor release can include a database migration, a major one needs you to act when you upgrade.

## [Unreleased]

## [1.0.0] - 2026-11-14

The first public release.

### Writing and reading

- Markdown entries in a CodeMirror editor that styles the text as you write, with a formatting
  toolbar (above the keyboard on a phone), a source view, zen mode, slash commands, templates and
  an optional word count. The entry font and text size are set per device.
- Moods (14), pin and star, tags, and a date, time and timezone per entry. Entries are always shown
  in their own timezone.
- Drafts autosaved on the device, so a closed tab or a dropped connection never loses text.
- Photos (JPEG, PNG, WebP, GIF, AVIF, TIFF) from the picker, paste or drop, shown inline and in a
  lightbox; PDF, video and audio attachments.
- Places from your location, a search, a photo's GPS (with a Google API key) or a name of your own,
  and weather fetched in the background (Open-Meteo by default, no key needed; Google Weather
  optional, last 24 hours only).

### Browsing

- Journals with colours and icons, archiving and a default journal.
- A timeline beside the reader on wide screens, plus Calendar, Media and Map views and a Details
  view per journal.
- Full-text search (SQLite FTS5) with filters for journal, tag, mood, a date range, starred and attachments.
- Insights: stats and streaks (the streaks can be hidden in Settings), a mood calendar and On
  this day.
- Writing prompts: daily prompts from your own list, categories, and suggested prompts kept by an admin.
- Keyboard shortcuts and a command palette, context menus, and touch gestures, with a Tips &
  tricks page listing the ones that work on your device.
- A trash for deleted entries and journals, kept for 60 days by default.

### Your data

- Import from Day One (JSON export) or from Cairn's own export, in Settings or from the command
  line, idempotent on Day One's ids.
- Export to a Day One-compatible zip, for everything, one journal or one entry, with or without
  photos and files.
- An optional backup container: nightly, encrypted [restic](https://restic.net) backups to
  Cloudflare R2, B2, S3, SFTP, Google Drive or a folder, with restore and test restore.
- Storage usage per account and journal, a daily cleanup of unused files, and optional photo
  compression.

### Running it

- One Docker image (`linux/amd64`), SQLite and files in one volume; migrations run at startup
  after a snapshot.
- Installable as an app. Recently read entries, and whole journals you choose to keep, work
  offline; saves and most changes made offline are sent when the server answers.
- Several users with User and Admin roles; admins manage accounts and server settings but can't
  see anyone else's journals.
- Argon2id passwords, server-side sessions, CSRF checks, a CSP, and login rate limiting
  (`TRUST_PROXY` for reverse proxies).
- Server alerts through ntfy, and a notice in the app when the server has been updated.

[Unreleased]: https://github.com/nicolelee-io/cairn/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/nicolelee-io/cairn/releases/tag/v1.0.0
