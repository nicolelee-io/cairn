import {
  checklist,
  codeBlock,
  divider,
  link,
  prefixLines,
  table,
  type Edit,
} from './markdownEdit.ts'
import { numericDate, timeLabel } from './format.ts'

/** What an insert needs to know: the moment it is made and the entry's own timezone. */
export interface InsertContext {
  now: number
  timezone: string
}

/** One thing the slash menu (and later the header menu and palette) can put into the text. */
export interface InsertItem {
  id: string
  label: string
  group: string
  /** Extra words the slash menu matches besides the label. */
  keywords: string[]
  /** A short example of what it inserts, shown beside the label; null when the label says it. */
  preview?: (ctx: InsertContext) => string | null
  /** The edit at the current selection, built like the toolbar's (`lib/markdownEdit`). */
  build(value: string, start: number, end: number, ctx: InsertContext): Edit
}

/** Types `text` at the caret, replacing any selection, and puts the caret after it. */
export function typed(text: string): InsertItem['build'] {
  return (_value, start, end) => ({
    from: start,
    to: end,
    insert: text,
    selStart: start + text.length,
    selEnd: start + text.length,
  })
}

/** The date `days` from today on the clock in `tz` (calendar days, so a DST day can't skip one). */
export function shiftedDate(now: number, tz: string, days: number): string {
  const [m, d, y] = numericDate(now, tz).split('/').map(Number) as [number, number, number]
  // Noon UTC, read back in UTC, so no zone or DST rule can move it to another day.
  return numericDate(Date.UTC(y, m - 1, d + days, 12), 'UTC')
}

/** '11/6/2026, 3:04 PM' on the entry's clock. */
export const dateAndTime = (ctx: InsertContext) =>
  `${numericDate(ctx.now, ctx.timezone)}, ${timeLabel(ctx.now, ctx.timezone)}`

const dated = (id: string, label: string, keywords: string[], text: (c: InsertContext) => string) =>
  ({
    id,
    label,
    group: 'Date and time',
    keywords,
    preview: text,
    build: (value, start, end, ctx) => typed(text(ctx))(value, start, end, ctx),
  }) satisfies InsertItem

const format = (id: string, label: string, keywords: string[], build: InsertItem['build']) =>
  ({ id, label, group: 'Format', keywords, build }) satisfies InsertItem

/** The built-in inserts, in the order the slash menu lists them. */
export const BUILT_IN_ITEMS: InsertItem[] = [
  dated('date', 'Date', ['today'], (c) => numericDate(c.now, c.timezone)),
  dated('time', 'Time', ['now', 'clock'], (c) => timeLabel(c.now, c.timezone)),
  dated('datetime', 'Date and time', ['now', 'timestamp'], dateAndTime),
  dated('yesterday', 'Yesterday', ['date', 'previous'], (c) => shiftedDate(c.now, c.timezone, -1)),
  dated('tomorrow', 'Tomorrow', ['date', 'next'], (c) => shiftedDate(c.now, c.timezone, 1)),
  format('h1', 'Heading 1', ['title', 'header', 'h1'], (v, s, e) => prefixLines(v, s, e, '# ')),
  format('h2', 'Heading 2', ['header', 'h2'], (v, s, e) => prefixLines(v, s, e, '## ')),
  format('h3', 'Heading 3', ['header', 'h3'], (v, s, e) => prefixLines(v, s, e, '### ')),
  format('bullets', 'Bulleted list', ['list', 'bullets', 'ul'], (v, s, e) =>
    prefixLines(v, s, e, '- '),
  ),
  format('numbers', 'Numbered list', ['list', 'ordered', 'ol'], (v, s, e) =>
    prefixLines(v, s, e, '1. '),
  ),
  format('checklist', 'Checklist', ['todo', 'task', 'checkbox'], checklist),
  format('quote', 'Quote', ['blockquote'], (v, s, e) => prefixLines(v, s, e, '> ')),
  format('code', 'Code block', ['fence', 'pre'], codeBlock),
  format('link', 'Link', ['url', 'href'], link),
  format('table', 'Table', ['grid', 'columns'], table),
  format('divider', 'Divider', ['rule', 'line', 'hr', 'separator'], divider),
]

/** The items whose label or keywords start with a word of `query` (all of them for an empty one). */
export function matchItems(items: InsertItem[], query: string): InsertItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  // Spaces don't count against the label ("daily l" finds "Daily log"). One word may also begin any
  // word of the label or a keyword ("head" finds Heading 1; "todo" finds Checklist).
  const flat = q.replace(/\s+/g, '')
  const oneWord = flat === q
  const words = (i: InsertItem) => [...i.label.toLowerCase().split(/\s+/), ...i.keywords]
  const label = (i: InsertItem) => i.label.toLowerCase().replace(/\s+/g, '')
  const hits = items.filter(
    (i) => label(i).startsWith(flat) || (oneWord && words(i).some((w) => w.startsWith(q))),
  )
  // A label that starts with what was typed comes first ("/da" lists Date before Yesterday).
  return [
    ...hits.filter((i) => label(i).startsWith(flat)),
    ...hits.filter((i) => !label(i).startsWith(flat)),
  ]
}
