/**
 * Turns what the user typed into an FTS5 MATCH expression. Raw input can't go in: FTS5 has its own
 * syntax (AND, NEAR, column filters, unbalanced quotes) and a stray character is a SQL error.
 * Only letters and digits survive; words are ANDed (explicitly: FTS5 has no implicit AND next to a
 * group); "quoted words" are a phrase; and the last word matches as a prefix, so results appear
 * while typing (a prefix term is stemmed too, so "walking" still finds "walked"). Returns null if
 * nothing searchable was typed.
 */
export function buildMatch(input: string): string | null {
  const terms: { text: string; phrase: boolean; quoted: boolean }[] = []
  for (const m of input.matchAll(/"([^"]*)"|(\S+)/g)) {
    const words = (m[1] ?? m[2] ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    if (words.length === 0) continue
    terms.push({ text: words.join(' '), phrase: words.length > 1, quoted: m[1] !== undefined })
  }
  const last = terms[terms.length - 1]
  const out = terms.map((t) => `"${t.text}"`)
  if (last && !last.quoted && !last.phrase) {
    out[out.length - 1] = `"${last.text}"*`
  }
  return out.length ? out.join(' AND ') : null
}
