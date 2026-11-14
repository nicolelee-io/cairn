# Component reuse proposal (web)

Status (2026-11-04): all items are done. 1–8 are built (see "Built" at the end), 9 (list rows) is built (see "Built", item 9), and the `EntryEditor.tsx` split (10) is finished. Covers `apps/web` only. On the server, the one known duplication (the create-by-client-id logic) is already in [tech-debt.md](../tech-debt.md).

## Where things stand

The large building blocks are already shared and mostly well cut:

- `EntryCard` is the one card for the timeline, Search, Insights' On this day, the calendar's `DayEntries` and the list skeleton.
- `JournalBadge`, `Avatar`, `Markdown`, `Lightbox`, `Skeleton`/`LoadingState`, `NeedsConnection`, `Page` and `Section` each have one owner.
- `ui/dialog.tsx`, `ui/button.tsx` and `ui/select.tsx` are the primitives.
- Behaviour is shared through hooks: `useEntryMenu` and `useEntryPatch` (used by both the card and the reader), `useMenuTrigger`, `useSwipe`, `useEntryFlip`, `useShortcuts`.

The duplication sits one level down, in the pieces those components are made of. The same chip, dot, row, empty panel, dialog footer and small helper gets written out by hand each time. Several copies have already drifted apart (see 4 and 5), which is the real cost: a change to "the journal chip" or "the date chip" today means finding every copy.

Each item below lists what is repeated, where, and the proposed shared piece, ordered by value. None of them changes how anything looks, except where a **Decision** is noted.

---

## 1. Entry meta chips and the date label

**Repeated:** the rounded footer chip (`inline-flex h-10 min-w-0 max-w-full items-center gap-2 rounded-full bg-surface-container-high px-3 text-sm`) appears 4 times in `EntryReader.tsx` (284, 297, 303, 315), 4 times in `EntryEditor.tsx` (747, 764, 786, 819) and once more in `ReaderSkeleton`. The short-on-phone / full-from-600px date text (`shortDate · timeLabel` vs `fullDate · timeWithZone`, with "All day") is written out 3 times: in the reader, the skeleton and the editor.

**Proposal:** `components/MetaChip.tsx`:

- `MetaChip`: the chip shell. It renders a `span`, a `button` (adding `state-layer cursor-pointer`) or a `Link`, takes an `icon`, an icon tone (`muted` / `tertiary`), a `filled` flag and children. A `style` prop covers the journal chip's wash.
- `EntryWhen({ createdAt, timezone, allDay })`: the two responsive date spans.

The reader footer, the skeleton and the editor footer then become lists of `MetaChip`s. This is also the first step of the `EntryMetaBar` extraction that tech-debt.md's `EntryEditor.tsx` item asks for.

_Est: Sonnet, S. Pure refactor; check with verify-ui (reader and editor, phone and desktop)._

## 2. Journal dot and journal chip

**Repeated:** the "colour dot with a `bg-primary` fallback" (`style={color ? { background: color } : undefined}`) is hand-written in 6 places, at 4 sizes:

