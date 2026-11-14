# Known issues

Things that don't work the way you might expect, and that Cairn doesn't plan to fix. Bugs we do plan to fix are in [tech-debt.md](tech-debt.md).

## Day One compatibility

Cairn is a Markdown journal. It has no rich text editing and doesn't plan to: what you write is Markdown, and that is what the export carries. Day One keeps formatting in a second, private field (`richText`) next to the Markdown `text`, and some of its features exist only there. The exporter leaves `richText` out on purpose (it would go stale once an entry is edited), and the importer reads `text` only. So these don't round-trip:

- **Checklists import into Day One as plain bullets.** Cairn writes `- [ ] Item`, the same Markdown Day One writes in its own `text` for a checklist. Day One only makes a real checklist from `richText` (`listStyle: "checkbox"`), so an imported one shows as a bulleted list whose checkboxes render clipped at the edge of the editor. Checked state is kept in the text (`[x]`) and in Cairn, just not as a Day One checkbox. Found 2026-11-06 by importing an export into Day One.
- **A list that ends on an empty item can break the last item in Day One.** Pressing Enter on the last list line leaves an empty `-` (or `1.`, `- [ ]`). In Day One's editor the line before it can show as a bold heading. Delete the empty item before exporting. Found 2026-11-06; Cairn leaves the text as written.
- **Underline, highlight and text colour are lost when importing from Day One.** Markdown has no form for them, and they live only in `richText`, which the importer ignores. The original is still in the entry's `source_raw`, but Cairn shows and exports the plain text. Found 2026-11-04.
- **Lists from Day One arrive as loose lists** (a blank line between items). They render the same, but the raw text has more blank lines than a list written in Cairn.

See [export-format.md](export-format.md) for what the export contains.
