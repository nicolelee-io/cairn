# End-to-end tests (Playwright)

Browser tests that drive the real app the way you use it: sign in, write and edit entries, manage
journals, search, upload photos and attachments, at phone and desktop widths. They are a **local check before
calling a change done**, not part of CI. CI only typechecks and lints them, so they keep
compiling. Unit tests (Vitest) still cover the logic; these cover the screens and how they fit
together.

## Running

```
npm run e2e                                  # everything, both widths (~35 s)
npm run e2e -- entry                         # spec files whose name matches "entry"
npm run e2e -- --project=phone               # one width
npm run e2e -- -g "Keep mine"                # tests whose title matches
npm run e2e -- --repeat-each 3               # hunt for flaky tests
npx playwright show-report e2e/.report       # the HTML report of the last run
npx playwright show-trace e2e/.results/<test>/trace.zip   # step through a failure
npm run e2e -- --ui --ui-port=9323           # UI mode in a browser tab (WSL has no window for it)
```

Docker is **not** needed, and neither is `npm run dev`. Your dev servers (3000/5173) and the
verify-ui instance (3100/5273) can stay running; the tests use port **3200**.

First time on a machine: `npx playwright install chromium-headless-shell` (after `npm install`).
Run it again when Playwright is upgraded and says its browser is missing.

## What a run does

1. `e2e/start-server.ts` deletes `e2e/.data`, builds the web app (`vite build`, about a second)
   and starts the server from source with `tsx`, serving that build like production does
   (`WEB_DIST`). Production build on purpose: the service worker, the CSP and the SPA fallback
   only exist there.
2. The server creates a fresh database with one user, `e2e`, and no Google API key (place search
   and weather stay off; tests never call Google).
3. `auth.setup.ts` signs in once through the login screen and saves the session to `e2e/.auth/`.
   Every other test starts signed in from it.
4. The specs run in parallel under two projects: **phone** (Pixel 7: 412 px wide, touch, Android
   user agent) and **desktop** (1400 × 900, sidebar plus two panes). The browser timezone is
   `America/Denver`.

Nothing here touches `data-dev` or the real journal. `e2e/.data`, `.auth`, `.results` and
`.report` are git-ignored and thrown away on the next run.

## Coverage