| Where                                                    | Size       |
| -------------------------------------------------------- | ---------- |
| `EntryCard.tsx:132` (card's journal chip)                | `size-2`   |
| `EntryReader.tsx:318` (reader's journal chip)            | `size-2.5` |
| `StoragePage.tsx:153` (per-journal row)                  | `size-2.5` |
| `ui/select.tsx:158` (`Dot`, the editor's journal picker) | `size-2.5` |
| `ActionDialogs.tsx:83` (Move to journal)                 | `size-3`   |
| `TrashPage.tsx:286` (trashed journal tile)               | `size-4`   |

The card's chip and the reader's chip are also the same idea (wash + dot + name), built twice with different wash percentages and dot sizes.

**Proposal:** in `JournalBadge.tsx`, next to the badge:

- `JournalDot({ color, size: 'sm' | 'md' | 'lg' })`, used by all six places and by `select.tsx`'s `Dot`.
- `JournalChip({ journal, to?, density: 'card' | 'footer' })` for the card and the reader. The reader's version is a `MetaChip` (item 1) with a dot.

**Decided (2026-11-03):** Trash, Storage and Move to journal show the journal's emoji `JournalBadge`, as the sidebar and Manage journals do. `JournalDot` stays for the places where a badge doesn't fit: the card's and the reader's journal chips, and the editor's journal select. Update the web CLAUDE.md's line "the Trash page and the menu pills still use plain dots" when this lands.

_Est: Sonnet, S._

## 3. `useJournal(id)`

**Repeated:** `journals.data?.find((j) => j.id === someId)` is written 15 times: `EntryCard`, `EntryReader` (twice), `EntriesPane`, `BrowseLayout`, `CalendarView`, `DetailsView`, `DayEntries`, `InsightsPage`, `ActionDialogs`, `TrashPage`, `DraftsPage`, `menuActions.ts`, `EntryEditor`, `NewEntryPage`.

**Proposal:** `useJournal(id)` (and a plain `journalById(journals, id)` for loops and non-hook code) in `lib/queries.ts`. Small, but it removes noise from a dozen components and gives one place to memoise a lookup map if the list ever grows.

_Est: Sonnet, XS._

## 4. Entry pane header and the pin/star buttons

**Repeated:** the reader (`EntryReader.tsx:169`), its skeleton (389) and the editor (`EntryEditor.tsx:562`) each build the same sticky 56px header (`sticky top-0 z-20 -mx-4 flex h-14 items-center gap-1 px-2 medium:-mx-8 medium:px-6`). The skeleton's copy is missing the sticky and negative-margin classes, so the lead button sits 8px off from where it lands once the entry loads.

The pin and star buttons are written separately in each, and they have **drifted**:

|               | Reader                                          | Editor                                     |
| ------------- | ----------------------------------------------- | ------------------------------------------ |
| Label         | changes: "Unpin" / "Remove star"                | fixed: "Pin" / "Star"                      |
| Pressed state | `aria-pressed` too (pressed is announced twice) | `aria-pressed` only                        |
| Colour        | `text-tertiary` on the icon                     | `aria-pressed:text-tertiary` on the button |

**Proposal:**

- `EntryPaneHeader({ surface, children })` for the shell.
- `FlagToggle({ kind: 'pin' | 'star', on, disabled, title, onToggle })` for the two buttons, used by both screens.

**Decided (2026-11-03):** a fixed label plus `aria-pressed` (the editor's way) in both. Update the e2e tests that find "Unpin" or "Remove star" by name.

_Est: Sonnet, S._

## 5. The entry's display label

**Repeated, and inconsistent:** the "what to call this entry" fallback is worked out 4 ways:

- `EntryCard.tsx:59`: `title || excerpt.slice(0, 60) || 'Untitled entry'`.
- `TrashPage.tsx:235`: the same, but without the slice.
- `CommandPalette.tsx:126`: the same, also without the slice.
- `EntryReader.tsx:96`: re-derives it from the first line of the body with its own `^#+` regex. This doesn't match `summarize()`, so the reader's menu title can differ from the card's for the same entry. For example, a long first line gets a title on the reader but none on the card.

**Proposal:** `entryLabel({ title, excerpt })` in `packages/shared/src/entryCard.ts` beside `summarize()`. The reader calls `entryLabel(summarize(bodyMd))`. It gets one unit test.

_Est: Sonnet, XS._

## 6. Small helpers written more than once

| Helper                                                            | Copies                                                                                                                                                                                    | Move to                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `errorCode(e)` (the `ApiError` body's `error`)                    | exported from `lib/trash.ts`, redefined in `UsersPage`, `AccountCard` and `LocationDialog`, inlined in `EntryEditor:453` and `PhotoQualityCard:75`                                        | `lib/api.ts` (it belongs with `ApiError`)                                                                                  |
| `plural(n, one, many)`                                            | `TrashPage`, `StoragePage`, `PhotoQualityCard`                                                                                                                                            | `lib/format.ts`                                                                                                            |
| `/api/photos/${id}/<kind>`                                        | 11 sites: `EntryCard`, `TrashPage`, `MediaView`, `PhotoStrip` (×2), `Markdown` (×2), `Lightbox` (×2), `cm/livePreview.ts`; a private `photoUrl(id, kind)` already exists in `lib/sync.ts` | export that `photoUrl` from a `lib/photos.ts` and use it everywhere                                                        |
| `window.matchMedia('(pointer: coarse)')` passed to `openMenuFrom` | `EntryReader:242`, `TrashPage:169`                                                                                                                                                        | default `openMenuFrom`'s sheet flag to a coarse pointer (`isCoarse()` in `lib/pointer.ts`, which `haptics.ts` can use too) |
| An initial in a circle                                            | `Avatar` for me, hand-built in `UsersPage:99` for each user                                                                                                                               | give `Avatar` an optional `name` (and later `src`) so Manage users uses it                                                 |

_Est: Sonnet, XS each; one commit for the lot._

## 7. Empty state panel

**Repeated:** the "cairn mark + message" panel (`flex flex-col items-center gap-2 rounded-lg bg-surface-container-low p-8 text-center text-on-surface-variant` with `<CairnMark>`) appears in `TimelineList`, `SearchPage`, `MediaView`, `DraftsPage` and `InsightsPage`. Insights' copy has already drifted to `rounded-xl`. (`BrowseLayout`'s large journal-coloured cairn is the "no entry open" pane, a different thing; leave it alone.)

**Proposal:** `components/EmptyState.tsx` (`{ children, action? }`).

_Est: Sonnet, XS._

## 8. Dialog action rows and confirm dialogs

**Repeated:** about 19 dialog footers are written by hand in two layouts:

- `flex justify-end gap-2`: Trash, journal dialogs, Sync, Settings, Users, Tags (×3), Account (×2), Photo quality, `TagDialog`, the editor's conflict dialog.
- Stacked full-width on a phone with the main action on top: Drafts' discard, the editor's leave dialog.

Seven files build a destructive "Are you sure?" dialog from scratch: Trash purge, Drafts discard, journal delete, tag delete and merge, user disable, Sync, Settings. Each one wires its own title, body, error line and pending state.

**Proposal:**

- `DialogActions` in `ui/dialog.tsx` for the layout.
- `ConfirmDialog({ open, title, children, confirmLabel, destructive, pending, error, onConfirm, onClose })` built on it. Most of the seven become about 10 lines each. Multi-step dialogs (Tags' merge picker, Users' steps) keep their own body and use `DialogActions` only.

**Decided (2026-11-03):** `DialogActions` is a right-aligned row by default, with the main action last (Material 3's standard dialog). A `stacked` prop gives full-width buttons on a phone, with the main action on top, and switches back to the row from 600px. Use `stacked` only when the buttons don't fit side by side on a phone: three actions, or long labels. Today that means the editor's leave dialog. Drafts' discard dialog (two short buttons) moves to the row.

_Est: Sonnet, S to M (many call sites; e2e covers most of these dialogs)._

## 9. List rows (lower priority)

Trash, Drafts, Manage users, Manage tags, Manage journals, Storage, the Move picker and the Account card each build a "lead, title, one or two muted lines, trailing buttons" row with slightly different paddings (`py-3 pl-4`, `px-4 py-3`, `px-3 py-3`, `min-h-12 px-3`, `min-h-16 px-4`).

**Proposal:** a slim `ListRow({ as, lead, title, lines, trailing })` used where the shape really is the same: Trash, Users, Tags, the Move picker and the Account card. Manage journals (drag grip, reorder) and Storage (byte bars) should keep their own markup. Don't force those in.

Not recommended: making the Drafts row an `EntryCard`. It looks similar, but its data (a draft, not a `TimelineItem`), its actions (discard) and its link target all differ. If anything, share only an `EntrySummaryText` (title plus clamped excerpt).

_Est: Sonnet, M. Do it after 1–8, when the rows are already simpler._ Built; see "Built" below.

## 10. `EntryEditor.tsx`

Done: the editor was split into `useEntryDraft`, `useSaveEntry` and `EntryMetaBar`. Items 1, 4 and 5 here take the first bites out of it (footer chips, header, toggles), so the remaining split is about state, not markup. This proposal doesn't add a separate plan for it.

---

## Suggested order

All four steps are done.

1. **Helpers:** items 3, 5 and 6, in one commit. No UI change; unit tests for `entryLabel`.
2. **Entry pieces:** items 1, 2 and 4 together (`MetaChip`, `EntryWhen`, `JournalDot`/`JournalChip`, `EntryPaneHeader`, `FlagToggle`). They touch the same three files. Run verify-ui on the reader and the editor at phone and desktop widths in light and dark, then the entry e2e specs.
3. **Shell pieces:** items 7 and 8 (`EmptyState`, `DialogActions`/`ConfirmDialog`). Run the full e2e.
4. **Rows:** item 9, if 1–3 leave it still worth doing.

Update the area notes as each lands: the web CLAUDE.md's journal-colour and loading paragraphs and the editor CLAUDE.md's footer paragraph should name the new components, so later work reaches for them instead of copying markup. Each component gets a one-line doc comment saying what it is for, as `JournalBadge` has.

## Decisions

All three open questions were settled on 2026-11-03:

- **Item 2:** Trash, Storage and Move to journal show the emoji `JournalBadge`.
- **Item 4:** pin and star have a fixed label plus `aria-pressed` in both the reader and the editor.
- **Item 8:** dialog actions are a row by default, and stacked on a phone only when they don't fit.

## Built (2026-11-03)

Items 1–8, as proposed, with these details:

- **Item 1:** `MetaChip` and `EntryWhen` are in `components/MetaChip.tsx`.
- **Items 2 and 4:** `JournalDot` and `JournalChip` sit beside `JournalBadge`; `EntryPaneHeader` and `FlagToggle` are in `components/EntryHeader.tsx`. The reader's loading skeleton now uses the same header, so its Back button no longer jumps 8px when the entry loads.
- **Trash badges:** the trash journal list (`GET /api/trash/journals`) now returns `icon` so Trash can show the badge, and purging a journal now clears its icon along with its name, description and colour. In Storage the badge sits beside both lines of the row (`SizeRow`'s new `lead` slot).
- **Item 5:** `entryLabel` clips a title-less excerpt at 60 characters with an ellipsis everywhere (the card used to cut without one; Trash and the palette didn't cut at all).
- **Item 6:** `openMenuFrom`'s last argument now defaults to `isCoarse()`.
- **Item 7:** `EmptyState` uses `rounded-xl` everywhere, matching the cards it stands in for (four of the five copies were `rounded-lg`).
- **Item 8:** `DialogActions` and `ConfirmDialog` are in `ui/dialog.tsx`. Moved onto `ConfirmDialog`: journal delete, Clear data on this device, Sign out, Trash purge, Drafts discard, tag delete and merge, user disable, Compress existing photos, and the journal dialog's Discard changes (whose Discard is now a filled red button, like Drafts'). Manage users' dialogs lost an extra `pb-6` that doubled the dialog body's own bottom padding.

## Built (2026-11-04)

- **Item 9:** `ListRow` is in `components/ListRow.tsx` and is used by Trash, Manage users, Manage tags, the Move picker and the Account card (including its static Role row). The tappable area is a button, a link or plain text (`as`); `trailing` sits beside it, `end` inside it, and `liProps` carries Trash's menu trigger. Rows now share `px-4 py-3` and `gap-3`; Manage users' avatar gap went from 16px to 12px, and the Account rows and Move picker keep their heights through `targetClassName`.
