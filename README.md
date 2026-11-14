<p align="center">
  <img src="assets/branding/icons/cairn.svg" alt="Cairn" width="96" height="96">
</p>

<h1 align="center">Cairn</h1>

<p align="center">
  A self-hosted journal in the spirit of Day One.<br>
  Your entries, photos and places stay on your own server.
</p>

<p align="center">
  <a href="https://github.com/nicolelee-io/cairn/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/nicolelee-io/cairn"></a>
  <a href="https://github.com/nicolelee-io/cairn/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/nicolelee-io/cairn/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
</p>

<!-- Served from the project site: the screenshots show the maintainer's photos, which aren't under this repo's license. -->
<p align="center">
  <a href="https://nicolelee.io/cairn">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://nicolelee.io/cairn/readme-hero-dark.webp">
      <img src="https://nicolelee.io/cairn/readme-hero-light.webp" alt="Cairn on a computer and a phone: the timeline beside an open entry about Glacier Bay">
    </picture>
  </a>
</p>

Cairn is a journal you run as one Docker container and use from the browser on a phone, tablet or
computer, installed as an app or not, online or offline. It reads and writes Day One's export
format, so a journal can come in from Day One and go back out again.

More screenshots and a tour: **[nicolelee.io/cairn](https://nicolelee.io/cairn)**.

## Design goals

- **Markdown is the format.** An entry is plain markdown: what you type is what is stored,
  searched and exported. The editor styles it as you write and hides the syntax, so it reads like
  a page rather than code, and you don't need to know markdown to use it; a toolbar and keyboard
  shortcuts do the formatting. Photos and files are references in the text, so moving one is
  moving a line. Nothing about an entry is locked in a format only Cairn understands.
- **Light to run.** One container, one SQLite database and a folder of files. No separate database,
  cache, queue or mail server, so it sits comfortably on a small home server next to everything else.
- **Your data stays yours.** The browser talks only to your server (and OpenStreetMap, for map
  tiles); there are no analytics, no tracking and no outside account. Place and weather lookups go
  through your server. Everything can be exported at any time in a format Day One can import, and
  an optional container keeps encrypted backups off-site.
- **Writing first, especially on a phone.** A quiet writing surface, a toolbar that sits above the
  keyboard, drafts saved as you type, and writing that keeps working without a connection.
- **Small on purpose.** Multi-user, but for a few people who know each other, each with their own private journals. No social
  features, no sharing and no signup page.
- **Built to keep years of entries.** Few dependencies, migrations that snapshot the database
  before they run, and backups that are proven by restoring them.

## Features

**Writing**

- Markdown in an editor that styles the text as you write, with a toolbar that sits above the
  phone keyboard, slash commands, templates and a distraction-free zen mode.
- Photos, PDFs, video and audio, added from the picker, paste or drop.
- Mood, tags, pin and star, and a place (your location, a search, or a photo's GPS) with the weather
  fetched in the background.
- Each entry keeps its own timezone, so an 11pm entry stays on its day wherever you read it.
- Drafts save on the device as you type, and writing prompts (three a day from your own list)
  help when you're stuck.

**Reading and finding**

- Journals with colours and icons; a timeline beside the reader on wide screens.
- Calendar, media grid and map views, and full-text search with filters.
- Insights: streaks, a mood calendar and On this day.
- Keyboard shortcuts and a command palette on a computer; gestures on a phone. Settings > Tips &
  tricks lists them.
- A Material 3 look in light and dark, with a choice of five fonts and text sizes for reading.

**Your data**

- Import from Day One or Cairn, from Settings or the command line; export a Day One-compatible zip
  of everything, one journal or one entry.
- An optional backup container: nightly, encrypted [restic](https://restic.net) backups to
  Cloudflare R2, B2, S3, SFTP, Google Drive or a folder, with test restores.
- Offline: keep whole journals on a device; changes made offline are sent when you're back. Adding
  photos and a few other things need a connection; [docs/offline.md](docs/offline.md) has the list.
- A trash for deleted entries and journals, and a storage overview.

**Who can read your entries**

- Entries aren't end-to-end encrypted, so whoever runs a Cairn server (and its backups) can read what's on it. Only use a server run by someone you'd trust with your journal.
- Cairn is self-hosted software, and there is no hosted or paid version. If someone offers you one, it isn't run by the maintainer.

**Running it**

- One image, one volume, no other services. Multi-user support, each person with their own journals; admins manage
  accounts and server settings. No route lets an admin read anyone else's entries, but an admin
  runs the server and can reset passwords, so admins are trusted.
- Weather (Open-Meteo) and the map (OpenStreetMap) need no API key; naming and searching places
  uses a Google API key, set in Settings or the environment.

The full list is in the [changelog](CHANGELOG.md); known gaps against Day One are in
[docs/known-issues.md](docs/known-issues.md).

## Quick start

You need Docker with Compose. In a new folder, save this as `docker-compose.yml`:

```yaml
services:
  cairn:
    image: ghcr.io/nicolelee-io/cairn:1
    container_name: cairn
    ports:
      - '8086:3000'
    env_file: .env
    volumes:
      - cairn_data:/data
    restart: unless-stopped

volumes:
  cairn_data:
    name: cairn_data
```

and this as `.env`, for the first account (an admin):

```bash
INITIAL_USERNAME=you
INITIAL_PASSWORD=a long password of 8 characters or more
INITIAL_DISPLAY_NAME=Your Name
INITIAL_TIMEZONE=America/Denver
```

Then `docker compose up -d` and open `http://<server>:8086`. The `:1` tag follows the 1.x releases:
new features and fixes, never a change that needs you to act.

Putting it behind https, the settings, upgrades and the admin tools are in the
**[deployment guide](docs/deployment.md)**. Set up backups before you trust it with real entries:
**[docs/backup.md](docs/backup.md)**.

## Importing from Day One

In Day One, export your journals as JSON (a zip). In Cairn, **Settings > Import** takes the zip,
shows what's in it and how many entries are new, and imports it into your account. Exports larger
than the upload limit (95 MB at most) go through the command line instead:

```bash
docker exec -i cairn node import-journal.js - --user you < Export.zip
```

Importing again is safe: entries already in Cairn are skipped, never overwritten. The details,
and a script that takes a backup before and after, are in the
[deployment guide](docs/deployment.md#admin-tools).

## Documentation

| Document                                                     | What                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| [docs/deployment.md](docs/deployment.md)                     | Running Cairn: proxies, configuration, upgrades, admin tools |
| [docs/backup.md](docs/backup.md)                             | The backup container: setup, restore, test restore           |
| [docs/export-format.md](docs/export-format.md)               | What an export contains, and how it maps to Day One          |
| [docs/dayone-export-format.md](docs/dayone-export-format.md) | Day One's export format, as the importer reads it            |
| [docs/known-issues.md](docs/known-issues.md)                 | Day One incompatibilities that won't be fixed                |
| [SPEC.md](SPEC.md)                                           | The design: goals, data model and decisions                  |
| [docs/design/](docs/design/)                                 | Design proposals for larger features                         |

## How it's built

- **Scoped by user throughout.** Every table and query is scoped by user, with a cross-user
  isolation test that covers admins too: a role manages accounts and server settings, and no route
  gives an admin another person's content (admins are still trusted: they can reset passwords).
- **Offline without losing writes.** Client-generated ids, tombstones, a server-assigned revision
  counter and optimistic concurrency: a save made offline is replayed safely, and an edit that
  conflicts with a newer one never overwrites it silently; you choose which to keep.
- **Time is local to the entry.** Stored as UTC plus the entry's IANA timezone, and displayed in
  that timezone, not the viewer's.
- **The server does the lookups.** Google Places, Geocoding and Weather are called from the
  backend only, so API keys never reach the browser, and the CSP allows no origin but your server
  (and the map tiles).
- **Markdown in, markdown out.** Rendering is sanitised (no raw HTML, imported content included);
  the importer keeps each Day One entry's raw JSON beside the mapped fields, so nothing is lost in
  translation.

## Development

| Layer    | Choice                                                                    |
| -------- | ------------------------------------------------------------------------- |
| Web      | Vite, React, TypeScript, Tailwind v4, TanStack Query, CodeMirror 6, Dexie |
| API      | Node 24, Hono, Zod (shared with the web app)                              |
| Database | SQLite via better-sqlite3 and Drizzle, WAL mode, FTS5                     |
| Images   | sharp                                                                     |
| Tests    | Vitest, Playwright                                                        |

```
apps/web         Vite + React SPA (PWA, hand-written service worker)
apps/server      Hono API; in production it also serves the built SPA
packages/shared  Zod schemas and constants, used as TypeScript source by both apps
backup/          The backup container (restic) and its tests
e2e/             Playwright tests
docs/            Guides, formats, design proposals, the backlog
scripts/         Import, fixture and icon helpers
```

Requires Node 24 (see `.nvmrc`). On Windows, use WSL2 or a devcontainer so the native modules
(better-sqlite3, sharp, argon2) match production.

```bash
npm install
cp .env.example .env     # set INITIAL_USERNAME and INITIAL_PASSWORD
npm run dev              # API on :3000, Vite dev server proxying /api
```

Development data lives in `./data-dev` (git-ignored). `npm run import:journal -- fixtures/sample-dayone-export.zip`
fills it with sample entries.

| Command                                | What it does                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run dev`                          | Server and web dev servers together                                                           |
| `npm run dev:tailnet`                  | The same, reachable from a phone on your network at `http://<its IP>:5173`                    |
| `npm run build`                        | Build the web app, then bundle the server                                                     |
| `npm test`                             | The Vitest suite                                                                              |
| `npm run e2e`                          | Playwright browser tests, run locally, not in CI ([docs/e2e-testing.md](docs/e2e-testing.md)) |
| `npm run typecheck`                    | `tsc -b` across all workspaces                                                                |
| `npm run lint`                         | ESLint                                                                                        |
| `npm run db:generate -w @cairn/server` | Generate a migration after editing the schema                                                 |
| `docker compose up -d --build`         | Build and run the image locally at `http://localhost:8086`                                    |

CI runs typecheck, lint and the tests on every pull request and push. Every push to `main`
publishes `:latest`; a version tag publishes `:1.2.3`, `:1.2` and `:1` and a GitHub Release. How
branches, versions and releases work: [docs/releasing.md](docs/releasing.md).

**Built with Claude Code.** I designed Cairn and directed the work: [SPEC.md](SPEC.md) is the
design record, written before any code existed. [Claude Code](https://claude.com/claude-code)
wrote the implementation as my pair. The `CLAUDE.md` files (one at the root, one beside each
area's code) are its project notes: the architecture rules, and how each part works. They're
kept up to date as the code changes, so they're also the best map of the codebase. The backlog
is in [docs/todo-and-ideas.md](docs/todo-and-ideas.md) and known bugs in
[docs/tech-debt.md](docs/tech-debt.md).

## Contributing

Issues and ideas are welcome; please ask in an issue before opening a pull request. See
[CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md) for reporting a vulnerability.

## License

Cairn is free software under the [GNU Affero General Public License v3.0](LICENSE). You can use,
change and share it, including in a fork; if you run a modified version for other people, you must
offer them its source code.
