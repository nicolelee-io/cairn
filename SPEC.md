# Cairn: project spec

**Cairn** is a lightweight, self-hosted journaling web app in the spirit of Day One, compatible with its export format, for one person up to a family. It runs as one Docker container and is used from phone, tablet and laptop browsers. The design goals as they stand now are in the README; this file records how they were planned.

> This is the design record: the goals, the decisions and why, and how the app was built up in phases (1.0 shipped with all of them). It was written as the plan before any code existed and kept up to date since, so some sections read as instructions. How the built code works is in `CLAUDE.md` (the root one, plus one beside each area's code); bugs and tech debt are in `docs/tech-debt.md`, features and ideas in `docs/todo-and-ideas.md`, design proposals for larger features in `docs/design/`.

---

## 1. Goals and non-goals

**Goals**
- Fast, pleasant writing experience, especially on a phone.
- Multiple journals, entries with photos and location.
- Import my existing Day One export without losing data.
- My data stays mine: SQLite + plain files on disk, full export at any time, encrypted off-site backups.

**Non-goals (for now)**
- Social and sharing features: signup, invites, shared journals. Several users can share a server (an admin adds them, Phase 8), each with their own journals; the schema and data access were user-scoped from day one so that needed no rewrite (see section 4).
- Per-journal encryption at rest (the server is at home; the off-site backup is what gets encrypted).
- Drawings. (Streaks, writing prompts and entry templates were built in Phase 8; see there.)
- Drafts that follow you between devices (drafts stay on the device; see Phase 7).

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Vite + React + TypeScript SPA | No SSR needed |
| UI | shadcn/ui-style primitives + Tailwind, themed to Material 3 | Material You look via generated theme tokens (section 6a); native `<dialog>` for drawers and dialogs |
| Data fetching | TanStack Query | |
| Routing | React Router | |
| Editor | CodeMirror 6 | Live preview in place (Phase 4b) |
| Backend | Node + TypeScript, Hono | Serves the API and the built SPA |
| DB | SQLite via better-sqlite3 + Drizzle | WAL mode, FTS5 for search |
| Images | sharp | Thumbnails, resize, EXIF handling |
| Validation / shared types | Zod, shared package | Same schemas on FE and BE |
| Maps | Leaflet with OpenStreetMap tiles | Display only (decision 2) |
| Place lookup | Google Places API (New), Geocoding | Called from the backend only; optional (needs a key) |
| Weather | Open-Meteo by default, Google Weather optional | Called from the backend only (section 4c) |
| Offline | Hand-written service worker, Dexie (IndexedDB) | Phase 7 |
| Deploy | Single Docker container, named volume `cairn_data` | Behind any https proxy or tunnel (docs/deployment.md) |
| Backup | restic sidecar container, Cloudflare R2 by default | Client-side encrypted (docs/backup.md) |

Layout (npm workspaces): `apps/web`, `apps/server`, `packages/shared`, `backup/`, `docs/`, `scripts/`.

---

## 2a. Build, deploy and dev workflow

GitHub Actions builds the image, and Watchtower on the home server pulls it and restarts the container.

**Pipeline**
- PRs and pushes: CI runs typecheck, lint and tests. Nothing deploys unless CI passes.
- Push to `main`: CI builds the image (linux/amd64) and pushes to GHCR as `ghcr.io/<owner>/cairn:latest` and `:<git-sha>`, with buildx and the GitHub Actions layer cache. A `v*` tag also publishes `:1.2.3`, `:1.2` and `:1` and a GitHub Release ([docs/releasing.md](docs/releasing.md) has the versioning rules).
- The home server: Watchtower polls GHCR and updates **only** containers carrying the opt-in label (so the other services on the server are never touched by accident). It follows `:latest`, so the maintainer's own server tries every change before a release.

**Image**
- Multi-stage Dockerfile on a Debian slim Node base (not Alpine), so `sharp` and `better-sqlite3` use standard glibc prebuilt binaries.
- Runs as a non-root user; data dir mounted at `/data`.
- Bake the git SHA in as a build arg and expose it in `/api/health` and the settings/about screen, so I can always tell what is deployed.
- Docker `HEALTHCHECK` on `/api/health`.

**Auto-deploy safety** (this app holds irreplaceable data and Watchtower does not roll back)
- Migrations run at startup, forward-only, each in a transaction. If a migration fails the app exits instead of starting half-migrated.
- Before applying any pending migration, take a SQLite snapshot into `/data/backups/pre-migrate-<timestamp>.db` (`VACUUM INTO`) and keep the last few.
- Not built, on purpose: a Watchtower pre-update snapshot hook. Nightly backups plus the pre-migration snapshot cover it; revisit if an update ever damages data without a migration.
- If auto-deploying `:latest` ever feels risky, follow `:1` instead, which only moves on a release.

**Config and secrets**
- Runtime config via env vars from a `.env` file beside the compose file (never in the image or repo): initial user credentials, `TRUST_PROXY`, the Google API key. `.env.example` lists them; [docs/deployment.md](docs/deployment.md) explains each.
- CI only needs the built-in `GITHUB_TOKEN` to push to GHCR.

**Local development**
- Develop in WSL2 or a devcontainer (Linux) so native modules match production and don't depend on platform-specific prebuilt binaries.
- Dev uses its own data dir (`./data-dev`, git-ignored) seeded from `fixtures/sample-dayone-export.zip`. Never develop against the production database.
- Production images are built by CI, not locally; a local `docker build` on an ARM machine produces an arm64 image unless `--platform linux/amd64` is passed.
- Avoid heavy installs and builds on a server that also runs other services; build on a development machine or in CI.

---

## 3. Phases

Built in vertical slices, each phase ending working, committed and tested where noted. All of them shipped in 1.0; what comes next is in [docs/todo-and-ideas.md](docs/todo-and-ideas.md).

> **Gate (cleared 2026-10-30):** no real entries went into the app until Phase 6 (export and encrypted off-site backup) was done **and a test restore had succeeded**. Keep a fresh backup before any big import.

### Built (Phases 0-7)

- **0 Scaffold:** npm workspaces, Docker image, CI publishing to GHCR, Watchtower deploying to the home server.
- **1 Auth and data model:** one user seeded from env, argon2id, opaque session cookie, login rate limiting, Drizzle migrations at startup.
- **2 Day One importer:** CLI (`import:journal`, shipped in the image), idempotent on the Day One `uuid`, `--archived` per journal, raw entry JSON kept, a report of anything unmapped. Verified against the real export ([docs/dayone-export-format.md](docs/dayone-export-format.md)). The photo pipeline was pulled forward into this phase.
- **3 Core UI:** journals (archived = hidden by default, read-only, still exported and backed up; delete is separate and confirmed), default journal for New entry, mood, the entry list and reader, the editor with localStorage drafts, FTS5 search, an Insights placeholder.
- **4 Photos:** upload (one file per request; JPEG/PNG/WebP, HEIC refused with a message), the text is the source of truth for which photos an entry has, lightbox. **4b:** CodeMirror 6 with live preview and inline photo widgets. Dictation checked on the Pixel; IME composition untested.
- **5 Location:** current location, place search, location from a photo's EXIF; background weather (section 4c); the map view (List | Map on the Entries screen).
- **6 Export and backup:** one export format, Day One JSON plus `cairn` extras Day One ignores, with or without photos ([docs/export-format.md](docs/export-format.md)); no markdown tree and no separate plain-Day One variant. The backup sidecar ([docs/backup.md](docs/backup.md)) runs nightly on the home server to R2; a test restore on 2026-10-30 cleared the gate.
- **7 PWA and offline:** installable app, cached reads, queued saves (outbox), a change feed, and per-device, per-journal offline copies like Day One's web app (photos as thumb and display derivatives, never originals; search works offline over the kept journals, with exact word forms only). **Not built, on purpose:** server-side drafts (drafts stay in localStorage, which survives a closing tab; revisit if drafts need to follow you between devices), and Trash browsing offline (restoring from and emptying the trash need the server). Journal changes (create, edit, archive, reorder, delete), entry deletes and account settings queue like entry saves.

### Phase 8: Polish

Picked as wanted rather than planned up front; each item below is built. Still open from the original Phase 8 list: mood suggestion (section 4b, waiting on its evaluation gate) and a mood trend chart (in the backlog, under Insights additions).

- **Built:** import from Settings (2026-11-07). Settings > Import uploads a Day One JSON export or a Cairn export (the raw zip streamed to `imports/` in the data dir, capped by the attachment limit; larger exports use the CLI), checks it is one (415 `unsupported_format` otherwise) and shows a preview (journals, entries, how many are already here, photos and files), then imports it in the background into the signed-in user's account with the CLI's rules, a progress count and a report. One import at a time on the server; state in memory (a restart ends a run; uploading the same zip again finishes it, since entries are skipped by uuid). No pre-import snapshot (an import only adds). API `/api/import`; see `apps/server/src/import/CLAUDE.md`.
- **Built:** keyboard shortcuts on desktop (2026-11-02): a shortcut registry with a help dialog (`?`) and a command palette (Ctrl/Cmd+K), `g` chords for navigation, list, reader (`j`/`k` older/newer), editor and calendar keys, and two per-device switches (quick-action keys on, `g` go-to keys off by default). Delete and archive have no keys yet (planned as palette actions with a confirmation).
- **Built:** right-click / long-press context menus (2026-11-02) on entry cards (Edit, Pin, Star, Move to journal, Delete) and journal rows (New entry here, Make default, Edit, Export, Archive, Delete), plus a ⋮ button in the reader (and on cards on iOS only, where long-press is unreliable); the touch sheet slides up. First entry delete in the UI; since the trash, an entry's delete no longer asks (Undo in the toast), a journal's still does.
- **Built:** journal colours (2026-11-03): 12 curated swatches (`apps/web/src/lib/journalColors.ts`, contrast and spacing tested), the next unused one preselected for a new journal, and the colour shown as a light tint on every entry card, a coloured journal chip on cards in multi-journal lists, a tinted reader chip and selected sidebar row, an icon-or-book badge (a Material icon or an emoji) in its colour beside the Entries title, the nav and Manage journals and tinted Calendar days. The brand olive stays on the chrome; no free colour picker.
- **Built:** attachments (PDF, MP4/MOV, M4A: the types Day One accepts besides images). Own `attachment` table beside `photo`, referenced as `![name](attachment:<id>)`, streamed uploads capped at 95 MB (Settings can lower it), no transcoding, imported and exported in Day One's `videos`/`audios`/`pdfAttachments` shape, records synced but files not kept offline.
- **Built:** Insights: stats, a month mood calendar (a day's ratings averaged to one emoji) and "On this day", computed on demand by the server (`/api/insights/*`; no stored aggregates, see `apps/server/CLAUDE.md`), online only. Tapping a calendar day opens its entry (or lists them in a dialog), and a Top tag card sits under the stats. Still open: a journal filter and a mood trend chart.
- **Built:** writing prompts (2026-11-04; design in [docs/design/prompts-proposal.md](docs/design/prompts-proposal.md)). A prompt is a question that starts an entry. Each user has their own list (`prompt` rows with a `user_id`); the admin keeps a server-wide list of **suggested prompts** (`user_id` null) and the **categories** (`prompt_category`, server-wide, one per prompt at most) both kinds use, in Settings > Server > Suggested prompts, with a JSON import (merge only, a dry-run preview first). The Prompts page (nav item and a third bottom-bar tab) shows three daily prompts from the user's own list (stable through the day, drawn from a shuffle bag), a Pick a category section (three from a per-category bag), and a way into all their prompts (search, category filter, edit, bulk delete). Browse suggested prompts is collapsed by category with a search; Save copies one into your list, Save all a whole category (idempotent through `source_prompt_id`). Tapping a prompt opens a new entry whose text starts as `# <prompt>`, so the prompt becomes the entry's title; nothing about the prompt is stored on the entry. Settings-like data (migration 0019): no rev, no tombstones, online only. Not built: prompt reminders (they wait for notifications), prompts in the export, a prompt button inside the editor, per-user categories.
- **Built:** entry templates and slash commands (2026-11-06). A template is a user's saved text, a name and a markdown body, text only (no photos, as in Day One; tags and a default journal are left out), per user with no server defaults (`template` table, migration 0021; settings-like like prompts: no rev, tombstones or sync feed). Settings > Your data > Manage templates (`/templates`) adds, edits and deletes them. They go into an entry from the editor's Templates menu (a header button with a mouse, a toolbar button on a touch screen; also "Save as template…", which keeps the entry's text minus its photos and files, and a link to Manage templates), from the command palette ("Insert template: X") and from the slash menu. Typing `/` at the start of a line or after a space in the editor opens a CodeMirror completion of inserts (date, time, date and time, yesterday and tomorrow on the entry's own timezone's clock, headings, lists, checklist, quote, code block, link, table, divider) with the user's templates first. Placeholders `{{date}}`, `{{time}}`, `{{datetime}}` and `{{weekday}}` in a template are filled in at insert time. The list is cached in localStorage, so inserting works offline; changes need the server. Not built: export and import of templates (Day One has none; saving a template as an entry is the workaround), editing templates offline, slash commands on a phone keyboard (they don't open on the Pixel; the header menu covers it).
- **Settings tiers (decided 2026-11-01).** Every setting belongs to exactly one tier (where it is stored and who it applies to). Since 2026-11-06 Settings is laid out by topic, not by tier (see "Built: Settings as a list of pages" below); each setting shows its tier as "All your devices" (Account, App) or "This device only" (Device), and the Server tier stays a separate admin-only group:
  1. **Account:** who you are: username, display name, password, default timezone, avatar picture, role (shown, but changed only by an admin). Stored on the `user` row.
  2. **App (per account):** what Cairn shows, the same on every device: temperature unit, auto-add location, the streak switches, show archived journals in the menu. Stored on the account (`PATCH /api/auth/me`), so a new device picks them up.
  3. **Device:** tweaks for one device: light/dark, entry font and size (moved here from App on 2026-11-14: screens differ), bottom bar, plain editor, offline copies and sync. localStorage or IndexedDB, never sent to the server.
  4. **Server (admin only):** affects the server and everyone: API keys, attachment size limit, backup status, user management. `app_setting` or env. Shown only to admins, and the server refuses its routes to everyone else.
- **Built:** Update notice and About (decided 2026-11-03). The build's git SHA and build date identify a build; both are baked into the web bundle and `/api/health`. The app compares them on start, on becoming visible and every 10 minutes, and shows a Reload banner on a mismatch. Settings > About shows the version number (from 1.0, see [docs/releasing.md](docs/releasing.md)), both builds, Check for updates, and the license with a link to the source.
- **Built:** Account settings and Settings laid out by tier. The Account card edits display name, default timezone (drives Insights and the Calendar), username and password (current password required; a new password ends every other session) and the avatar picture (256px WebP, only the derivative kept, `photos/<user_id>/avatar.webp`, not exported); the page is grouped Account / App / Device / Your data / Server. Password reset is a container CLI, `reset-password.js`.
- **Built:** Settings as a list of pages (2026-11-06), replacing the one long page. `/settings` is a list: a profile row to Account, then Preferences (Appearance, Location & weather, Keyboard (hidden on a touch screen with no mouse or trackpad), Offline & sync), Your data (Manage journals, tags, templates, Trash, Storage, Export), Server for admins (Manage users, Server storage, Suggested prompts, Backups & alerts, Places & weather, Uploads & Trash) and About. Each row has an icon and a short live summary. On a phone the list and each page take turns, with Back; from 840px the list stays beside the page (Account shows at `/settings`), and choosing a row replaces the page rather than stacking it. The URLs are the same at every width; the pages that already had their own (`/journals`, `/trash`, `/users`, ...) kept them and show beside the list too.
- **Built:** User management (decided 2026-11-01). `user.role` is `user` or `admin` (migration 0015 makes every existing user an admin; the seeded first user is one) and `user.disabled_at` marks a disabled account. Admins get the Server section and Manage users (`/users`): list users, add one with a temporary password (no forced change: the admin tells them to change it in Account), reset another user's password, change roles, disable or enable. Disabling ends the user's sessions and refuses sign-in (`account_disabled`, only after the right password); nothing is hard-deleted. An admin can't change their own role, state or password there (Account covers the password), and the server never lets the last enabled admin go. Admins are trusted (they can reset passwords and could read the DB anyway) but have no route to other users' journals, entries, photos, attachments or avatars. Escape hatch: `make-admin.js <username>` in the container. Meant for one person up to a family; no user cap. Not built: self-signup, hard delete.
- **Built:** Storage usage (File size management, part 1 of 3; decided 2026-11-01). Settings > Your data > Storage (`/storage`) shows what your account takes on the server, measured on disk: photos (originals and display copies), attachments by kind, entry text, the profile picture, and files waiting for cleanup, plus each journal's size. A file shared by several photos counts once in the total and in every journal that shows it. Admins get Settings > Server > Server storage (`/storage/server`): the database, the pre-upgrade snapshots, and each user's totals for photos, attachments, text and cleanup, with nothing about their journals. No free disk space: under Docker Desktop (WSL2) the container sees the virtual disk's maximum size, not the host drive.
- **Built:** Orphan cleanup (File size management, part 2 of 3). The daily media cleanup now also frees the photos and attachments of entries and journals deleted over 30 days ago (since the trash: of entries deleted for good), removes files no row names (after a day; stale temp files after an hour), and reports in-use rows whose file is missing (counted, logged, never changed). Admins see a preview on Server storage and can run it with Clean up now.
- **Built:** Photo compression (File size management, part 3 of 3). Settings > Server > "Keep original photo quality": off means new JPEG and PNG photos are stored compressed (see section 7); it starts on for a server that already had photos and off for a new one. With it off, "Compress existing photos" replaces the stored originals of every user, one file at a time, once a backup has succeeded within 24 hours.
- **Built:** tags. Edit them on an entry, tag chips in the reader open the list filtered by that tag, search can be narrowed to a tag, and Settings > Manage tags renames, merges and deletes (imported Day One tags work the same).
- **Built:** Trash (decided 2026-11-02). Deleted entries and journals go to the trash for a server-wide retention (an admin setting, Settings > Server > Keep deleted items: 7, 14, 30, 60, 90, 180 days or a year; default 60; per server rather than per user because it is a disk policy, and anyone can empty their own trash early). Trash (`/trash`) is reached from Settings > Your data, Manage journals, Storage and the command palette, not the nav. It lists trashed journals (with the entries deleted with them) and entries whose journal is live; Restore brings one back, Delete forever and Empty trash confirm and can't be undone. Deleting an entry no longer asks (the toast has Undo); deleting a journal still confirms, saying it goes to the trash. The daily cleanup deletes for good what is past the retention, then frees those files at once; a trashed entry's photos and attachments stay whole until then. Storage shows what the trash holds. Deleted for good means scrubbed (text, mood, place, weather, tags), with the row kept as a tombstone for sync (section 4d); older copies stay in the nightly backups until they age out. A trashed entry can be opened read-only before restoring it.

---

## 4. Data model

The original sketch; **`apps/server/src/db/schema.ts` is authoritative** (it adds sync columns, `app_setting`, tag tables and more). Timestamps are epoch ms **plus** the IANA timezone the entry was written in.

```
user
  id, email/username, password_hash, display_name, default_timezone, created_at

session
  id, user_id, expires_at, ...

journal
  id, user_id, name, color, created_at, archived_at, sort_order

entry
  id (uuid)               # our own id
  source_id               # Day One uuid on import (nullable); unique per (user_id, source_id)
  user_id                 # denormalized from journal for simple scoping
  journal_id
  body_md                 # markdown
  created_at              # UTC
  modified_at             # UTC
  timezone                # IANA, e.g. America/Denver (the entry's own zone)
  starred, pinned, all_day
  mood_key                # nullable text, a key from the MOODS registry in packages/shared (checked by Zod); null = not set. (The old integer `mood` column is unused: SQLite can't drop it while its CHECK exists.)
  mood_suggested          # nullable smallint 1-5; machine suggestion, never shown as my rating
  mood_suggested_by       # nullable text, model name + version that produced it
  creation_device         # nullable
  source                  # 'native' | 'dayone'
  source_raw              # JSON of original Day One entry (nullable)

entry_location            # 0..1 per entry
  entry_id, latitude, longitude,
  place_name, locality, region (admin area), country, address (nullable),
  user_label (nullable), google_place_id (nullable)

entry_weather             # 0..1 per entry
  entry_id, temp_c, feels_like_c (nullable),
  condition               # our canonical enum (section 4c)
  is_day (nullable), description (provider wording),
  pressure_mb, humidity_pct, wind_kph, wind_bearing, visibility_km, sunrise, sunset (as available),
  source ('dayone' | 'google' | 'manual'), source_code (raw provider code), fetched_at, raw (json)

photo
  id, user_id, entry_id, position,
  original_path, display_path, thumb_path,
  mime, width, height, bytes, sha256,
  taken_at (nullable), latitude (nullable), longitude (nullable),
  source_ref (nullable)   # e.g. Day One photo identifier / md5

tag / entry_tag           # many-to-many; tag has user_id, unique on (user_id, name)

entry_fts                 # FTS5 virtual table: title, body (plain text), place, tags; keyed by entry_id (built in 3e)
```

### 4a. Mood

- Stored as a text key (`happy`, `anxious`, `stressed`...), never as an emoji, so the emoji set can change later without a data migration and exports read without a legend. The registry (14 moods: key, emoji, label, valence -2..2) lives in `packages/shared/src/mood.ts`. Moods are not a linear scale: never average the keys; only `valence` is averaged, for trends and the calendar tint. The old 1-5 ratings became sad, down, meh, content, happy (migration 0013); `MoodSchema` still accepts a 1-5 number so queued edits and old drafts keep working.
- Optional. Null means no mood and is excluded from every count.
- Day One has no mood field, so imported entries have `mood = null`. Do not guess moods from text.
- Include mood in the full export (frontmatter / JSON) and in the backup, which happens automatically since it is a column.
- Accessibility: each emoji button gets a text label (e.g. "Anxious") for screen readers.

### 4b. Mood suggestion (late phase, optional)

Constraints: Cairn has to run on a small home server, so assume a CPU and no GPU, little spare RAM and other services alongside it. No entry text leaves the server. So: **no LLM, no cloud API**, only a small local sentiment/emotion classifier.

- Interface: `suggestMood(text: string): Promise<1|2|3|4|5|null>` behind a config flag. Default is disabled, and the app must work identically without it.
- Implementation: ONNX Runtime (or transformers.js) with a small, quantized (int8) classifier. Convert class probabilities to a 1-5 score (e.g. expected value, rounded). Candidates to evaluate: a distilled English sentiment model, a 3-class sentiment model, or a small emotion model. Check the actual quantized file size and resident memory before committing to one.
- Resource budget: model must stay under about 300MB resident. Prefer running it in a separate optional container with a hard `mem_limit` and low CPU priority, so it can never starve the server's other services, and OOM-kill only itself. Load lazily, unload after idle, process one entry at a time from a queue.
- Trigger: after an entry is saved (debounced), in the background. Never block saving.
- UX: show the suggestion as a muted emoji I can accept with one tap, which copies it into `mood`. Never write to `mood` automatically. Store `mood_suggested_by` so suggestions can be recomputed if the model changes.
- Evaluation gate before keeping it: manually rate about 50 real entries, run the model on them, and compare. If it is within one point of my rating most of the time it is useful; if not, drop it and keep manual-only.
- Long entries: truncate or chunk to the model's token limit and average.
- Not in scope: backfilling old Day One entries automatically (offer an explicit "suggest for selected" action at most).

### 4c. Weather

- **Decided 2026-11-06:** the default source is Open-Meteo (no key, history for any date, WMO codes mapped into the enum); Google Weather stays as an admin choice (Settings > Server > Weather source), because its history only reaches 24 hours and a "now" entry could fall in a gap. The text below describes Google's limits. Fetched server-side when an entry has a location (Google: same account/key family as Places; enable the Weather API on the key). Weather never blocks saving: it is fetched in the background, and failure just leaves the entry without weather.
- Timing (Google): for entries created now, use current conditions. For an entry whose time is within the last 24 hours, use the hourly history lookup (the API's history only goes back 24 hours). Older or backdated entries get no automatic weather from Google; Open-Meteo covers any date. Weather can always be entered by hand.
- Day One imports keep their own weather exactly as exported and are never overwritten by an automatic fetch.
- Canonical conditions: define one small enum in `packages/shared` (e.g. clear, mostly-clear, partly-cloudy, cloudy, fog, drizzle, rain, thunderstorm, snow, sleet, hail, wind) plus `is_day`. Write two mapping tables into it: Day One `weatherCode` values (`clear-day`, `partly-cloudy-night`, ...) and Google condition types. Unmapped values become `unknown` with the raw code preserved.
- Icons: **Material Symbols** weather icons (Apache 2.0; decided, they match the design language). Bundled locally and keyed by canonical condition + day/night, never hotlinked.
- Store metric; display °F/°C by a user setting (default °F).
- Optional setting: a default "home" location used for weather when an entry has no location. Off by default.
- UI: small "refresh weather" action, and weather can be edited or removed per entry.

### 4d. Sync-ready from day one

Chosen before sync existed so Phase 7 needed no retrofit; they still hold for anything new.

- **Client-generated ids.** Entries, journals, photos and drafts get UUIDs (v7 preferred) that the client can create offline; the server accepts client-supplied ids.
- **Tombstones.** Every syncable table has `created_at`, `updated_at` and `deleted_at` (soft delete). All queries and FTS exclude deleted rows. A deleted entry or journal is in the trash until `purged_at` is set (deleted forever, or past the server's retention; Phase 8); purging scrubs the content but keeps the tombstone, since a device offline longer than the retention still needs it in the change feed. A journal's entries were deleted with it when their `deleted_at` equals the journal's, and only those come back when it is restored. Restoring bumps the revs of the entry and its photos and attachments, so devices that dropped them fetch them again.
- **Revision counter.** Each syncable row carries a server-assigned, monotonically increasing `rev`, bumped on every write, so a future `changes since <rev>` endpoint is trivial.
- **Idempotent writes.** Mutations carry a client-generated mutation id; the server remembers recent ones so a retried request after a dropped connection doesn't apply twice.
- **Optimistic concurrency.** Updates send the `base_rev` they were made against. On a mismatch the server never silently overwrites text: it keeps both versions (a conflict copy or a flagged "resolve" state). For one user this should be rare.
- **Photos upload separately from entries,** are referenced by id, and can be retried or resumed. An entry may reference a photo that is still uploading.

Rules:
- **User-scoped throughout.** Every user-owned table carries `user_id` with an index. All data access goes through a repository/service layer that takes the authenticated `userId` and always filters by it; route handlers never query tables directly. Day One `uuid` is stored in `source_id` and is unique per user, so two users could import the same export and re-imports stay idempotent.
- Photo files live under `data/photos/<user_id>/...` and are served only after an ownership check.
- A test checks that user A cannot read, edit or search user B's journals, entries, photos or drafts, admins included.
- Roles (User, Admin) manage accounts and server settings only (Phase 8); there is no signup or sharing UI.
- Display an entry's date/time **in its own stored timezone**, not the viewer's. An 11pm entry must stay on that day.
- All files referenced by relative path under the data dir, never absolute.

---

## 5. Day One import notes

The format as verified against the real export is in [docs/dayone-export-format.md](docs/dayone-export-format.md); the importer's own notes are in `apps/server/src/import/CLAUDE.md`.

**Do not commit my real export or its photos to git.** Add `data/`, `*.zip` and any `fixtures/private/` to `.gitignore`. Test fixtures must be scrubbed.

---

## 6. Editor

- Markdown in CodeMirror 6 with live preview in place, and a Source toggle for plain markdown. Prioritize mobile feel over features.
- Mobile requirements: no viewport jump when the keyboard opens (use `visualViewport` handling), toolbar that sits above the keyboard, no cursor/scroll glitches, large tap targets.
- Revisit a rich-text editor (TipTap/Lexical) only if markdown turns out to bug me in practice.
- Autosave drafts so a dropped connection or a closed tab never loses text.
- Voice input: rely on OS dictation (Gboard on the Pixel, Win+H / Voice Access on Windows) instead of building speech recognition. The editor must work correctly with it: test dictating into the editor on phone and laptop, and make sure the chosen editor component doesn't drop or garble dictated text. The Web Speech API is deliberately not used (platform-dependent, possibly cloud-processed, experimental on-device mode). Checked: dictation into the CodeMirror editor works on the Pixel; Windows' Win+H is janky, which is Windows' own behaviour, not the editor's.

---

## 6a. Design language and branding

**Look and feel**
- Material 3 ("Material You") style, implemented as theme tokens on top of shadcn/ui, not a different component library. Rationale: MUI's own Material 3 support was still only planned when I last checked, so MUI would not give a true M3 look out of the box, and shadcn keeps full control.
- Generate the palette with `@material/material-color-utilities` from a single seed color: light and dark schemes, tonal palettes, and surface-container roles. Map the output onto shadcn's CSS variables (plus extra surface tokens). Keep the generator script in the repo so the seed can be changed in one place.
- Follow the system setting with `prefers-color-scheme`; set `theme-color` for both modes. Settings can force light or dark per device.
- Seed color: a natural, muted warm green with a slight brown tint (moss/sage/olive), not saturated. Use a muted primary chroma (roughly 25 in LCh; the library's default of 36+ gives lime-ish containers), a warm brown/clay tertiary (used for weather chips), and warm-tinted neutrals. The chosen palette (C) was approximated in CIE LCh, so regenerate with the real library before shipping. Check text contrast (WCAG AA) in both schemes.
- Android "dynamic color" from the wallpaper is not available to web apps, so this is a fixed seed palette that merely looks like Material You.
- M3 traits to adopt: tonal surfaces instead of heavy shadows, generous corner radii, pill-shaped buttons and chips, a floating "new entry" button on phones, state layers on hover/press, the M3 type scale, and Material Symbols (Rounded) for icons.
- Adaptive layout (decided, replaces the earlier bottom-bar/rail/sidebar idea): **Entries** is a master-detail screen, the entry list beside a reader/editor pane, at the same URLs on every size. Under 840px one pane shows at a time; from 840px both show side by side; from 1200px a permanent sidebar joins them (three columns). Navigation: the sidebar from 1200px up (Entries, Insights, Search, the journals, then Manage journals and Settings at the bottom); below that, **Entries and Insights are a bottom bar** and the same full list is a slide-out menu opened from each screen's top bar (which also has a search icon). New entry is a FAB at every width, extended with its label from 600px. The account avatar (placeholder initial, picture later) is the Settings row at the bottom of the nav. The 840-1199px range uses the bottom bar too; revisit on the Pixel Tablet if it feels wrong (a rail is the alternative).

**Principles**
- Simple and focused. The writing surface is the hero; minimal chrome; few settings; no dashboards of stats on the home screen.
- Comfortable reading typography for entry text (consider a readable humanist or serif face for the body, with the UI in a clean sans).
- Phone first, then scale up. Every screen is checked at phone width in both light and dark.

**Logo and app icon**
- Concept: a stylized cairn, a stack of 3-5 rounded stones, drawn as simple flat shapes that stay legible at 16px. Colors come from the theme's tonal palette.
- Direction, after several drafts: asymmetric, hand-stacked, no sun. **Chosen logo: `cairn-d-small`**, now `assets/branding/icons/cairn.svg`. The icon set is generated from it into `assets/branding/icons/` (`cairn.svg` master, `icon.svg`, `favicon.svg`/`.ico`, `icon-192/512.png`, `icon-maskable-512.png`, `icon-monochrome(.svg/-512.png)`, `apple-touch-icon.png`, `manifest-icons.json`, rebuilt by `scripts/build_icons.py cairn.svg <out_dir>`) and copied into the web app's `public/`; regenerate if the palette seed changes.
- Source: my own cairn photo as reference for proportions and mood (kept in `assets/branding/source/`). Do **not** auto-trace the photo; traced photos come out muddy and are poor icons. Claude writes the SVG by hand (geometry only), iterating from the photo and from screenshots at small sizes. Optional manual polish in Affinity.
- Deliverables, all generated from the master SVG by the script: `icon.svg` (full color), `favicon.svg` plus `.ico` fallback, `apple-touch-icon` 180px, PWA PNGs at 192 and 512, a **maskable** 512 version with extra padding for the safe zone, and a single-color **monochrome** silhouette for Android themed icons (manifest icon `purpose: "monochrome"`).

---

## 7. Photo pipeline

Targets: compatibility and file size. Cairn is a journal, not full-quality photo storage, so how originals are kept is a server setting (decided 2026-11-01).

- Accept JPEG, PNG, WebP, GIF, AVIF and TIFF (GIF derivatives are a still first frame), and HEIC if the build supports it (I'm on a Pixel, so HEIC is not a priority; reject gracefully with a clear message if unsupported).
- On upload (and import), generate:
  - **original**: per the admin's photo quality setting. `original`: stored untouched. `compressed`: JPEGs and opaque PNGs are stored as a JPEG of at most 4096px on the long edge, quality 85, with EXIF and colour profile kept, at `photos/<user>/compressed/<sha256 of the upload>.jpg`, when that is at least 10% smaller; WebP, transparency and anything that doesn't shrink stay untouched. Defaults: `original` on a server that already had photos when the setting arrived, `compressed` on a new one. "Compress existing photos" (admin, server-wide, needs a backup from the last 24 hours) applies `compressed` to the originals already stored, one file at a time.
  - **display**: auto-rotated from EXIF orientation, longest edge about 2048px, WebP or high-quality JPEG (check quality/size tradeoff visually).
  - **thumb**: about 400px, WebP.
- Extract EXIF `DateTimeOriginal` and GPS **before** stripping metadata from derivatives. Derivatives should not carry GPS; the DB holds it deliberately.
- Pixel photos may be Ultra HDR JPEGs; resizing will drop the gain map, which is fine for display copies.
- Dedupe by sha256.
- Serve photos through authenticated routes (no public static directory). Long cache headers keyed by hash.
- Upload size: stay under Cloudflare's per-request limit (100MB on free). Process uploads one file per request.

---

## 8. Backup

Built in Phase 6c; **[docs/backup.md](docs/backup.md) is authoritative.** A restic sidecar driven by env vars only (`.env.backup`), any restic backend (Cloudflare R2 by default), nightly, with `verify` (a test restore), a status file shown in Settings, and a ping on start, success and failure. Rules that came from the plan and still hold:

- Snapshot SQLite with `.backup` or `VACUUM INTO`; never copy the live DB file.
- Store the restic password **off the server** (password manager). Without it the backup is useless.
- If Google Drive (rclone) is ever the target: use your own OAuth client with the consent screen in **Production**; in Testing mode refresh tokens expire after 7 days and backups silently die.

---

## 9. Security

- Defense in depth: an access layer in front of the app where possible (Cloudflare Access, a VPN) **and** the app's own login. Login is rate limited per IP and per username; `TRUST_PROXY` says which proxy's `X-Forwarded-For` to believe, and a browser that has signed in before skips the per-username limit, so nobody can lock the owner out by guessing.
- Secrets only via env / Docker secrets, never committed. Provide `.env.example`.
- Google Maps API key restricted (API restrictions, and referrer/IP restriction if it ever reaches the browser); prefer calling Google only from the backend.
- CSRF protection for cookie-authed mutating requests (SameSite plus an origin check at minimum).
- Sanitize rendered markdown (no raw HTML execution), including imported Day One content.
- Limit upload types and sizes server-side; never trust client MIME.
- Security headers (CSP, etc.) set by the server.

---

## 10. Conventions

- TypeScript strict everywhere; no `any` without a comment.
- Zod schemas in `packages/shared` are the source of truth for API types.
- Small, focused commits; branches, versions and releases as in [docs/releasing.md](docs/releasing.md).
- Migrations are forward-only and committed; never edit an applied migration.
- Importer and photo pipeline get real tests. UI gets tests only where logic is non-trivial.
- Keep dependencies lean; justify each addition.
- Prefer boring solutions. This is a personal tool I want to maintain at 11pm.

## 11. Decisions

The questions the plan left open, numbered as they were raised (other sections cite them by number). Two are still open: 1 and 7.

1. **Open: Google Places vs. alternatives.** Google's terms restrict caching Places data and displaying Places results on a non-Google map. For a personal app this is low risk, but the clean approach is: use Google only for autocomplete/lookup, store just the fields I need on the entry (I'll decide how strictly to read the terms), and show the map with OSM. If that feels uncomfortable, swap in Nominatim or Photon behind the same backend interface.
2. **Map library, decided:** Leaflet with OpenStreetMap raster tiles (no key, clear tile rules for light personal use; needs an `img-src` CSP change for the tile origin). MapLibre GL stays the fallback if clustering or performance is a problem.
   **Option, not chosen: Google map tiles.** Checked October 2026: Map Tiles API 2D tiles have 100,000 free requests/month per project (hard cap 15,000/day); the Maps JavaScript API's free tier is reportedly 10,000 loads/month (unverified against Google's pricing page). Costs of switching: the key runs in the browser, so it needs a second, HTTP-referrer-restricted key (plus a daily quota and budget alert; a raw-IP origin, such as plain http over a VPN, must be added to the referrers); Google's policies restrict caching and offline use, so proxying tiles through the server is not advisable; the Tiles API needs a session token and its own attribution; the JS API means replacing Leaflet. Reason to switch: the Google look, and Places terms expect Places data to appear on a Google map (decision 1). The Map view should keep the tile source/map library in one component so a swap stays contained.
3. **Timestamps, decided:** epoch ms plus the entry's IANA timezone.
4. **Photo derivative format, decided:** WebP (display quality 82, thumb 75).
5. **Draft storage, decided:** localStorage-only drafts, with a local Drafts screen; no server-side drafts (Phase 7).
6. **Export format, decided:** one export, Day One JSON plus Cairn extras that Day One ignores, with or without photos ([docs/export-format.md](docs/export-format.md)). No markdown tree.
7. **Open: mood suggestion.** Whether the classifier is accurate enough to be worth the RAM on a small server. Decided by the evaluation gate in section 4b, not up front.
8. **Weather icons, decided:** Material Symbols weather icons, bundled locally.
9. **Seed color and fonts, decided:** palette C (olive with a brown tint, seed `#7B7B45`; warm brown neutrals and clay tertiary), generated with the real library (`npm run theme -w @cairn/web`) and contrast-tested. Entry font: **Literata** by default (self-hosted variable font); since Phase 8 each user can choose one of five entry fonts and a text size.

---

## 11a. Backlog and follow-ups

Moved to [docs/todo-and-ideas.md](docs/todo-and-ideas.md), the one list of features and ideas.
