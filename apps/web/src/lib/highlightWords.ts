/** A hast node, as far as this plugin needs to know about it. */
interface HNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HNode[]
}

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word, case-insensitive, accent-exact matcher for the given words (longest first). */
function matcher(words: string[]): RegExp | null {
  const list = words.filter(Boolean).sort((a, b) => b.length - a.length)
  if (list.length === 0) return null
  // \b only knows ASCII letters, so word edges are spelled out for Unicode.
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
}

/** Splits text into runs, marking the runs that are one of `words`. */
export function splitByWords(text: string, words: string[]): { text: string; hit: boolean }[] {
  const re = matcher(words)
  if (!re) return [{ text, hit: false }]
  const parts: { text: string; hit: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), hit: false })
    parts.push({ text: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false })
  return parts
}

/**
 * A rehype plugin for react-markdown: wraps `words` in <mark> wherever they occur in the rendered
 * text. It works on text nodes only, so it can never produce markup from the entry's content.
 */
export function rehypeHighlight({ words }: { words: string[] }) {
  return (tree: HNode) => {
    const walk = (node: HNode) => {
      if (!node.children) return
      node.children = node.children.flatMap((child): HNode[] => {
        if (child.type === 'text' && child.value) {
          const parts = splitByWords(child.value, words)
          if (parts.length === 1 && !parts[0]!.hit) return [child]
          return parts.map((p) =>
            p.hit
              ? {
                  type: 'element',
                  tagName: 'mark',
                  properties: {},
                  children: [{ type: 'text', value: p.text }],
                }
              : { type: 'text', value: p.text },
          )
        }
        if (child.tagName !== 'mark') walk(child)
        return [child]
      })
    }
    walk(tree)
  }
}
