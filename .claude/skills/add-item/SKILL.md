---
name: add-item
description: Add one or more items to Cairn's docs, either docs/todo-and-ideas.md (features, ideas, questions, polish) or docs/tech-debt.md (bugs, tech debt, fragile spots). Decides which list and section each item belongs in, then edits the docs only. Use when asked to "add to the todo", "log a bug", "note this down" or similar. No code changes.
model: haiku
---

# Log items to the todo or tech-debt list

Your only job is to put each item the user gives you in the right doc and section. **Edit only `docs/todo-and-ideas.md` and `docs/tech-debt.md`.** Do not change code, do not fix the bug, do not commit. The user may give one item or several (a list, or a paragraph with several things in it): handle every one.

## 1. Split the input into items

One item per distinct thing. If a message mixes two things ("X is broken and we should also add Y"), that is two items. Keep the user's meaning; do not invent details or requirements they did not give. If an item is too vague to write down usefully, still log it as given and say so in your reply; do not stop to ask.

## 2. Pick the doc for each item

- **`docs/tech-debt.md`**: something is wrong or fragile. A bug, a regression, flaky test, a shortcut or known limitation, a missing test, a refactor that is wanted, a cleanup.
- **`docs/todo-and-ideas.md`**: something to build or decide. A new feature, an improvement to something that works, an idea, a question to settle, UI polish.

When in doubt: "it does the wrong thing" is tech debt; "I wish it did more" is a todo.

## 3. Pick the section

Read the headings of both files first (`grep -n '^## ' docs/*.md`), and read the section you are adding to so the new line matches its neighbours.

`docs/todo-and-ideas.md`:
Sections are about *when*, not importance. You do not decide priority; triage is the user's call.
- **Inbox**: the default for every new feature, idea or polish item. The section may say "None to triage"; replace that line when adding the first one.
- **Next**, **Soon**, **Later**, **Parked**: only when the user names the section or says plainly when ("do this next", "someday", "park it"). Words like "essential" or "important" alone are not enough; use Inbox and mention it in your reply.
- **Open Questions**: a decision to make, phrased as a question.
- Small refinements to UI or behaviour that already exists start with `Polish:`; there is no separate Polish section.
- Never add to **Completed**; finished items live in `todo-completed.md`, which you do not touch.

`docs/tech-debt.md`:
- **Bugs**: user-visible wrong behaviour, or a visible glitch.
- **Server**: tech debt or fragility in `apps/server` (repo layer, auth, import, export, search, migrations, backup).
- **Web**: tech debt or fragility in `apps/web` (components, lib, editor, e2e tests).
- If the file has another section that fits better, use it. Do not create a new section unless nothing fits; if you do, say so in your reply.

Add the item at the **end** of its section, before the next `##` heading, unless the section is clearly ordered by priority.

If a new todo item overlaps an existing one (same feature, shared code), extend that bullet instead of adding a new one, wherever it sits (see step 5).

## 4. Write the entry

Match the format of the entries around it. Look at two or three first.

- **todo-and-ideas.md**: one bullet, `- What to build, and why or how if the user said. _Est: Sonnet, S (short reason)._`
- **tech-debt.md**: one bullet, `- **Area** (`file/path`): the problem. _Fix_: what to do. _Look at this when_: the trigger. _Est: Sonnet, S._` A bug can be just the problem and how to reproduce it. Drop `_Fix_` and `_Look at this when_` if the user gave nothing to base them on.

Rules:
- Name files, components or routes only if the user mentioned them or a quick search (`grep`, `ls`) confirms them. Never guess a path.
- Add an `_Est: model, size_` line, using the legend at the top of `docs/todo-and-ideas.md`: Sonnet for well-scoped work that follows existing patterns, Opus for cross-cutting, design-heavy or security/data-safety work; XS under 30 min, S 1-2 h, M half a day, L 1-2 days, XL more. It is a rough guess; keep the reason short. If you cannot guess, leave it out.
- Keep it to one bullet, a few sentences at most. Plain wording, no emoji.
- Use plain hyphens and commas, not em dashes, like the rest of the docs.

## 5. Avoid duplicates

Before adding, search both docs for the item's key words (`grep -n -i 'word' docs/todo-and-ideas.md docs/tech-debt.md`). If the same item already exists, do not add it again; if it is close but adds new information, extend the existing bullet instead. Report either case.

## 6. Check and report

Run `git diff docs/` and confirm only the intended lines changed. `docs/tech-debt.md` may already have an uncommitted change from the user; leave it alone.

Reply with one short line per item: what was logged, the file and section. Put a blank line between items so each one reads separately. Mention any duplicate, any new section, and anything vague. Do not paste the docs back.
