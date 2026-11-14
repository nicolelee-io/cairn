import { describe, expect, it } from 'vitest'
import { entryLabel, summarize } from './entryCard.ts'

describe('entryLabel', () => {
  it('is the title when there is one', () => {
    expect(entryLabel(summarize('# Trip to the coast\nWe left early.'))).toBe('Trip to the coast')
  })

  it('falls back to the start of the excerpt, clipped', () => {
    const long = 'A'.repeat(50) + ' ' + 'b'.repeat(100)
    const label = entryLabel(summarize(long))
    expect(label.endsWith('…')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(61)
  })

  it('agrees with the card for a long first line (no title)', () => {
    const prose =
      'This first line is long enough that it reads as prose rather than a title, so it is excerpt.'
    expect(summarize(prose).title).toBe('')
    expect(entryLabel(summarize(prose)).startsWith('This first line')).toBe(true)
  })

  it('says Untitled entry when there is no text', () => {
    expect(entryLabel(summarize(''))).toBe('Untitled entry')
    expect(entryLabel(summarize('![](photo:abc)'))).toBe('Untitled entry')
  })
})

describe('summarize and dividers', () => {
  it('leaves a divider line out of the excerpt', () => {
    expect(summarize('Title\n\nBefore\n\n---\n\nAfter')).toEqual({
      title: 'Title',
      excerpt: 'Before After',
    })
    expect(summarize('One\n* * *\nTwo\n___\nThree').excerpt).toBe('Two Three')
  })
  it('keeps a list item that merely starts with a dash', () => {
    expect(summarize('Title\n- a\n- b').excerpt).toBe('a · b')
  })
})

describe('summarize and markdown blocks', () => {
  it('replaces a table with a token', () => {
    const md = 'Title\n\nBefore\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 |\n\nAfter'
    expect(summarize(md).excerpt).toBe('Before ▦ Table After')
  })
  it('does not take a table for the title, and ignores a lone pipe line', () => {
    expect(summarize('a | b\n|--|--|\n1 | 2')).toEqual({ title: '', excerpt: '▦ Table' })
    expect(summarize('Title\na | b').excerpt).toBe('a | b')
  })
  it('shows checklist boxes as symbols', () => {
    expect(summarize('Title\n- [ ] milk\n- [x] eggs\n  - [X] nested').excerpt).toBe(
      '☐ milk · ☑ eggs · ☑ nested',
    )
  })
  it('strips bullet and number markers at any indent and joins items with dots', () => {
    expect(summarize('Title\n- a\n    - b\n1. c\n2) d\nProse').excerpt).toBe('a · b · c · d Prose')
  })
  it('shows autolinks and bare URLs as their host', () => {
    expect(
      summarize('T\nSee <https://www.example.com/a/b?c=1> and https://docs.foo.org/x.').excerpt,
    ).toBe('See example.com and docs.foo.org')
  })
  it('keeps link text, including reference links, and drops definitions', () => {
    expect(
      summarize('T\n[a link](https://x.com) and [other][1]\n\n[1]: https://y.com').excerpt,
    ).toBe('a link and other')
  })
  it('leaves no brackets behind for an image inside a link', () => {
    expect(summarize('T\n[![alt](photo:abc)](https://x.com) after').excerpt).toBe('after')
  })
})
