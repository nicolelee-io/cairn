import { describe, expect, it } from 'vitest'
import { markdownToPlain, splitTitle } from './plainText.ts'

describe('markdownToPlain', () => {
  it('drops syntax but keeps the words', () => {
    expect(markdownToPlain('# Title\n\n> quoted **bold** and _em_ text\n\n- one\n- [x] two')).toBe(
      'Title quoted bold and em text one two',
    )
  })

  it('leaves image and link targets out, so they cannot match', () => {
    const plain = markdownToPlain(
      'See ![](photo:0192abcd-1111-7222-8333-444455556666) and [my site](https://example.com/secret).',
    )
    expect(plain).toBe('See and my site.')
    expect(plain).not.toMatch(/0192|example|secret/)
  })

  it('undoes Day One escapes and keeps code text', () => {
    expect(markdownToPlain('Done\\. A \\- dash\n```js\nconst answer = 42\n```')).toBe(
      'Done. A - dash const answer = 42',
    )
  })

  it('keeps underscores inside words', () => {
    expect(markdownToPlain('use snake_case, _not_ this')).toBe('use snake_case, not this')
  })
})

describe('splitTitle', () => {
  it('splits a heading from the plain rest, and leaves a plain first line in the body', () => {
    expect(splitTitle('# Morning walk\n\nSaw a **heron**.')).toEqual({
      title: 'Morning walk',
      rest: 'Saw a heron.',
    })
    expect(
      splitTitle(
        'Just thinking out loud about a long day at work and what came after it all, and then some more.\n\nmore',
      ),
    ).toMatchObject({ title: '' })
  })
})
