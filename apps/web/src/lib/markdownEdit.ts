// Pure helpers for the editor toolbar. Each returns a text replacement plus where the selection
// should land afterwards; the component applies it so the browser's undo stack stays intact.

export interface Edit {
  /** Replace value[from, to) with `insert`. */
  from: number
  to: number
  insert: string
  /** Selection after the edit, in the new text's coordinates. */
  selStart: number
  selEnd: number
}

/** Whether value[start, end) sits inside a pair of `mark`s. */
function isWrapped(value: string, start: number, end: number, mark: string): boolean {
  const n = mark.length
  if (value.slice(start - n, start) !== mark || value.slice(end, end + n) !== mark) return false
  if (n > 1) return true
  // A lone * or _ is also half of ** or __ (bold), or of *** (both): look at the whole run on each
  // side. An odd run holds an emphasis, an even one is bold alone.
  let before = 0
  while (value[start - 1 - before] === mark) before++
  let after = 0
  while (value[end + after] === mark) after++
  return Math.min(before, after) % 2 === 1
}

/**
 * Bold, italic and the like: wraps the selection in `mark`, or unwraps it if it is already wrapped
 * in `mark` or one of `alt` (italic also takes apart the older `_text_`).
 */
export function wrap(
  value: string,
  start: number,
  end: number,
  mark: string,
  placeholder: string,
  alt: string[] = [],
): Edit {
  const sel = value.slice(start, end)
  const m = mark.length
  const found = sel ? [mark, ...alt].find((k) => isWrapped(value, start, end, k)) : undefined
  if (found) {
    const n = found.length
    return { from: start - n, to: end + n, insert: sel, selStart: start - n, selEnd: end - n }
  }
  const inner = sel || placeholder
  return {
    from: start,
    to: end,
    insert: mark + inner + mark,
    selStart: start + m,
    selEnd: start + m + inner.length,
  }
}

/** Bold: `**` works in the middle of a word and in every renderer. */
export const bold = (v: string, s: number, e: number) => wrap(v, s, e, '**', 'bold')
/** Italic: `*`, not `_`, which doesn't italicise inside a word (`A_cat_meow`); takes apart `_x_` too. */
export const italic = (v: string, s: number, e: number) => wrap(v, s, e, '*', 'italic', ['_'])
export const strikethrough = (v: string, s: number, e: number) =>
  wrap(v, s, e, '~~', 'strikethrough')
/**
 * A divider (`---`) as its own block after the line the selection ends on (never mid-line: the
 * selection may sit inside `**bold**`, and a block there would split the markup). The blank line
 * above it matters: right under a line of text, `---` would make that text a heading.
 */
export function divider(value: string, _start: number, end: number): Edit {
  const nl = value.indexOf('\n', end)
  const at = nl === -1 ? value.length : nl
  return insertBlock(value, at, at, '---')
}

/** Link: `[selection](url)` with `url` selected; with no selection, `[text](url)` with `text` selected. */
export function link(value: string, start: number, end: number): Edit {
  const sel = value.slice(start, end)
  if (sel) {
    const urlStart = start + sel.length + 3
    return {
      from: start,
      to: end,
      insert: `[${sel}](url)`,
      selStart: urlStart,
      selEnd: urlStart + 3,
    }
  }
  return { from: start, to: end, insert: '[text](url)', selStart: start + 1, selEnd: start + 5 }
}

/** The whole lines a selection touches (one that ends at the very start of a line doesn't include it). */
function lineSpan(value: string, start: number, end: number) {
  const from = value.lastIndexOf('\n', start - 1) + 1
  const lastChar = end > start && value[end - 1] === '\n' ? end - 1 : end
  const nl = value.indexOf('\n', lastChar)
  return { from, to: nl === -1 ? value.length : nl }
}

