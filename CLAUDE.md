# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Cairn is a self-hosted Day One-style journaling app for one person up to a family (about 10 users at most, with no cap). **[SPEC.md](SPEC.md) is the design record** for stack, phases, data model, and decisions; read the relevant section before building a feature. Version 1.0 holds Phases 0-8 (SPEC.md section 3 lists what each holds). Changes are recorded in [CHANGELOG.md](CHANGELOG.md) and released as in [docs/releasing.md](docs/releasing.md). Features and ideas: [docs/todo-and-ideas.md](docs/todo-and-ideas.md); bugs and tech debt: [docs/tech-debt.md](docs/tech-debt.md); things that won't be fixed (Day One incompatibilities): [docs/known-issues.md](docs/known-issues.md). Decisions made since the spec: npm workspaces (not pnpm), Node 24, timestamps as epoch-ms integers plus IANA timezone, data in the named Docker volume `cairn_data` (not a bind mount, so it also works under Docker Desktop on Windows), Watchtower pre-update snapshot hook not built (nightly backups plus the pre-migration snapshot cover it), the schema grows with its phases, drafts stay in localStorage, UI modelled on Day One and Pixel Journal (nav, list rows, Insights), Literata for entry text, WebP for photo derivatives.

Layout: `apps/web` (Vite + React SPA), `apps/server` (Hono API; in production also serves the built SPA), `packages/shared` (Zod schemas and constants; consumed as TS source by both apps). The server is bundled into one file with esbuild; native modules (better-sqlite3, @node-rs/argon2, sharp) must be marked `--external` in `apps/server/package.json`; the Dockerfile's `deps` stage installs them (with `--ignore-scripts`: they ship prebuilt binaries, and the slim image has no compiler). The `drizzle/` migrations folder is copied into the image and found via `MIGRATIONS_DIR`.

### Area notes

Each area's notes live in a `CLAUDE.md` beside its code (loaded when you work there). Some features span both apps, so **read the matching file before changing a feature, even from the other side**:

