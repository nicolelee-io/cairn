# Proposal: more writes and search offline

Status: **proposed** (2026-11-05). Scoped after the offline audit ("Offline: say what needs a connection, and sync account settings"), which made every server-only control either work offline or say it needs a connection. This proposal moves some of those from "needs a connection" to "works offline". Build it in the phase order below, one phase per commit, and update this status line as phases land.

Progress: **all six phases built and committed (2026-11-05)**; phase 6 is the last commit. Phase 4's "Waiting to move to Trash" list on the Trash page was added afterwards.

Read first: `apps/web/src/lib/CLAUDE.md` (outbox, local store, sync, local reads, and the "Everything either works offline or says it needs a connection" rule), `apps/web/CLAUDE.md` (Settings, journals, Trash, Tags), `apps/server/src/search/CLAUDE.md` (phase 5), and `e2e/CLAUDE.md` plus `e2e/offline-outbox.spec.ts` for the offline test helpers.

## Scope

In:

1. Groundwork: the outbox carries more than entry saves.
2. Account settings saved offline (Settings > App, and the default timezone and default journal).
3. Creating and editing journals offline (create, rename, recolor, icon, description, archive, unarchive, reorder).
4. Deleting entries and journals offline (to the trash), with Undo.
5. Basic offline search over the journals kept on the device.
6. Tag suggestions in the editor with no journals kept (small).

Out, on purpose:

- **Browsing or restoring the Trash offline.** The sync feed sends a trashed item as a deleted id and the device drops it, so showing the trash offline would need the server to send trashed content and the device to keep it. That is a sync and data-safety change for something rarely done offline. The Trash page stays online-only (`NeedsConnection`), except that it may list deletes still waiting to be sent (phase 4).
- Deleting, renaming or merging tags (Manage tags stays online-only).
- Display name, username, password and picture (the last two need the current password checked; the picture is an upload).
- Uploads (photos, attachments), export, Insights, the map, places and weather lookups.
- Search parity with the server: no stemming and no "Best match" ranking offline (phase 5).

## How things work today (the parts this touches)

- **Outbox** (`apps/web/src/lib/outbox.ts`, table `outbox` in `lib/localDb.ts`). When a save can't reach the server (`isUnreachable`), `sendOrQueue` parks the exact request (`method`, `path`, `body`) as an `OutboxRow` and the caller carries on as if saved. `enqueue` folds a later save of the same entry into the waiting one: PATCH over PATCH merges fields and keeps the first `baseRev`; PATCH over a waiting POST becomes part of the create. `flushOutbox` replays in `seq` order under the Web Lock `cairn-outbox-replay`. Unreachable or 401 stops the replay and keeps the rest; any other refusal drops the item, restores its draft into localStorage and raises `ServerBanner` with a Review link.
- **The row is entry-shaped.** `OutboxRow.entryId` is the subject of the save, and the Dexie index is `outbox: '++seq, &entryId'` (unique). The replay parses every answer with `EntryDetailSchema`. `ServerBanner`'s text speaks of "your text is back as a draft".
- **Overlays.** Reads that didn't come live from the server get waiting saves laid over them: `withPendingEdits` and `pendingCreateDetail` for one entry (`fetchEntry`), and `withPendingCards` for `/entries` list pages, registered into `api()` through `setOverlayHook` (`api.ts` can't import `outbox.ts`). The hook is only applied to responses that came from the local copy or the service worker's cache, never to a live answer.
- **Local reads** (`lib/localRead.ts`) answer `GET /entries`, `/entries/:id`, `/tags` and `/journals` from the device copy when the server can't be reached.
- **Account** (`useMe` in `auth/useAuth.ts`, `staleTime: Infinity`). `refreshMe` re-reads it on tab focus, `online` and every 5 minutes, and ignores the service worker's cached copy (it can predate a change made on this device). Never invalidate `keys.me` offline: an errored `me` query makes `AuthGate` show its error screen in place of the app.
- **Offline UI rule:** a control that can't work offline is disabled with `OfflineNote`, a whole block becomes `NeedsConnection`, Settings shows an `OfflineBanner`. Each phase below **removes** those guards for what it makes work, and must keep them for what it doesn't.

