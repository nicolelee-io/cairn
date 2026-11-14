## e2e (Playwright)

Local-only browser tests; the full guide is [docs/e2e-testing.md](../docs/e2e-testing.md). Run `npm run e2e` before calling a change to a covered flow done (auth, journals, entry write/edit, drafts, conflict, search, navigation, timezone display, photos, attachments, date/time, map, entry views (Details, Media, Calendar, scroll per view), export, offline outbox and copies, settings, account, tags, users and roles, writing prompts, keyboard shortcuts (desktop only), slash commands, templates).

- Each run builds the web app and serves it from the server (`tsx`) on :3200 with a fresh `e2e/.data`; never point it at `data-dev`, the dev servers or real data.
- Import `test`/`expect` from `helpers/test.ts` (fixtures `api` and `journal`). Tests share one database and run in parallel: stay inside your own `journal`, use unique words, never assert cross-journal totals.
- Role/label locators only; add an `aria-label` to the app instead of a `data-testid`. Use `typeInEditor` for CodeMirror (Android UA needs line breaks as text input; full-speed typing is deliberate).
- Offline: `goOffline`/`goOnline` from `helpers/offline.ts`, never `context.setOffline` alone (it doesn't reach the service worker's fetches).
- Don't flip account-wide settings (temperature unit, default journal): every test shares the account in parallel. `account.spec.ts` is the exception: it changes names, timezone, username and password, so it signs in as its own per-project users (`accountUser()` in `env.ts`, created by `start-server.ts`) and runs serially.
- The shared `e2e` user is the seeded first user, so an admin; the `account-*` users are plain users. `users.spec.ts` makes its own uniquely named users and signs them in with `browser.newContext`; so does `prompts.spec.ts` (`newUser`), because the daily prompt cards draw from a user's whole list, which must be one nobody else adds to. It seeds uniquely named categories and suggested prompts as the admin.
- Templates belong to the shared user, not to a journal, and the phone and desktop projects run at the same time: `templates.spec.ts` gives every template a unique name (`unique()`) and deletes what it made (`api.deleteTemplate`, in a `finally`). The slash menu lists the user's templates, so a spec that counts or orders its options must not assume only the built-ins are there.
- When a UI change renames a button, label or heading, update the specs in the same change.
- Readiness is checked on `[::1]` because WSL2 mirrored networking hangs on closed IPv4 loopback ports.
