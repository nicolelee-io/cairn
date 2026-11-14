# Proposal: writing prompts

Status: **built** (2026-11-04), with the changes listed under "Changes made while building" at the end. Follow-ups are in [todo-and-ideas.md](../todo-and-ideas.md). The text below is the design as proposed; where the two differ, the SPEC's Phase 8 note and the area notes (`apps/web/CLAUDE.md`, `apps/server/CLAUDE.md`) describe what exists. Modelled on Day One's Prompts screen, with a different layout and with the user's own prompts leading.

## Summary

A prompt is a question that starts an entry ("What recurring thought have I noticed lately?"). Each user keeps their own list of prompts. The admin keeps a server-wide list of **suggested prompts** that users can browse and save into their own list. A new Prompts page (sidebar, drawer and bottom bar) shows three **daily prompts** drawn from the user's own list, a way to see all their prompts, and buttons to browse the suggested ones or add their own.

This replaces the older todo idea of copying the server's packs into each new account. The suggested list is read live, a user saves what they like, and the codebase ships no default prompts.

## Decisions so far

- **No packs.** Day One's packs (Reflection, Gratitude, Fun, Mindfulness) become **categories**: a label on a prompt, not a container.
- **Admins manage categories; users only pick from them.** One shared set keeps icons and filters consistent and avoids a family ending up with ten versions of "Gratitude". A user can leave a prompt uncategorized. Per-user categories would be an additive change later.
- **Name:** "Suggested prompts" in the UI. "Gallery" and "built-in" are out: the admin writes these, and "built-in" suggests they ship in code.
- **Admin editing lives in Settings > Server**, not on the Prompts page. It is set up once and forgotten.
- **Daily prompts draw only from the user's own prompts.** A new user sees an empty state that leads to Browse suggested prompts, not a fallback to suggested ones.
- **Editor format:** the prompt becomes a `# ` heading (the user writes `#`, not `##`, for headings) followed by a blank line. `summarize()` takes a `#` heading as the title, so the prompt becomes the entry's title.
- **A prompt has at most one category.**
- Prompts are not stored on the entry. Day One's `promptID` stays in `source_raw`.

## Prompts page (`/prompts`)

Top to bottom:

1. **Daily prompts:** three tonal cards (`secondary-container`), stacked on a phone and in three columns from 840px. Each shows the prompt in Literata and a small category chip. Tapping a card opens a new entry with it. A refresh button in the section header pulls three new ones.
2. **Your prompts (N):** one row that opens `/prompts/all`. It is a page rather than an inline expansion because the list may run to hundreds. It has category filter chips, search, and Edit and Delete in the row's context menu (`useMenuTrigger`).
3. **Two buttons:**
   - **Browse suggested prompts** (`/prompts/suggested`): grouped by category, a Save button on each prompt, "Saved" once saved, and "Save all" per category.
   - **Add your own prompt**: a dialog with the text and a category select.

Empty state (no prompts yet): "Save a few suggested prompts to get started", with the browse button.

Navigation: a Prompts item in `NavContent` (between Insights and Search) and a third tab in `BottomBar`. Both are `TopLink`s.

### Daily prompts, stable through the day

- Today's three prompt ids are stored in localStorage with the local date, so they don't change between page loads and adding or deleting a prompt mid-day doesn't reshuffle them. Ids whose prompt is gone are dropped and topped up.
- Refresh and each new day take the next three from a **shuffle bag** (a shuffled order plus a position, in localStorage), so nothing repeats until the list is used up. The bag reshuffles when it runs out or when the list changes.
- Not a true date seed: a phone and a laptop can show different prompts on the same day. A server-side seed would fix that for little gain, so it is not planned.

## Data (one migration)

