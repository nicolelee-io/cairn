import { describe, expect, it } from 'vitest'
import { SNIPPET_CLOSE as C, SNIPPET_OPEN as O } from '@cairn/shared'
import { matchEntry, parseQuery } from './localSearch.ts'

const entry = (bodyMd: string, extra: { placeName?: string; tags?: string[] } = {}) => ({
  bodyMd,
  placeName: extra.placeName ?? null,
  tags: extra.tags ?? [],
})
const m = (q: string, e: ReturnType<typeof entry>) => matchEntry(e, parseQuery(q))

describe('parseQuery', () => {
  it('splits words, ignores punctuation and accents, and makes only the last bare word a prefix', () => {
    expect(parseQuery('Café, crème')).toEqual([
      { words: ['cafe'], prefix: false },
      { words: ['creme'], prefix: true },
    ])
    expect(parseQuery('"morning walk" coffee')).toEqual([
      { words: ['morning', 'walk'], prefix: false },
      { words: ['coffee'], prefix: true },
    ])
    expect(parseQuery('"quoted"')[0]!.prefix).toBe(false)
    expect(parseQuery('foo-bar')[0]).toEqual({ words: ['foo', 'bar'], prefix: false })
    expect(parseQuery('*** ""')).toEqual([])
  })
})

describe('matchEntry', () => {
  const walk = entry('# Morning walk\n\nSaw a heron by the café, then coffee.')

  it('finds words ignoring case and accents, and marks them as written', () => {
    const r = m('CAFE heron', walk)!
    expect(r.snippet).toContain(`${O}café${C}`)
    expect(r.snippet).toContain(`${O}heron${C}`)
    expect(r.snippetField).toBe('body')
    expect(r.words.sort()).toEqual(['café', 'heron'])
  })

  it('needs every word (AND), in any field', () => {
    expect(m('heron zebra', walk)).toBeNull()
    expect(m('morning heron', walk)).not.toBeNull() // title and body
  })

  it('matches a quoted phrase only as a run of words', () => {
    expect(m('"morning walk"', walk)).not.toBeNull()
    expect(m('"walk morning"', walk)).toBeNull()
    expect(m('"saw heron"', walk)).toBeNull()
  })

  it('matches the last word as a prefix, but no earlier one, and does no stemming', () => {
    expect(m('her', walk)).not.toBeNull()
    expect(m('her coffee', walk)).toBeNull() // "her" isn't last, so it must be a whole word
    expect(m('coff', walk)).not.toBeNull()
    expect(m('walked', entry('walking along'))).toBeNull()
    expect(m('"her"', walk)).toBeNull() // quoted: no prefix
  })

  it('marks the title when it matches, and shows the body start when only the title did', () => {
    const r = m('morning', walk)!
    expect(r.titleMarked).toBe(`${O}Morning${C} walk`)
    expect(r.snippet).toBe('Saw a heron by the café, then coffee.')
    expect(r.snippet).not.toContain(O)
  })

  it('searches place and tags, saying which the snippet is from', () => {
    const e = entry('# Day\n\nnothing here', {
      placeName: 'Riverside Park',
      tags: ['Wildlife', 'Spring'],
    })
    expect(m('riverside', e)).toMatchObject({
      snippetField: 'place',
      snippet: `${O}Riverside${C} Park`,
    })
    expect(m('wildlife', e)).toMatchObject({ snippetField: 'tags' })
    expect(m('nothing wildlife', e)!.snippetField).toBe('body')
  })

  it('cuts a long body to about 24 words around the first match, with ellipses', () => {
    const body = `# T\n\n${Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')} needle ${Array.from({ length: 60 }, (_, i) => `x${i}`).join(' ')}`
    const r = m('needle', entry(body))!
    const words = r.snippet.replace(/[…]/g, '').split(' ')
    expect(words).toHaveLength(24)
    expect(r.snippet.startsWith('…')).toBe(true)
    expect(r.snippet.endsWith('…')).toBe(true)
    expect(r.snippet).toContain(`${O}needle${C}`)
  })

  it('does not search image or link targets', () => {
    expect(m('example', entry('See [my site](https://example.com/x)'))).toBeNull()
    expect(m('photo', entry('![](photo:abc-123)\n\ntext'))).toBeNull()
  })
})
