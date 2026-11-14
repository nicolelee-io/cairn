import { describe, expect, it } from 'vitest'
import { rehypeHighlight, splitByWords } from './highlightWords.ts'

describe('splitByWords', () => {
  it('marks whole words, ignoring case', () => {
    expect(splitByWords('We Walked the walk, not walking', ['walk', 'walked'])).toEqual([
      { text: 'We ', hit: false },
      { text: 'Walked', hit: true },
      { text: ' the ', hit: false },
      { text: 'walk', hit: true },
      { text: ', not walking', hit: false },
    ])
  })

  it('does not match inside longer words, including accented ones', () => {
    expect(splitByWords('cafés and café', ['café'])).toEqual([
      { text: 'cafés and ', hit: false },
      { text: 'café', hit: true },
    ])
  })

  it('treats regex characters in words as text', () => {
    expect(splitByWords('a.b and a+b', ['a.b'])).toEqual([
      { text: 'a.b', hit: true },
      { text: ' and a+b', hit: false },
    ])
  })

  it('returns the text untouched with no words', () => {
    expect(splitByWords('plain', [])).toEqual([{ text: 'plain', hit: false }])
  })
})

describe('rehypeHighlight', () => {
  it('wraps matches in <mark> and leaves other nodes alone', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          children: [{ type: 'text', value: 'a big day' }],
        },
      ],
    }
    rehypeHighlight({ words: ['big'] })(tree)
    expect(tree.children[0]!.children).toEqual([
      { type: 'text', value: 'a ' },
      {
        type: 'element',
        tagName: 'mark',
        properties: {},
        children: [{ type: 'text', value: 'big' }],
      },
      { type: 'text', value: ' day' },
    ])
  })
})