## Phase 1: groundwork (generalise the outbox)

The riskiest phase: a mistake here can lose or duplicate a write. Keep entry behaviour byte-for-byte the same (all existing `outbox.test.ts` cases must pass unchanged) and add tests for each new kind.

### Data

Add a `kind` field to `OutboxRow`:

```ts
type OutboxKind = 'entry' | 'journal' | 'journal-order' | 'me' | 'delete-entry' | 'delete-journal'
kind?: OutboxKind // absent on rows queued before this change: treat as 'entry'
```

Keep the `entryId` column as the unique **subject key** (no Dexie version bump, no data migration; `kind` isn't indexed). Values:

| kind             | key (`entryId` column)                                    | method, path                                                   |
| ---------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| `entry`          | the entry id (unchanged)                                  | POST `/entries`, PATCH `/entries/:id`                          |
| `delete-entry`   | the entry id (same key: a delete replaces a waiting edit) | DELETE `/entries/:id`                                          |
| `journal`        | `journal:<id>`                                            | POST `/journals` (with the client `id`), PATCH `/journals/:id` |
| `delete-journal` | `journal:<id>`                                            | DELETE `/journals/:id`                                         |
| `journal-order`  | `journal-order`                                           | PUT `/journals/order`                                          |
| `me`             | `me`                                                      | PATCH `/auth/me`                                               |

Widen `method` to include `'PUT' | 'DELETE'`. Add a small `outboxKey(kind, id)` helper and use it everywhere, so no caller builds the prefix by hand. Add a comment on `OutboxRow.entryId` saying it is the subject key and why it kept its name.

### Merge rules (`enqueue`)

Existing entry rules stay as they are. New ones:

- `journal` PATCH over a waiting `journal` PATCH: merge fields (later wins). Journals have no `baseRev`; the server takes the last write.
- `journal` PATCH over a waiting `journal` POST: fold the fields into the create (the archive flag included; if the server's create doesn't accept `archived`, keep a follow-up PATCH queued instead: check `CreateJournalSchema` before deciding).
- `me` over `me`: merge fields (later wins).
- `journal-order` over `journal-order`: replace (keep the original `seq`, as entries do).
- `delete-entry` over a waiting entry **PATCH**: replace it with the delete (the edit is moot). Keep the edit's draft on the row so a refused delete can still give the text back.
- `delete-entry` over a waiting entry **POST**: the entry never reached the server: delete the row and queue nothing.
- `delete-journal` over a waiting journal **POST**: cancel the create, and also drop every waiting entry create whose `body.journalId` is that journal (and their drafts' `newId` slots are left alone; the user deleted the journal on purpose).
- `delete-journal` over a waiting journal PATCH: replace it.
- An entry PATCH or POST arriving while a `delete-entry` waits for that entry: the UI shouldn't allow it (the entry is hidden), but if it happens, keep the delete and drop the edit.

### Replay (`flushOutbox`)

Pick the response schema and the cache updates per kind:

- `entry`: unchanged (`EntryDetailSchema`, `keys.entry`, `invalidateAfterSave`).
- `journal`, `journal-order`: `JournalSchema` / `z.array(JournalSchema)`; then `invalidateAfterSave` and invalidate `keys.me` (the default journal can change).
- `me`: `MeSchema`; `qc.setQueryData(keys.me, withTempUnit(me))`.
- `delete-entry`, `delete-journal`: no body (204). `invalidateAfterTrash` (in `lib/trash.ts`), and `qc.removeQueries({ queryKey: keys.entry(id) })` for an entry.

Refusals, per kind (a refusal is any answer other than unreachable or 401; the item is dropped and the banner raised):

- `entry`: unchanged (restore the draft, Review opens it).
- `delete-entry` or `delete-journal` answered **404**: count it as done (already gone or already in the trash); no banner.
- `journal`: no draft to restore. Review goes to `/journals`.
- `me`: Review goes to `/settings`.
- `delete-entry` (other refusals): restore the kept draft if any; Review goes to `/entry/:id`.

### Banner wording

`outboxState` holds `failed` and `review`. Add `message` (the text of the last failure) and set it per kind. `ServerBanner` shows it instead of its fixed sentence. Suggested texts:

- entry: keep today's sentence.
- journal: "A journal change couldn't be saved (the server refused it)."
- me: "A settings change couldn't be saved."
- deletes: "A delete couldn't be sent. The entry is back." / "The journal is back."

### Overlays

Generalise the overlay hook so it can lay pending writes over more than `/entries` pages: dispatch by path inside the hook (`/entries`, `/entries/:id` via `fetchEntry`, `/journals`, `/tags` stays as is). Phases 2 to 4 each add their path. Keep the rule that overlays only apply to answers that didn't come live from the server, except where noted for `me` (phase 2).

### Tests

`outbox.test.ts`: one case per merge rule above, a replay test per kind (success, 404 delete, refusal with the right `review` and `message`), and an "old row without `kind`" case that replays as an entry. Use `fake-indexeddb/auto` as the existing tests do.

### Done when

Typecheck, lint, all unit tests and the offline e2e specs (`npm run e2e -- offline`) pass with no behaviour change visible to the user.

_Est: S to M._

## Phase 2: account settings offline

What: temperature unit, auto location, show archived journals in the menu, default timezone, and default journal (from Settings and from the journal dialog and context menu). Not the display name (keep it online-only: it is rare and shown in many places; easy to add later).

- `useUpdateMe` (`auth/useAuth.ts`) sends through a new `sendOrQueueMe` (or a `kind`-aware `sendOrQueue`). When queued, it updates the `me` cache optimistically (`qc.setQueryData(keys.me, ...)` merged with the body, through `withTempUnit`) so the switch moves and the unit applies at once.
- **The overlay on `me` must apply to every read while a `me` item waits, live ones included**: `useMe`'s query function and `refreshMe` lay the waiting fields over whatever they read. Otherwise the 5-minute `refreshMe` (or a reload) flips the switch back until the replay lands.
- A queued `defaultJournalId` that points at a journal created offline is fine: the replay is in `seq` order, so the journal create goes first.
- UI: in `SettingsPage.tsx`, remove `disabled={down}` from the App controls (and from Default timezone in `AccountCard`). The `OfflineBanner` text changes to say what still waits, e.g. "Your name, username, password and picture can be changed once you're back online, and server settings are hidden. Everything else saves and syncs later." In the journal dialog and `useJournalMenu`, "Make default" stops being disabled offline.
- Tests: unit (merge, overlay survives a `refreshMe`), e2e: go offline, switch "Show archived journals in the menu" and the temperature unit, check the UI follows, come back online, check the server has them (`api` fixture). Note `e2e/CLAUDE.md`: don't flip account-wide settings on the shared e2e user; sign in a user of your own, like `newUser` in `prompts.spec.ts` (local to that file: move it into `e2e/helpers/` rather than copying it).

_Est: S._

## Phase 3: creating and editing journals offline

The server is ready: `POST /journals` accepts a client `id` and a replayed create with the same id returns the existing journal (`apps/server/src/routes/journals.ts`). Generate the id with `uuidv7` from `@cairn/shared`, as the editor does for new entries (`useEntryDraft.ts`).

- `JournalDialog.tsx`: the save and archive mutations go through the queue. On a queued create, close the dialog as if saved. Remove the offline guards added by the offline audit for create, save, archive and unarchive; **keep Delete guarded until phase 4**. `JournalsPage.tsx`: re-enable New journal and the reorder grips (reorder queues a `journal-order`; keep the optimistic cache update it already does). `NewJournalDialog` and the nav's + then just work.
- Overlay `/journals` (local copy and service-worker answers): waiting creates appended with `entryCount: 0`, waiting PATCHes merged in, waiting `journal-order` applied to `sortOrder`. Everything that lists journals reads `useJournals`, so the nav, Manage journals, the Move picker, the export picker and the New entry menu follow.
- **Entries in a journal that only exists offline.** A new entry in it is a waiting entry create whose `journalId` is the waiting journal's id; the replay sends the journal first (lower `seq`). Check: `withPendingCards` shows it on `/j/<id>` (it filters by `journalId`), the timeline for that journal answers locally even though the journal isn't kept on the device (today `localRead` may return nothing for a journal it doesn't keep; return an empty page so the overlay can add the waiting entries), and the journal header (`EntriesPane`) finds the journal through `useJournal`.
- **Keep on this device** for a journal created offline: hide the switch (or show it off and disabled with "Available once synced") until the journal has reached the server; `useOfflineControls` and `/sync/estimate` don't know it yet. If "Keep all journals" is on, the next sync picks it up by itself.
- A refused journal create (rare: validation, `id_taken`) means its waiting entries will be refused too (journal not found): they come back as drafts by the existing entry rule. Make sure the banner shows one sensible message, not one per entry (show the count: "3 changes couldn't be saved").
- Tests: unit for the `/journals` overlay; e2e: offline, create a journal, write an entry in it, rename another journal, archive a third, reorder, come back online, check the server state matches and nothing is duplicated.

_Est: M._

## Phase 4: deleting entries and journals offline

- **Entry delete** (`useDeleteEntry` in `lib/trash.ts`, used by the context menu and the reader's More menu): if unreachable, queue a `delete-entry` (rules above) and behave as online: leave the reader, toast "Moved to Trash" with Undo. **Undo while the delete is still queued removes the queued row** (and, if it replaced a waiting edit, puts that edit back: simplest is to keep the replaced edit inside the delete row and restore it on Undo). Undo after the delete was sent stays as today (restore through the server, which needs a connection; if offline, toast "Restore it from Trash once you're back online").
- **Journal delete** (`JournalDeleteDialog` in `components/JournalConfirmDialogs.tsx`): queue a `delete-journal`; close the dialogs as online. The toast's "View" link to `/trash` stays (the Trash page says it needs a connection).
- **Hide what is waiting to be deleted** everywhere reads are overlaid: `/entries` pages (drop cards of waiting `delete-entry` items, and all cards whose journal has a waiting `delete-journal`), `/entries/:id` (`fetchEntry` answers 404-like so the reader shows its "not found" state), `/journals` (drop the journal), `/tags` counts may be left stale (acceptable; they correct on the next sync). Remember these overlays only run on non-live answers; online, the delete is sent immediately anyway.
- Remove the offline guards: the `disabled: NEEDS_CONNECTION` on entry Delete and journal Delete in `lib/menuActions.ts`, and the journal dialog's Delete.
- Trash page: optional small addition: while offline, above the `NeedsConnection` panel, list "Waiting to move to Trash" items from the outbox with Undo. Skip it if it gets fiddly.
- Tests: unit for each merge rule touching deletes; e2e: offline, delete an entry (gone from the list), Undo (back), delete it again, delete a journal, come back online, check both are in the server's trash.

_Est: S to M._

## Phase 5: basic offline search

Search the journals kept on the device when the server can't be reached. Online, search always goes to the server.

- **Shared text code.** Move `markdownToPlain` (`apps/server/src/search/plain.ts`, 20 lines, pure) to `packages/shared` and import it from both sides (keep its test with it). The card title split (`summarize`) is already shared in `packages/shared/src/entryCard.ts`.
- **Local search** in `lib/localRead.ts` (or a new `lib/localSearch.ts` it calls): answer `GET /search` in the server's exact shape (`SearchPageSchema`: timeline card fields plus `snippet`, `titleMarked`, `snippetField`; same `SNIPPET_OPEN`/`SNIPPET_CLOSE` markers). Matching, to mirror `apps/server/src/search/match.ts` as far as is cheap:
  - normalise both sides: lowercase, Unicode NFD with combining marks removed (so "cafe" finds "café");
  - words are letters and digits; every word must match (AND); a "quoted phrase" must match as a run of words; the last word matches as a prefix;
  - no stemming ("walking" doesn't find "walked"); say so in the UI note below.
  - fields: title, plain body, place name, tags. `snippetField` is `body` when the body matched, else `tags` or `place`, as the server does.
  - filters: `journalId`, `starred`, `attachments` (an entry with any non-photo attachment in the local `attachments` table), `tag` (ignoring case), `includeArchived` (same rule as the server: archived journals excluded unless `includeArchived` or `journalId` names one).
  - sort: newest first only; a `sort=relevance` request is answered newest first.
  - cursor: an offset, like the server's.
  - snippet: about 20 words of plain body around the first match, matched words wrapped in the markers; `titleMarked` the title with its matches marked.
  - A full scan of the kept entries per query is fine at journal sizes (a few thousand). Debounce is already in `SearchPage`.
- `GET /search/matches` (the reader's highlights for `/entry/:id?q=`): answer it locally too, with the words of that entry the query matched.
- Wire it in where `localRead` dispatches by path, so `api()` uses it on the same fallbacks as the other local reads.
- **UI** (`pages/SearchPage.tsx`): while `useServerDown()` and the answer came from the device, show one `OfflineNote` above the results: "Searching the N journals kept on this device. Exact word forms only." If no journals are kept, keep today's `NeedsConnection` panel (its text already points to keeping journals). The command palette's entry search (`components/CommandPalette.tsx`) gets offline results for free through `api()`; check its "needs the server" comment and empty state still read right.
- Tests: unit tests for the matcher (accents, phrase, prefix, AND, filters, archived rule, snippet markers); e2e: keep a journal on the device (see `offline-copies.spec.ts`), go offline, search a word from one of its entries, see the result and its highlight in the reader.

_Est: M._

## Phase 6: tag suggestions with nothing kept (small)

Adding tags offline already works (tags are part of the entry save and queue with it). The editor's tag suggestions come from `useTags`, which offline is answered from the kept journals only, so with nothing kept the list is empty. Remember the last tag list the way prompts do (`lib/prompts.ts`: `cairn:prompts-cache:<userId>:<name>` in localStorage, used as `initialData` and refetched) and fall back to it when `/tags` can't be read. Add an e2e case: offline, add a new and an existing tag to an entry, come back online, check the server has both.

_Est: XS._

## Order and estimate

1. Phase 1 (groundwork), then 2 (settings, the smallest real user of it), 3 (journals), 4 (deletes).
2. Phases 5 and 6 don't depend on the groundwork; they can go first or in parallel.

Altogether roughly two days of hands-on work including tests and e2e runs (S is 1-2 hours, M half a day, as in `todo-and-ideas.md`). Phase 1 is the one to take slowly: if anything about the merge rules is unclear while building, stop and ask rather than guess.

## Every phase

- Update the area notes in the same change: `apps/web/src/lib/CLAUDE.md` (outbox kinds, overlays, and the list in "Everything either works offline or says it needs a connection"), `apps/web/CLAUDE.md` (Settings, journals, Trash, search as they change), `apps/server/src/search/CLAUDE.md` when `plain.ts` moves. Check `README.md`'s offline line and SPEC.md's Phase 7 note ("queued deletes and journal edits" are listed there as not built on purpose; update it when phases 3 and 4 land).
- Remove only the offline guards the phase makes unnecessary; grep for `useServerDown`, `OfflineNote`, `NeedsConnection` and `NEEDS_CONNECTION` in the files you touch.
- Run `npm run typecheck`, `npm run lint`, `npx vitest run --maxWorkers=2`, and `npm run e2e -- --workers=2` for the specs the phase touches (always `offline`), and check the UI with the `verify-ui` skill (light and dark, phone and desktop). To get the offline state in a dev instance, stop the private server and dispatch an `online` event in the page (a `visibilitychange` doesn't fire in headless Chrome).
- Log anything left half-done in `docs/tech-debt.md`.