- `apps/server/CLAUDE.md`: server code map (repo layer, auth, migrations) and the API.
- `apps/server/src/`: `import/` (Day One importer), `search/` (FTS5), `photos/` (upload, attach, cleanup, plus the editor and reader side), `attachments/` (PDF/video/audio files), `places/` and `weather/` (Google APIs, plus the editor's place and weather chips), `export/`.
- `apps/web/CLAUDE.md`: theme, navigation, browse layout, data fetching, entry cards, map view.
- `apps/web/src/components/editor/CLAUDE.md`: the editor, drafts, toolbar, CodeMirror.
- `apps/web/src/lib/CLAUDE.md`: PWA and service worker (`public/sw.js`), local store, outbox, offline copies, sync and local reads.
- `backup/CLAUDE.md`: the backup sidecar.
- `e2e/CLAUDE.md`: Playwright e2e tests (guide in `docs/e2e-testing.md`).

When a change alters what an area note says, update that note in the same change.

## Commands

```
npm run dev                    # server (tsx watch, :3000) + Vite (proxies /api to :3000)
npm run dev:tailnet             # same, with Vite on all interfaces: open http://<tailnet IPv4>:5173 on a phone (plain http, no allowedHosts for names; Windows firewall may need an inbound rule)
npm run build                  # web, then server bundle
npm run typecheck              # tsc -b across all workspaces
npm run lint
npm test                       # vitest run; single test: npx vitest run path/to/file.test.ts -t "name"
npm run e2e                    # Playwright, local only (own server on :3200, fresh data); -- entry, --project=phone, -g "name"
npm run theme -w @cairn/web             # regenerate theme.css + theme-color metas after changing SEED in apps/web/src/theme/buildTheme.ts
npm run db:generate -w @cairn/server   # after editing apps/server/src/db/schema.ts; commit the new SQL, never edit an applied one
npm run db:migrate -w @cairn/server    # apply migrations to the dev DB (the server also does this at startup)
docker compose up -d --build   # local image + cairn_data volume, http://localhost:8086
```

```
npm run import:journal -- <export.zip|folder> [--user NAME] [--archived "Journal Name"]... [--force]
```

Imports into `DATA_DIR` (default `./data-dev`) as the only user, or `--user`. Idempotent on the Day One uuid; already-imported entries are skipped, never overwritten, including ones purged from the trash. `--force` imports a fresh copy of purged ones only (handy when re-importing the sample fixture into `data-dev`).

In production the same CLI is bundled next to the server (`import-journal.js`). `-` as the path reads the zip from stdin (spooled to `imports/` in the data dir, removed afterwards), so no `docker cp` or cleanup is needed. `scripts/import.sh Export.zip [--user NAME] [--archived "J"]... [--no-backup]` (from `cairn/` on the server) wraps it: `backup now` first (a failure stops the import), the import, then `backup now` and `verify`:

```
scripts/import.sh "export.zip" --user NAME
# by hand: docker exec -i cairn node import-journal.js - --user NAME < "export.zip"
```

`--user` is required once more than one user exists (with one, that user is the default). Back up first if the DB already holds real entries (never copy the live file; see Deploy and data safety); the script does it for you.

Forgot the password (no email, so this is the way back in): `docker exec -it cairn node reset-password.js <username>` asks for the new password twice without echoing it (or `echo "new password" | docker exec -i cairn node reset-password.js <username> --password-stdin`; never an argument). Same rules and hashing as the app (8 characters or more), and every session of that user ends. Dev: `npm run reset-password -w @cairn/server -- <username>`. Uses `DATA_DIR`.

No admin left (a hand-edited DB, an old restore): `docker exec cairn node make-admin.js <username>` makes that user an admin and re-enables them (dev: `npm run make-admin -w @cairn/server -- <username>`). The app itself never lets the last enabled admin go.

Config is env-only (see `.env.example`, loaded from the repo-root `.env` in dev and by compose). The dev DB lives in `./data-dev`. The first user (an admin) is created from `INITIAL_USERNAME`/`INITIAL_PASSWORD` only while the user table is empty; admins add the rest in Settings > Manage users.

Existing helpers: `scripts/make_sample_export.py` (generates `fixtures/sample-dayone-export.zip`), `scripts/build_icons.py MASTER.svg OUT_DIR` (regenerates the icon set from `assets/branding/icons/cairn.svg`; needs Pillow and Playwright).

A local image matches the machine that built it; CI builds the published linux/amd64 image. The maintainer's own setup (the home server, how it is reached, devices, the dev machine) is in `CLAUDE.local.md` when present; it is git-ignored, and none of it goes into tracked files.

## Architecture rules that span files

- **User-scoped from day one.** Every user-owned table has an indexed `user_id`. Roles (`user`/`admin`) gate server-wide settings and Manage users only; an admin has no route to another user's content. All data access goes through a repository/service layer that takes the authenticated `userId` and always filters by it; route handlers never query tables directly. Needs a test that user A cannot read, edit, or search user B's journals, entries, photos, or drafts, admins included. No signup or sharing UI; admins add users.
- **Sync-ready schema (SPEC 4d).** Client-generated UUIDs (v7), `created_at`/`updated_at`/`deleted_at` tombstones (all queries and FTS exclude deleted rows; a deleted entry or journal sits in the trash until `purged_at`, and purging scrubs but never removes the row), server-assigned monotonic `rev`, idempotent writes via client mutation id, `base_rev` optimistic concurrency that keeps both versions rather than overwriting text.
- **Time:** store UTC plus the entry's own IANA timezone; always display in the entry's stored timezone, never the viewer's.
- **Paths:** all file references are relative to the data dir (`/data` in the container), never absolute. Photos live at `data/photos/<user_id>/...` and are served only through authenticated routes with an ownership check.
- **Zod in `packages/shared` is the source of truth** for API types, and also holds the mood emoji map and the canonical weather-condition enum with its Day One and Google mapping tables.
- **Mood** is stored as integer 1-5 (never an emoji); null means unrated and must be excluded from averages. Imported Day One entries have null mood. `mood_suggested` must never be written into `mood` automatically.
- **Day One import** is idempotent on `(user_id, source_id)` (the Day One `uuid`), keeps the raw entry JSON in `source_raw`, rewrites `dayone-moment://` photo placeholders, and never gets overwritten by automatic weather fetches. The export format is in [docs/dayone-export-format.md](docs/dayone-export-format.md).
- **Attachments** (PDF, MP4/MOV, M4A) follow the photo rules (text reference attaches them, files by sha256, ownership-checked route) but have no derivatives; uploads are streamed raw (`PUT`), never buffered.
- **Photos:** the original is kept untouched, or compressed when the admin's photo quality setting says so (`photos/quality.ts` `storeOriginal`, the only place an original is written; SPEC section 7); never modify a stored original anywhere else; generate display (~2048px) and thumb (~400px) derivatives; extract EXIF date/GPS before stripping; dedupe by sha256; one file per upload request (Cloudflare 100MB limit).
- **Google APIs (Places, Weather) are called from the backend only.** Weather and mood suggestion run in the background and never block saving.
- Sanitize rendered markdown (including imported content); CSP and security headers are set in `app.ts` (`secureHeaders`; no inline scripts, styles allow `'unsafe-inline'` for CodeMirror, so a new external origin needs a CSP change); origin check plus SameSite for CSRF.

## Deploy and data safety

- CI (GitHub Actions) runs typecheck, lint, and tests; merge to `main` builds linux/amd64 and pushes `ghcr.io/<owner>/cairn:latest` and `:<sha>`. Watchtower on the home server auto-updates only containers with the opt-in label, and does not roll back.
- Dockerfile: multi-stage on Debian slim (not Alpine, for `sharp`/`better-sqlite3` glibc prebuilds), non-root, `HEALTHCHECK` on `/api/health`, git SHA baked in via build arg and exposed in `/api/health`.
- Migrations are forward-only, each in a transaction, run at startup; the app exits if one fails. Take a `VACUUM INTO` snapshot to `/data/backups/pre-migrate-<ts>.db` before applying pending migrations. Never edit an applied migration.
- Never copy the live SQLite file for backups; use `.backup` or `VACUUM INTO`.
- Do heavy installs/builds on a development machine or in CI, not on the production server. Dev uses `./data-dev` (git-ignored), never the production DB. Prefer WSL2/devcontainer so native modules match production.

## Conventions

- TypeScript strict; no `any` without a comment. Keep dependencies lean and justify each addition. Prefer boring solutions.
- **Reuse before you write UI.** The web app's shared pieces are listed in `apps/web/CLAUDE.md` ("Shared pieces to reach for", "Dialogs, menus and buttons", "Journal colours"). Use them instead of copying markup, class strings or small helpers. When you are about to write the same markup or helper a second time, extract it (a component with a one-line doc comment, or a helper in `lib/`) and add it to that list in the same change. Don't stretch a component to fit something that only looks similar; [docs/design/component-reuse-proposal.md](docs/design/component-reuse-proposal.md) has the reasoning.
- Branches, versions and releases follow [docs/releasing.md](docs/releasing.md): `main` is always green; small changes go straight to it, bigger ones on a short-lived branch (PR optional); squash or rebase, never a merge commit. A user-visible change adds a line under Unreleased in `CHANGELOG.md`. A migration means at least a minor version.
- **At the end of each feature or phase (and whenever user-visible behaviour changes), check whether `README.md` needs updating**: its Features list (working vs coming), Roadmap checkboxes, commands, and setup steps. Update it in the same branch, along with this file's Status and SPEC.md's phase notes.
- **Bugs and tech debt** are logged in [docs/tech-debt.md](docs/tech-debt.md); features and ideas in [docs/todo-and-ideas.md](docs/todo-and-ideas.md), whose finished items move to [docs/todo-completed.md](docs/todo-completed.md). Before changing a component or area, search tech-debt.md for it and fix the related items if they are cheap or sit in the code you are already editing; delete an entry when it is fixed, and log new bugs and small issues there instead of leaving them in your head.
- Real tests for the importer and photo pipeline; UI tests only for non-trivial logic. Playwright e2e (`npm run e2e`) covers the main flows at phone and desktop widths; run it before calling a change to one of them done (not in CI).
- UI: shadcn/ui + Tailwind with Material 3 tokens generated from a single seed (`@material/material-color-utilities`, seed approx `#7B7B45`), phone-first, check light and dark (the `verify-ui` skill runs a private instance for this). Logo is hand-written SVG (`cairn-d-small`); do not auto-trace photos.
- **Never commit real Day One exports or photos.** `data/`, `data-dev/`, `*.zip` (except the scrubbed sample fixture) and `fixtures/private/` are git-ignored. Test fixtures must be scrubbed.
- **Real data:** don't import or bulk-change real data without a fresh backup first.
