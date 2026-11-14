---
name: triage
description: Triage Cairn's docs/todo-and-ideas.md and docs/tech-debt.md: move Inbox items to Next, Soon, Later or Parked, sort and group items, merge duplicates, flag stale or finished ones, fill in missing estimates, and propose a priority order. Use when asked to "triage", "sort out the todo", "prioritize", "clean up the backlog" or "what should I do next". Edits the docs only, no code changes.
---

# Triage the todo and tech-debt lists

Read the rules at the top of both docs first (the section meanings and the `_Est_` legend in `docs/todo-and-ideas.md`); they are the source of truth and this skill must not contradict them. **Edit only `docs/todo-and-ideas.md` and `docs/tech-debt.md`.** No code changes, no commits. `docs/tech-debt.md` may have uncommitted edits from the user: change it only with targeted edits, never `git checkout` or `git stash`, and check `git diff docs/` before and after so you can tell your changes from theirs.

The user may give a scope ("just the inbox", "only tech debt", "what's next?"). Without one, do the whole pass below. Note that `add-item` leaves priority to the user: triage is where it is decided.

## 1. Read everything

Read both docs in full, plus the headings of `docs/todo-completed.md` (to catch items already done). Build a picture before changing anything: item count per section, which Inbox items are new, which items mention each other.

## 2. Check items against the code

Cheap checks only (`grep`, `ls`, a look at the named file), and only for items you plan to move, merge or flag:
- Is a named file, component or route still there? If an entry cites a path that no longer exists, fix the path when the new one is obvious, otherwise flag it.
- Does a todo look already built (it appears in `todo-completed.md`, or the code clearly has it)? Does a tech-debt entry look already fixed? Flag it as probably done; do not delete it unless it is plainly finished. The user decides.
- Is an `_Est_` clearly off, or missing? Add or adjust it using the legend (Sonnet for well-scoped work that follows existing patterns, Opus for cross-cutting, design-heavy or security/data-safety work; XS/S/M/L/XL). Keep the reason short.

## 3. Todo list: place each item

Move every **Inbox** item to a section, by *when*, not by how important it sounds:
- **Next**: what gets picked up next. Keep it to about 3-5 items. Candidates: it unblocks other work, it fixes something users hit often, or it is small and clearly valuable.
- **Soon**: worth doing, no rush.
- **Later**: a real idea that is low value for its cost, or waits on something.
- **Parked**: XL or strategic, not planned without a decision first.
- **Open Questions**: it is really a decision to make; rephrase it as a question.

Ordering rules:
- Within a section, order by the sequence you would do them in: dependencies first, then value for cost. Do not just append.
- Items that share code or a feature area sit together, and closely related ones become one bullet (see merging below).
- Do not move items already in **Soon**, **Later** or **Parked** between sections unless there is a reason you can state in one line (it became a dependency, it is now cheap, it was done). **Next** is the exception: if it holds more than about 5 items or an item that is no longer next, propose changes.

**Promoting anything into Next, or demoting something out of it, is a priority call. Propose it and wait for the user's go-ahead** (use AskUserQuestion if it is available, otherwise stop and list the proposal) rather than deciding alone. Moving Inbox items into Soon, Later or Parked, reordering, merging and fixing estimates can be done directly; report each.

## 4. Tech-debt list: sort and group

`docs/tech-debt.md` has no priority sections, so triage means order and grouping inside its sections (Bugs, Server, Web, or any other that exists):
- **Bugs** first by severity: data loss or wrong data, then broken flows, then glitches, then flaky tests. Put cosmetic bugs after.
- In **Server** and **Web**, put security and data-safety items first, then items that will bite when a named upcoming feature lands (read the entry's _Look at this when_), then the rest. Items marked "no fix planned" or "leave this until it fails again" go last.
- Move an entry to the section where it belongs if it was filed in the wrong one (a UI glitch in Server, a server issue in Web). Do not create sections.
- Merge entries about the same problem into one, keeping every distinct detail.
- Check each entry has the shape the doc asks for (area, problem, `_Fix_`, `_Look at this when_`, `_Est_`) where there is enough information to fill it in. Do not invent a fix or a trigger.
- Tech-debt bullets that are really features ("I wish it did more") belong in the todo list: move them to Inbox's decided section and tell the user.

## 5. Cross-list links

Look for todo items and tech-debt entries that touch the same code or the same feature. Where fixing the tech-debt entry is cheap and sits inside work that is in **Next**, say so in the report ("do X with Y") and add a one-line `_Fix together with_` note to the bullet if one is not already there. The project rule is to fix related tech debt in the code you are already editing.

## 6. Keep the formats

- Match the surrounding bullets. Todo bullets: `- What, and why or how. _Est: Sonnet, S (short reason)._` Blank line between todo bullets, as the file does.
- Preserve each item's meaning and details exactly. Triage moves, merges and annotates; it does not rewrite items or drop information. When merging, the combined bullet carries all the content of both.
- An empty section says `Queue empty.` (Next) or the existing placeholder; replace the placeholder when you add the first item, and restore it if you empty a section. Inbox says "None to triage" when empty; check how the file words it before editing.
- Plain hyphens and commas, not em dashes. No emoji.
- Never touch **Completed** or `todo-completed.md`. If an item is finished, flag it; the user decides whether it moves.

## 7. Check and report

Run `git diff docs/` and confirm the changes are only the intended ones, and that the user's earlier uncommitted tech-debt edit is intact. Check that no bullet was lost: count bullets before and after and account for any difference (merges).

Reply compactly:
1. **Moved**: one short line per Inbox item, `item (short name) -> section, why`.
2. **Proposed, waiting on you**: Next promotions or demotions, probable duplicates or done items you did not remove.
3. **Merged / fixed / re-estimated**: one line each.
4. **Suggested order**: the first 3-5 things to pick up, with the estimate for each and any tech debt worth bundling.

Do not paste the docs back.