| Spec             | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`           | Wrong password refused; a deep link while signed out shows the login and then the page asked for; sign out asks first and ends the session on the server.                                                                                                                                                                                                                                                                                          |
| `journals`       | Create (shows in the nav); rename and recolor; archive takes it out of the nav; delete after confirming.                                                                                                                                                                                                                                                                                                                                           |
| `entry`          | Write markdown, set mood and star, save; the reader renders it and shows raw HTML as text without running it; the card shows title, excerpt and mood; edit, save, reload; on the phone a real touch swipe in the reader goes to the older and newer entry and stops at the ends.                                                                                                                                                                   |
| `drafts`         | Leaving the editor keeps a draft; toast, Drafts page, resume, discard.                                                                                                                                                                                                                                                                                                                                                                             |
| `conflict`       | The entry changes elsewhere while the editor is open; Keep mine and Use theirs each save the right text.                                                                                                                                                                                                                                                                                                                                           |
| `search`         | A word finds its entry with the match marked and opens it; Starred with no words lists starred entries only.                                                                                                                                                                                                                                                                                                                                       |
| `navigation`     | Phone: list or reader, bottom bar and FAB hide while reading, Back keeps the scroll position, drawer opens a journal. Desktop: sidebar, list and reader side by side, and the immersive edit toggle hides both and sticks. Both: a deep link survives a reload (the server's SPA fallback).                                                                                                                                                        |
| `timezone`       | Viewer in New York, entry written in Tokyo: the list and reader show Tokyo's date and time.                                                                                                                                                                                                                                                                                                                                                        |
| `photos`         | Upload two photos in the editor; they render in the reader, the lightbox steps between them (buttons on desktop, a real touch swipe on the phone), the card has a thumbnail and "+1".                                                                                                                                                                                                                                                              |
| `touch`          | Phone only, real touch events: a control gets a 44px tap target, no screen scrolls sideways because of it, the view switch does not move when the list scrolls, the menu drawer closes on a left swipe, and pulling the touch menu sheet's handle down closes it.                                                                                                                                                                                  |
| `datetime`       | Picking a new day in the date dialog moves the entry in the list and keeps the time; changing only the timezone keeps the wall clock.                                                                                                                                                                                                                                                                                                              |
| `map`            | Entries with a place are pins ("2 of 3 entries have a place"); it opens on the densest area with Show all; a pin opens its entry; the List/Map choice survives a reload. OpenStreetMap tiles are blocked, so nothing leaves the machine.                                                                                                                                                                                                           |
| `export`         | Export one journal without photos; the zip holds exactly that journal's `.json` with the entry.                                                                                                                                                                                                                                                                                                                                                    |
| `offline-outbox` | Offline, Save still closes the editor and the entry opens from the queue; the status says "Offline · 1 waiting to sync" and the server has nothing; back online it syncs by itself. The Place dialog offline asks you to reconnect to search and saves your location as coordinates.                                                                                                                                                               |
| `offline-copies` | Keep a journal on the device, then go offline: an entry never opened before reads from the local copy mid-session, and a full reload with no server still opens the journal and its entries (service worker shell plus local copy).                                                                                                                                                                                                                |
| `settings`       | A forced Dark theme applies and survives a reload, and System clears it; on the phone, the bottom bar switch hides the bar for good.                                                                                                                                                                                                                                                                                                               |
| `insights`       | On this day opens an entry in a popup on desktop (the URL stays `/insights`; Back and Esc close it; Edit goes to the editor) and as the full-screen reader on a phone.                                                                                                                                                                                                                                                                             |
| `views`          | The Entries view selector: Details shows the description and the entry, day (by each entry's own timezone) and media counts, and the choice survives a reload; Media lists a file tile with its entry date, narrows by type chip and a tile opens its entry; Calendar marks a day with an entry and opens it; each view keeps its own scroll position (the calendar's jump never moves the list; at both widths, which scroll different elements). |
| `tags`           | Tag an entry in the editor (case-insensitive), filter the list by it from the reader's chip, remove it; search by tag alone and with words, a tag-only match is labelled, and Manage tags renames, merges (from the Merge into… picker, and by renaming onto another tag) and deletes, and shows "Needs connection" instead of the list while offline.                                                                                             |

Some tests only make sense at one width and skip the other (the run shows them as skipped).

**Not covered on purpose:** visual appearance and light/dark (the `verify-ui` skill does that by
eye; screenshot comparisons would break with every polish change), the Day One importer and
user-to-user isolation (Vitest covers both well), real Google calls, Insights (Vitest covers the maths and the endpoints; no e2e yet),
the backup sidecar.

**Left out for now:** the temperature unit and other account-wide settings (every test shares one
account and runs in parallel, so a test that flips one could break another mid-run), and place
or weather editing (needs Google).

## Writing a test

- Import `test` and `expect` from `e2e/helpers/test.ts`, not from `@playwright/test`. It adds:
  - `journal`: a fresh journal with a unique name, made for this test.
  - `api`: seeds and reads data through the real API (`createEntry`, `updateEntry`, `getEntry`,
    `createJournal`, `listJournals`, `uploadFile` for a PDF attachment, which an entry then names in its text). Set up state this way rather than by clicking, unless
    the clicking is what the test is about.
- **One database for all tests, run in parallel.** Work inside your own `journal`, use unique
  words when searching, and never assert totals across journals ("All Entries" holds every
  test's entries).
- **Find things the way a person does:** `getByRole`, `getByLabel`, visible text. If a control
  has no accessible name, give it an `aria-label` in the app (it helps screen readers too)
  rather than adding a `data-testid`.
- `helpers/ui.ts` has the layout-aware bits: `fab(page)` (the New entry button, not the
  sidebar's +), `openNav(page)` (sidebar on desktop, opens the drawer on a phone),
  `entriesPane` / `entryPane`, and `typeInEditor`.
- `isPhone(info.project.name)` branches where the layouts differ (for example, Back to the list
  on a phone); `test.skip(...)` when a test only applies to one width.
- A test that signs out must use its own session: `test.use({ storageState: { cookies: [],
origins: [] } })`, as `auth.spec.ts` does. Signing out the shared session would sign out
  every other test running at the same time.
- Make test files at run time (`photos.spec.ts` draws plain coloured JPEGs with sharp). Never
  commit a real photo or journal text.

## Gotchas

- **WSL2 mirrored networking:** connecting to a closed port on `127.0.0.1` hangs for about two
  minutes instead of being refused. Playwright checks the port before starting the server, so
  the config polls `http://[::1]:3200` instead. If a run sits at the start for minutes, that is
  the cause.
- **Typing in the editor on the phone project:** with an Android user agent CodeMirror leaves
  Enter to the on-screen keyboard, so a synthetic Enter keypress does nothing. `typeInEditor`
  sends line breaks as text input there. Use it rather than `keyboard.type` directly.
- `typeInEditor` types at full speed on purpose. That is how the suite found the editor dropping
  keystrokes when input arrived faster than React rendered (fixed in `MarkdownEditor`); keep it
  that way so the bug stays fixed.
- `sharp` is loaded with `createRequire` in specs: a static import breaks Playwright's ESM loader
  ("Unexpected module status 3").
- **Going offline in a test:** use `goOffline` / `goOnline` from `helpers/offline.ts`, never
  `context.setOffline` alone. Chromium's offline emulation doesn't cover the service worker's own
  fetches, so its network-first reads would still reach the server and the test would pass
  without testing anything. The helpers also abort every request to the app, and
  `serverUnreachable(page)` proves it. `setOffline` is still part of it because it makes
  `navigator.onLine` false and fires the `offline` event, which is what a phone in a tunnel does.
- A test that needs the service worker (offline reloads) calls `waitForServiceWorker(page)`
  first; it only registers in a production build, which is what the suite runs.
- Opening `/new` directly and saving leaves the reader as the first page in the tab, where Back
  leaves the app (a known bug in [tech-debt.md](tech-debt.md)). Start from a list and use the
  New entry button, as a real session does.
