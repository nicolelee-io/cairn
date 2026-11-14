# Contributing

Cairn has one maintainer and a deliberately small scope: a lightweight, self-hosted journal
in the spirit of Day One, for one person up to a family running their own server (the design goals are in the
[README](README.md#design-goals)). A good idea can still fall outside that, so not every one will fit.

## Issues and ideas

Welcome. Open an issue for:

- **A bug:** what you did, what you expected, what happened, and the version (Settings > About).
  For anything about importing, say whether the export came from Day One or Cairn; never attach a
  real export or real entries.
- **An idea or a feature request:** what you'd use it for. If it doesn't fit Cairn's scope I'll
  say so; you're welcome to build it in a fork (the [license](LICENSE) allows it, as long as a
  modified Cairn you run for other people offers them its source).

Security problems don't go in an issue: see [SECURITY.md](SECURITY.md).

## Pull requests

**Please ask in an issue before opening a pull request**, so you don't spend time on something
that won't be merged. Once we've agreed on a change:

- Follow the conventions in [CLAUDE.md](CLAUDE.md) (the project's architecture rules and notes,
  also used by Claude Code; see below) and the notes beside the code you change.
- `npm run typecheck`, `npm run lint` and `npm test` pass (CI runs them on every pull request).
  For a change to one of the main flows, run `npm run e2e` too ([docs/e2e-testing.md](docs/e2e-testing.md)).
- A change people will notice adds a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
- A schema change comes with its generated migration (`npm run db:generate -w @cairn/server`),
  never an edit to an existing one.
- No real journal data, exports or photos in commits, tests or screenshots.

How branches, merges and versions work: [docs/releasing.md](docs/releasing.md).

## Development

Setup, commands and the repository layout are in the [README](README.md#development). Cairn was
built with [Claude Code](https://claude.com/claude-code); the `CLAUDE.md` files beside the code
are its project notes, and they are kept up to date as the code changes, so they double as a guide
to how each area works.
