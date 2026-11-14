import { SNIPPET_CLOSE, SNIPPET_OPEN, splitTitle } from '@cairn/shared'

// Search over the entries kept on this device, for when the server can't be reached. It mirrors
// what the server's FTS index does (apps/server/src/search/match.ts) as far as is cheap: accents
// and case ignored, every typed word must match (a "quoted phrase" as a run of words), and the
// last word matches as a prefix. No stemming, so "walking" doesn't find "walked". The matching is
// pure; reading the entries and building the cards is in localRead.ts.

/** One typed term: a single word, or a run of words that must follow each other. */
interface Term {
  words: string[]
  /** The last word may be a prefix (an unquoted single word at the end, so results show while typing). */
  prefix: boolean
}

const WORD = /[\p{L}\p{N}]+/gu
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** What was typed as terms, like the server's `buildMatch`; empty when nothing searchable was typed. */
export function parseQuery(input: string): Term[] {
  const terms: (Term & { quoted: boolean })[] = []
  for (const m of input.matchAll(/"([^"]*)"|(\S+)/g)) {
    const words = [...(m[1] ?? m[2] ?? '').matchAll(WORD)].map((w) => norm(w[0]))
    if (words.length) terms.push({ words, prefix: false, quoted: m[1] !== undefined })
  }
  const last = terms.at(-1)
  if (last && !last.quoted && last.words.length === 1) last.prefix = true
  return terms.map(({ words, prefix }) => ({ words, prefix }))
}

interface Token {
  /** Where the word starts in the text, and the word as written. */
  at: number
  text: string
  norm: string
}

const tokens = (text: string): Token[] =>
  [...text.matchAll(WORD)].map((m) => ({ at: m.index, text: m[0], norm: norm(m[0]) }))

/** Marks (by token index) the words of `text` that `term` matches; the empty set when it doesn't. */
function markTerm(toks: Token[], term: Term, isLast: boolean): Set<number> {
  const hit = new Set<number>()
  const n = term.words.length
  for (let i = 0; i + n <= toks.length; i++) {
    const ok = term.words.every((w, k) =>
      k === n - 1 && term.prefix && isLast
        ? toks[i + k]!.norm.startsWith(w)
        : toks[i + k]!.norm === w,
    )
    if (ok) for (let k = 0; k < n; k++) hit.add(i + k)
  }
  return hit
}

/** The text with SNIPPET_OPEN/CLOSE around the marked words. */
function mark(text: string, toks: Token[], marked: Set<number>): string {
  let out = ''
  let from = 0
  toks.forEach((t, i) => {
    if (!marked.has(i)) return
    out += text.slice(from, t.at) + SNIPPET_OPEN + t.text + SNIPPET_CLOSE
    from = t.at + t.text.length
  })
  return out + text.slice(from)
}

const SNIPPET_WORDS = 24

/** About 24 words of marked text around the first mark (or its start), with … where it is cut. */
function around(markedText: string): string {
  const words = markedText.split(/\s+/).filter(Boolean)
  const first = words.findIndex((w) => w.includes(SNIPPET_OPEN))
  const start = Math.max(0, Math.min(first < 0 ? 0 : first - 8, words.length - SNIPPET_WORDS))
  const slice = words.slice(start, start + SNIPPET_WORDS).join(' ')
  return `${start > 0 ? '…' : ''}${slice}${start + SNIPPET_WORDS < words.length ? '…' : ''}`
}

export interface SearchableEntry {
  bodyMd: string
  placeName: string | null
  tags: string[]
}

export interface LocalMatch {
  titleMarked: string
  snippet: string
  snippetField: 'body' | 'tags' | 'place'
  /** The words of the entry that matched, lowercased, as written (for highlighting while reading). */
  words: string[]
}

/** Whether the entry holds every term (in any field), and how its title and snippet read. */
export function matchEntry(entry: SearchableEntry, terms: Term[]): LocalMatch | null {
  const { title, rest } = splitTitle(entry.bodyMd)
  const fields = {
    title,
    body: rest,
    place: entry.placeName ?? '',
    tags: entry.tags.join(' '),
  }
  const toks = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, tokens(v)])) as Record<
    keyof typeof fields,
    Token[]
  >
  const marks = {
    title: new Set<number>(),
    body: new Set<number>(),
    place: new Set<number>(),
    tags: new Set<number>(),
  }
  for (const [ti, term] of terms.entries()) {
    let found = false
    for (const f of Object.keys(fields) as (keyof typeof fields)[]) {
      const hit = markTerm(toks[f], term, ti === terms.length - 1)
      for (const i of hit) marks[f].add(i)
      found ||= hit.size > 0
    }
    if (!found) return null
  }
  const marked = (f: keyof typeof fields) => mark(fields[f], toks[f], marks[f])
  const from = (['body', 'tags', 'place'] as const).find((f) => marks[f].size > 0) ?? 'body'
  const words = new Set<string>()
  for (const f of Object.keys(fields) as (keyof typeof fields)[])
    for (const i of marks[f]) words.add(toks[f][i]!.text.toLowerCase())
  return {
    titleMarked: marked('title'),
    snippet: around(marked(from)),
    snippetField: from,
    words: [...words],
  }
}
