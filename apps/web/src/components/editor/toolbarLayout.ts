/**
 * How much of the mouse toolbar fits. Every group starts as a row of buttons; when the row would
 * run into undo/redo, groups fold into one menu button each, in `FOLD_ORDER`, until it fits.
 * The sums match the markup in `Toolbar.tsx` (36px buttons, a 2px gap, a divider that is 1px wide
 * with 4px either side), so change them together.
 */
export type ToolGroup = 'heading' | 'styling' | 'blocks' | 'attach'

const BUTTON = 36
const GAP = 2
const DIVIDER = 9

/** Headings fold first (three buttons into one), then the lists, the attachments, the marks last. */
export const FOLD_ORDER: ToolGroup[] = ['heading', 'blocks', 'attach', 'styling']

/** The groups, left to right, and how many buttons each has when it is open. */
export function foldedGroups(
  available: number,
  groups: { id: ToolGroup; count: number }[],
): Set<ToolGroup> {
  const folded = new Set<ToolGroup>()
  const width = () => {
    const items = groups.reduce((n, g) => n + (folded.has(g.id) ? 1 : g.count), 0)
    const children = items + (groups.length - 1) // the dividers are children of the same flex row
    return items * BUTTON + (groups.length - 1) * DIVIDER + (children - 1) * GAP
  }
  for (const id of FOLD_ORDER) {
    if (width() <= available) break
    if (groups.some((g) => g.id === id)) folded.add(id)
  }
  return folded
}
