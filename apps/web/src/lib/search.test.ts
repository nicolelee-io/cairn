import { SNIPPET_CLOSE as C, SNIPPET_OPEN as O } from '@cairn/shared'
import { describe, expect, it } from 'vitest'
import { splitSnippet } from './search.ts'

describe('splitSnippet', () => {
  it('marks the matched words', () => {
    expect(splitSnippet(`a ${O}big${C} day, a ${O}long${C} one`)).toEqual([
      { text: 'a ', hit: false },
      { text: 'big', hit: true },
      { text: ' day, a ', hit: false },
      { text: 'long', hit: true },
      { text: ' one', hit: false },
    ])
  })

  it('passes plain text and empty input through', () => {
    expect(splitSnippet('no matches here')).toEqual([{ text: 'no matches here', hit: false }])
    expect(splitSnippet('')).toEqual([])
  })

  it('treats markup in the text as text', () => {
    expect(splitSnippet(`<b>${O}x${C}</b>`)).toEqual([
      { text: '<b>', hit: false },
      { text: 'x', hit: true },
      { text: '</b>', hit: false },
    ])
  })
})