/** The heading level (1-6) of the line at `pos`, or 0 when it isn't a heading. */
export function headingLevelAt(value: string, pos: number): number {
  const from = value.lastIndexOf('\n', pos - 1) + 1
  const m = /^(#{1,6}) /.exec(value.slice(from, from + 7))
  return m ? m[1]!.length : 0
}

/** Paragraph: takes the heading marker off every line the selection touches. */
export function clearHeading(value: string, start: number, end: number): Edit {
  const { from, to } = lineSpan(value, start, end)
  const insert = value
    .slice(from, to)
    .split('\n')
    .map((l) => l.replace(/^#{1,6} /, ''))
    .join('\n')
  if (start === end) {
    const caret = Math.max(from, start + insert.length - (to - from))
    return { from, to, insert, selStart: caret, selEnd: caret }
  }
  return { from, to, insert, selStart: from, selEnd: from + insert.length }
}

/**
 * Heading, list or quote: toggles `prefix` on every non-empty line the selection touches. If all of
 * them already have it, it comes off. A heading prefix replaces other heading levels first.
 */
export function prefixLines(value: string, start: number, end: number, prefix: string): Edit {
  const { from, to } = lineSpan(value, start, end)
  const lines = value.slice(from, to).split('\n')
  const isHeading = prefix.startsWith('#')
  const strip = (l: string) => (isHeading ? l.replace(/^#{1,6} /, '') : l)
  const touched = lines.filter((l) => l.trim() !== '' || lines.length === 1)
  const allHave = touched.length > 0 && touched.every((l) => l.startsWith(prefix))
  const out = lines.map((l) => {
    if (l.trim() === '' && lines.length > 1) return l
    if (allHave) return l.slice(prefix.length)
    return prefix + strip(l)
  })
  const insert = out.join('\n')
  if (start === end) {
    // A bare caret stays put relative to its text.
    const delta = insert.length - (to - from)
    return {
      from,
      to,
      insert,
      selStart: Math.max(from, start + delta),
      selEnd: Math.max(from, start + delta),
    }
  }
  return { from, to, insert, selStart: from, selEnd: from + insert.length }
}

const TASK = /^[-*+] \[[ xX]\] /
const OTHER_LIST = /^(?:[-*+]|\d+[.)]) /

/**
 * Checklist: makes each non-empty selected line a `- [ ] ` item (a plain bullet or number becomes
 * one, a ticked item keeps its tick). If every line already is one, the marker comes off.
 */
export function checklist(value: string, start: number, end: number): Edit {
  const { from, to } = lineSpan(value, start, end)
  const lines = value.slice(from, to).split('\n')
  const touched = lines.filter((l) => l.trim() !== '' || lines.length === 1)
  const allTasks = touched.length > 0 && touched.every((l) => TASK.test(l))
  const out = lines.map((l) => {
    if (l.trim() === '' && lines.length > 1) return l
    if (allTasks) return l.replace(TASK, '')
    if (TASK.test(l)) return l
    return `- [ ] ${l.replace(OTHER_LIST, '')}`
  })
  const insert = out.join('\n')
  if (start === end) {
    const delta = insert.length - (to - from)
    const caret = Math.max(from, start + delta)
    return { from, to, insert, selStart: caret, selEnd: caret }
  }
  return { from, to, insert, selStart: from, selEnd: from + insert.length }
}

/**
 * Inserts `text` (a photo reference) as its own paragraph at the caret, replacing any selection:
 * a blank line before and after unless the text already starts or ends there. The caret lands
 * after it.
 */
export function insertBlock(value: string, start: number, end: number, text: string): Edit {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const tail =
    after === '' ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const insert = lead + text + tail
  const caret = start + lead.length + text.length + tail.length
  return { from: start, to: end, insert, selStart: caret, selEnd: caret }
}

/** Is `text` a block of its own: several lines, or one that opens with a heading, list, quote, fence or table marker? */
const isBlockText = (text: string) =>
  text.includes('\n') || /^(#{1,6} |[-*+] |\d+\. |> |```|\|)/.test(text)

/**
 * Types a saved snippet (a template) at the caret, replacing any selection, caret after it. A
 * one-line snippet goes in as typed. A block is set apart from the text around it by a blank line on
 * each side, counting the line breaks the snippet and the text already have, so it never glues onto
 * the line before or after (which turned a following `# heading` into plain text) and leaves no
 * extra blank lines. Nothing is added at the very start or end of the entry: a snippet's own trailing
 * line breaks stay where the author put them.
 */
export function insertSnippet(value: string, start: number, end: number, text: string): Edit {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const breaks = (s: string, atEnd: boolean) => s.match(atEnd ? /\n*$/ : /^\n*/)![0].length
  const block = isBlockText(text)
  const lead = block && before ? Math.max(0, 2 - breaks(before, true) - breaks(text, false)) : 0
  const tail = block && after ? Math.max(0, 2 - breaks(text, true) - breaks(after, false)) : 0
  const caret = start + lead + text.length
  return {
    from: start,
    to: end,
    insert: '\n'.repeat(lead) + text + '\n'.repeat(tail),
    selStart: caret,
    selEnd: caret,
  }
}

/** A fenced code block as its own paragraph, the caret on the empty line inside it. */
export function codeBlock(value: string, start: number, end: number): Edit {
  const text = '```\n\n```'
  const e = insertBlock(value, start, end, text)
  const caret = e.from + e.insert.indexOf(text) + 4
  return { ...e, selStart: caret, selEnd: caret }
}

/** A two-column pipe table as its own paragraph, the first header cell selected. */
export function table(value: string, start: number, end: number): Edit {
  const text = '| Column | Column |\n| --- | --- |\n|  |  |'
  const e = insertBlock(value, start, end, text)
  const at = e.from + e.insert.indexOf(text) + 2
  return { ...e, selStart: at, selEnd: at + 6 }
}

/**
 * Moves the line containing `pos` (a photo reference) past the neighbouring paragraph, up or down,
 * keeping the blank-line spacing around it. Null when it is already first or last.
 */
export function moveBlock(value: string, pos: number, dir: -1 | 1): Edit | null {
  const lines = value.split('\n')
  const starts: number[] = []
  let at = 0
  for (const l of lines) {
    starts.push(at)
    at += l.length + 1
  }
  const i = value.slice(0, pos).split('\n').length - 1
  const blank = (n: number) => lines[n]!.trim() === ''
  const end = (n: number) => starts[n]! + lines[n]!.length
  const ref = lines[i]!

  if (dir === -1) {
    let j = i - 1
    while (j >= 0 && blank(j)) j--
    if (j < 0) return null
    let k = j
    while (k > 0 && !blank(k - 1)) k--
    const gap = lines.slice(j + 1, i)
    const out = [ref, ...(gap.length ? gap : ['']), ...lines.slice(k, j + 1)]
    return {
      from: starts[k]!,
      to: end(i),
      insert: out.join('\n'),
      selStart: starts[k]!,
      selEnd: starts[k]! + ref.length,
    }
  }
  let j = i + 1
  while (j < lines.length && blank(j)) j++
  if (j >= lines.length) return null
  let k = j
  while (k + 1 < lines.length && !blank(k + 1)) k++
  const gap = lines.slice(i + 1, j)
  const group = lines.slice(j, k + 1)
  const head = [...group, ...(gap.length ? gap : ['']), ref].join('\n')
  return {
    from: starts[i]!,
    to: end(k),
    insert: head,
    selStart: starts[i]! + head.length - ref.length,
    selEnd: starts[i]! + head.length,
  }
}

/** The smallest single replacement that turns `before` into `after`. */
export function diffEdit(before: string, after: string): Omit<Edit, 'selStart' | 'selEnd'> {
  let from = 0
  const max = Math.min(before.length, after.length)
  while (from < max && before[from] === after[from]) from++
  let tail = 0
  while (tail < max - from && before[before.length - 1 - tail] === after[after.length - 1 - tail])
    tail++
  return { from, to: before.length - tail, insert: after.slice(from, after.length - tail) }
}
