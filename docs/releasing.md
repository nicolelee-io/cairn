# Branches, versions and releases

How changes reach `main`, what the version numbers mean, and how a release is made. Decided 2026-11-07, for the public repo from 1.0 on. Cairn has one maintainer, so this stays light.

## Branches and commits

- **`main` is the only long-lived branch**, and it is always in a working state: typecheck, lint and tests pass on every commit.
- **Small changes** (a fix, polish, docs) are committed straight to `main`.
- **Bigger or risky changes** go on a short-lived branch (`feature/<name>`, `fix/<name>`). A pull request is optional: it is a cheap way to see CI pass before merging, and leaves a record of a larger feature.
- **Merging:** squash-merge when the branch's commits are work in progress ("wip", "fix typo"); rebase or fast-forward when each commit is meaningful on its own. Never a merge commit (`main` has a linear history).
- **Commit messages** describe the change as it ends up, not the steps taken to get there. They are public: no private hostnames, addresses or names.
- Every change that a user would notice gets a line under **Unreleased** in `CHANGELOG.md` in the same commit (see Changelog).

## What each image tag means

| Tag                 | Built from               | Who should use it                                                                                                  |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `:latest`, `:<sha>` | every push to `main`     | the maintainer's own server, which tries every change first; anyone who wants the newest code and accepts the risk |
| `:1.2.3`            | the release tag `v1.2.3` | anyone who wants an exact version                                                                                  |
| `:1.2`              | the newest `v1.2.x`      | fixes only                                                                                                         |
| `:1`                | the newest `v1.x.y`      | **the recommended tag for self-hosters**: features and fixes, never a breaking change                              |

The backup sidecar (`cairn-backup`) gets the same tags from the same commit.

## Version numbers

Semantic versioning, `MAJOR.MINOR.PATCH`, judged by what a self-hoster has to do when they upgrade (Cairn has no public API in the library sense; its contract is the image, its config, its data and its export):

- **MAJOR** (2.0.0): the upgrade needs action, or breaks something people rely on. A renamed or removed environment variable, a removed feature, a change to the data volume's layout, an export older Cairn or Day One can't read, a sync change that makes every device start again, a new minimum (Node, Docker) that affects running it. Rare; the release notes say exactly what to do.
- **MINOR** (1.3.0): new features, new optional settings or environment variables, and **any database migration**. Migrations only go forward, so after one, going back to the previous image means restoring the pre-migration snapshot (`/data/backups/pre-migrate-*.db`); a minor bump says so. Also a dependency update that changes behaviour.
- **PATCH** (1.2.1): bug fixes, polish, wording, dependency updates that change nothing visible. **Never a migration.**

When in doubt between two levels, take the higher one.

The version is bumped when a release is made, not per commit. No fixed schedule: a patch release when a few fixes have collected (or at once for a security fix), a minor when a feature is finished.

## Changelog

`CHANGELOG.md` at the root, in the [Keep a Changelog](https://keepachangelog.com) format:

- An `## [Unreleased]` section at the top, with `### Added`, `### Changed`, `### Fixed`, `### Removed` and `### Security` groups as needed.
- One line per change, written for someone running Cairn: what changed for them, not how it was built. Name a new environment variable or setting, and say so when a release contains a migration.
- At release time `Unreleased` becomes `## [1.2.0] - 2026-11-20` and a fresh empty `Unreleased` goes above it.

## Making a release

1. `main` is green in CI, and `:latest` has been running on the maintainer's server for a while without trouble.
2. In `CHANGELOG.md`, turn `Unreleased` into the new version and date; check the level against the rules above (a migration means at least minor).
3. Set the version everywhere: `npm version 1.2.0 --workspaces --include-workspace-root --no-git-tag-version` (updates every `package.json` and the lockfile).
4. Commit as `Release 1.2.0`, tag it `v1.2.0` (`git tag -a v1.2.0 -m "Cairn 1.2.0"`), push the commit, then the tag.
5. CI builds and pushes the version tags of both images and creates the GitHub Release with that version's changelog section as its notes.
6. Check the release page and that `docker pull ghcr.io/nicolelee-io/cairn:1.2.0` works without a login.

A bad release is never re-tagged: fix it and release the next patch.

## GitHub settings

- **Branch protection on `main`** (a ruleset, Settings > Rules):
  - Block force pushes and deletion, with **no bypass** for anyone.
  - Require linear history.
  - Require a pull request and the CI `check` job to pass, with the repository admin (the maintainer) allowed to **bypass**, so small changes can still be pushed straight to `main`. Everyone else has to go through a PR with green CI. GitHub notes each bypass on the push; that is expected.
  - CI skips docs-only pushes to `main` (`paths-ignore`, so no image is rebuilt for them) but runs on every pull request, because a required check that never runs blocks a PR forever. Keep it that way: don't add `paths-ignore` to the `pull_request` trigger.
- **Merge buttons:** allow squash and rebase merging, turn off merge commits; delete head branches after merge.
- **Tag protection:** a ruleset on `v*` tags blocking updates and deletion, so a published version can't move.
- **Security:** private vulnerability reporting on; Dependabot alerts and security updates on (version-update PRs are optional and noisy).
- **Actions:** read-only `GITHUB_TOKEN` by default; the publish job asks for `packages: write` itself.

## Contributions and security reports

- `CONTRIBUTING.md`: a personal project. Issues, bug reports and ideas are welcome; **ask in an issue before opening a pull request**, since it may not fit the plan. A PR follows the rules above (CI green, a changelog line).
- `SECURITY.md`: report vulnerabilities privately through GitHub's "Report a vulnerability", not in a public issue. Only the latest release is supported.