- `prompt_category`: `id` (UUID v7), `name`, `icon`, `position`, timestamps. Server-wide, so it has no `user_id` (an exception to the user-scoped rule, like `app_setting`: it is not user content).
- `prompt`: `id`, `user_id` (indexed; **null means a suggested prompt**), `text`, `category_id` (nullable, set null when the category is deleted), `source_prompt_id` (nullable, set when a user saves a suggested prompt, so the browse list can show "Saved" and not offer it twice; no foreign key, so deleting the suggested prompt leaves the user's copy alone), timestamps.
- Settings-like data, so no `rev` or tombstones: rows are deleted outright, as in the notifications proposal.
- Deleting a category never deletes prompts and never reads their content.

## Server

- `repo/prompts.ts` has two separate function sets: `userPrompts(db, userId)`, which always filters `user_id = userId`, and `suggestedPrompts(db)`, which filters `user_id IS NULL`. Routes never query tables directly.
- Zod schemas in `packages/shared/src/prompts.ts`. Limits: 200 characters per prompt, 2000 prompts per user, 30 categories, 2000 suggested prompts.
- Routes (all behind a session):
  - `GET /api/prompts/categories`: readable by everyone.
  - `GET /api/prompts/mine`, `POST /api/prompts/mine`, `PATCH` and `DELETE /api/prompts/mine/:id`: the caller's own.
  - `POST /api/prompts/mine/from-suggested`: save one or many by id, or a whole category; idempotent through `source_prompt_id`.
  - `GET /api/prompts/suggested`: readable by everyone.
  - Admin only (403 otherwise): `POST`, `PATCH` and `DELETE` for suggested prompts and for categories, plus the JSON import below.

## Admin: Settings > Server > Suggested prompts (`/settings/prompts`)

- **Categories:** add, rename, pick an icon from a small curated Material Symbols list, reorder, delete.
- **Prompts:** add, edit and delete, with a category filter. It reuses the row component and prompt dialog from My Prompts.

### JSON import

The format is nested by category, so it is easy to write by hand or have an LLM generate:

```json
{ "categories": [
  { "name": "Reflection", "icon": "psychology",
    "prompts": ["What recurring thought have I noticed lately?", "..."] }
] }
```

- **Merge only.** Categories match by name, ignoring case, and are created when missing. A prompt whose exact text is already in that scope is skipped, so importing the same file twice changes nothing.
- **Preview first:** a dry-run call returns a summary such as "2 new categories, 41 new prompts, 6 already there, 1 unknown icon (the default is used)", and the admin confirms before anything is written.
- Zod validates the file, capped at 1 MB and 500 prompts. Replace-all is deliberately left out: deleting is done in the UI.

## Editor handoff

"Write about this" goes to `/new?prompt=<text>`. `NewEntryPage` seeds the editor with `# <prompt>` and a blank line, with the cursor below it. The text sits in the draft, so closing the editor keeps it. It opens in the default journal, as `/new` does.

## Testing

- Server: isolation (user A cannot list, edit, delete or save from user B's prompts, admins included); the admin gate on every suggested-prompt and category write; limits; category delete leaves prompts uncategorized; save is idempotent; JSON import preview and merge (re-import is a no-op, unknown icon, bad shape).
- Unit: the shuffle bag (no repeats until used up, reshuffle on list change) and the daily-prompts top-up.
- e2e (Playwright, phone and desktop): daily cards, refresh, saving a suggested prompt, adding one, writing from a card.
- `verify-ui` check in light and dark.

## Not in the first version

- Prompt reminders: the notification reminders' rotating text should draw from the user's prompts (see [notifications-proposal.md](notifications-proposal.md)), once that work exists.
- User prompts in the export, and syncing them into the offline copies. Online-only; the last-fetched list is cached in localStorage so the daily cards still show offline, and writing from one works offline because `/new` does.
- A "Give me a prompt" button inside the editor.
- A per-account "Show Prompts" switch under Settings > App.
- Per-user categories, sharing prompts between users, and replace-all import.

## Plan and estimate

One branch, commits as each stage is confirmed. _Sonnet, M to L._

1. Migration, repo, routes and shared schemas, with the server tests above.
2. Prompts page: daily cards, shuffle bag, `/prompts/all`, the add dialog, the nav item and the bottom bar tab.
3. Browse suggested prompts, with Save and Save all.
4. Admin settings page: categories, prompts and JSON import with preview.
5. Editor handoff, e2e and the `verify-ui` check.
6. Docs: area notes in `apps/web/CLAUDE.md` and `apps/server/CLAUDE.md`, SPEC.md Phase 8 notes, the README features list and CLAUDE.md status; move the todo item to `todo-completed.md`.

## Open

Nothing. The four points above (admin-managed categories, "Suggested prompts", the empty state, one category per prompt) were confirmed before stage 1.

## Changes made while building

Found by using it with a library of about 485 imported prompts:

- **Suggested prompts start collapsed** by category, 50 prompts at a time inside an open one, with a search across all of them (a search opens the categories with matches, and Save all becomes Save N for the matches). One long page was unmanageable at that size.
- **Bulk delete** for your own prompts and for the admin's suggested ones: a Select mode, Select all N (everything matching the search and filter), and a confirmed delete (`POST /mine/bulk-delete`, `POST /suggested/bulk-delete`). Only selected prompts that are still shown are deleted.
- **Pick a category** on the Prompts page: choose one of the categories your prompts use and get three random ones from it, from a shuffle bag per category.
- **The dialog's category choice is a row of chips**, not a `Select`, because a `Select`'s list is clipped by a dialog's edges.
- **The editor handoff seeds the baseline, not just the text**: a new entry from a prompt starts as `# <prompt>` plus a blank line with the caret below it, and an untouched one closes without asking and leaves no draft.
- The admin page is Settings > Server > Suggested prompts (`/settings/prompts`); the JSON import's preview is a server dry run.
