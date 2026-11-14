import { SNIPPET_CLOSE, SNIPPET_OPEN } from '@cairn/shared'

export interface SnippetPart {
  text: string
  hit: boolean
}

/**
 * Splits a search snippet at the markers the server put around the matched words. The text is
 * rendered as plain React text, never as HTML, so nothing in an entry can inject markup.
 */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = []
  let text = ''
  let hit = false
  const flush = () => {
    if (text) parts.push({ text, hit })
    text = ''
  }
  for (const ch of snippet) {
    if (ch === SNIPPET_OPEN) {
      flush()
      hit = true
    } else if (ch === SNIPPET_CLOSE) {
      flush()
      hit = false
    } else text += ch
  }
  flush()
  return parts
}
