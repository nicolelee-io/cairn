// What a timeline card shows of an entry, and the cursor that pages through them. Shared so the
// server (which builds cards from the database) and the web app (which builds them from its local
// copy when offline) can never disagree about what an entry's title is.

const IMAGE = /!\[[^\]]*\]\([^)]*\)/g
export const TITLE_MAX = 80
const EXCERPT_CHARS = 240
const TITLE_CLIP = 120
/** Photos shown on a card. */
export const THUMBS_PER_CARD = 4

/** One line of markdown as plain text: no heading/list/quote markers, emphasis, links or escapes. */
export function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!&])/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether the first line reads like a title: a heading, or short. */
export const isTitleLine = (line: string, text: string) =>
  /^\s{0,3}#{1,6}\s/.test(line) || text.length <= TITLE_MAX

/**
 * Card text for an entry, Day One style: the first line is the title when it reads like one (a
 * heading, or short); the rest is the excerpt. A long first line is prose, so it all goes in the
 * excerpt and the title is empty. Images are dropped.
 */
/** A line that is only a rule (`---`, `***`, `* * *`, `___`). */
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

/** A table's delimiter row (`|---|:-:|`), the line that tells a table from a stray pipe. */
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
/** A list item at any indent, bulleted or numbered; group 2 is a checklist box, group 3 the text. */
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/
/** What a table becomes on a card. */
export const TABLE_TOKEN = '▦ Table'
const URL_IN_TEXT = /https?:\/\/[^\s<>)\]]+/g

/** A link's address as just its host, so a long URL doesn't eat the excerpt. */
function hostOf(url: string): string {
  const trimmed = url.replace(/[.,;:!?]+$/, '')
  try {
    return new URL(trimmed).hostname.replace(/^www\./, '')
  } catch {
    return trimmed
  }
}

/** `plainLine` plus what only a card cares about: autolinks and bare URLs shown as their host. */
function cardLine(line: string): string {
  return plainLine(
    line
      .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/, '') // a reference definition: `[ref]: https://…`
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1') // `[text][ref]`
      .replace(/<(https?:\/\/[^>\s]+)>/g, (_, u: string) => hostOf(u)),
  ).replace(URL_IN_TEXT, hostOf)
}

type CardLine = { text: string; heading: boolean; item: boolean; table: boolean }

/** Lines as card text: a table collapses into one token, a list item loses its marker (a checklist
 *  box becomes ☐ or ☑), everything else goes through `cardLine`. */
function cardLines(bodyMd: string): CardLine[] {
  const raw = bodyMd
    .replace(IMAGE, ' ')
    .split('\n')
    .filter((l) => !RULE.test(l))
  const out: CardLine[] = []
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]!
    if (
      line.includes('|') &&
      i + 1 < raw.length &&
      TABLE_DELIMITER.test(raw[i + 1]!) &&
      raw[i + 1]!.includes('|')
    ) {
      i++
      while (i + 1 < raw.length && raw[i + 1]!.includes('|')) i++
      out.push({ text: TABLE_TOKEN, heading: false, item: false, table: true })
      continue
    }
    const m = LIST_ITEM.exec(line)
    if (m) {
      const box = m[1] === undefined ? '' : m[1] === ' ' ? '☐ ' : '☑ '
      const text = cardLine(m[2]!)
      if (text) out.push({ text: box + text, heading: false, item: true, table: false })
      continue
    }
    const text = cardLine(line)
    if (text) out.push({ text, heading: /^\s{0,3}#{1,6}\s/.test(line), item: false, table: false })
  }
  return out
}

export function summarize(bodyMd: string): { title: string; excerpt: string } {
  const lines = cardLines(bodyMd)
  const first = lines[0]
  // A table is never the title (a list item can be, as in search's `splitTitle`); consecutive list items read as "a · b · c".
  const isTitle = !!first && !first.table && (first.heading || first.text.length <= TITLE_MAX)
  const rest = (isTitle ? lines.slice(1) : lines).reduce(
    (acc, l, i, all) => acc + (i === 0 ? '' : l.item && all[i - 1]!.item ? ' · ' : ' ') + l.text,
    '',
  )
  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t)
  return {
    title: isTitle ? clip(first.text, TITLE_CLIP) : '',
    excerpt: clip(rest, EXCERPT_CHARS),
  }
}

const LABEL_CHARS = 60

/**
 * What to call an entry in a menu title, an aria-label, a toast or a list of names: its title, else
 * the start of its excerpt, else "Untitled entry". Takes `summarize()`'s output (or a card's).
 */
export function entryLabel({ title, excerpt }: { title: string; excerpt: string }): string {
  if (title) return title
  if (!excerpt) return 'Untitled entry'
  return excerpt.length > LABEL_CHARS ? `${excerpt.slice(0, LABEL_CHARS).trimEnd()}…` : excerpt
}

/**
 * Cursor = the last item's (pinned, created_at, id): a stable keyset even when created_at ties.
 * Pinned entries sort first, so a pinned cursor carries a `P` prefix; unpinned ones keep the plain form.
 */
export const encodeCursor = (createdAt: number, id: string, pinned = false) =>
  `${pinned ? 'P' : ''}${createdAt}_${id}`
export function decodeCursor(
  cursor: string,
): { createdAt: number; id: string; pinned: boolean } | null {
  const m = /^(P?)(\d{1,16})_([0-9a-zA-Z-]{1,64})$/.exec(cursor)
  return m ? { createdAt: Number(m[2]), id: m[3]!, pinned: m[1] === 'P' } : null
}
