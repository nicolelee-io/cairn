import { isTitleLine, plainLine } from './entryCard.ts'

/**
 * Entry markdown as plain text for the search index and its snippets: no syntax, no image or link
 * targets (so `photo:<id>` and URLs can't match a search), Day One's backslash escapes undone.
 * Code keeps its text; only the fence lines go.
 */
export function markdownToPlain(md: string): string {
  return md
    .replace(/^[ \t]*(?:```|~~~)[^\n]*$/gm, '') // fence lines
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images, including photo:<id>
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their text
    .replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|(?:>[ \t]?)+)/gm, '') // headings, quotes
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '') // list and task markers
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '') // rules
    .replace(/\\([\\`*_{}[\]()#+\-.!&<>|~])/g, '$1') // Day One escapes
    .replace(/`/g, '')
    .replace(/[*~]+/g, '')
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '') // emphasis underscores, not snake_case
    .replace(/\s+/g, ' ')
    .trim()
}

const IMAGE = /!\[[^\]]*\]\([^)]*\)/g
const TITLE_CLIP = 120

/**
 * The entry as search holds it: the title the cards show (same rule as `summarize`) and the rest
 * as plain text. Split so a snippet is never the title again, and a title match can be shown on
 * the title. A heading longer than the clip keeps its full text in the rest. The server indexes
 * this, and the device searches its own copy with it.
 */
export function splitTitle(bodyMd: string): { title: string; rest: string } {
  const lines = bodyMd.replace(IMAGE, ' ').split('\n')
  const i = lines.findIndex((l) => plainLine(l) !== '')
  if (i < 0) return { title: '', rest: '' }
  const first = lines[i]!
  const text = plainLine(first)
  const isTitle = isTitleLine(first, text)
  if (!isTitle) return { title: '', rest: markdownToPlain(bodyMd) }
  const rest = markdownToPlain(lines.slice(i + 1).join('\n'))
  const clipped = text.length > TITLE_CLIP
  return {
    title: clipped ? `${text.slice(0, TITLE_CLIP).trimEnd()}…` : text,
    rest: clipped ? `${text} ${rest}` : rest,
  }
}
