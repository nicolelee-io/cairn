import { describe, expect, it } from 'vitest'
import { buildMatch } from './match.ts'

describe('buildMatch', () => {
  it('ANDs words and makes the last one a prefix', () => {
    expect(buildMatch('walking park')).toBe('"walking" AND "park"*')
  })

  it('treats quoted words as one phrase, with no prefix', () => {
    expect(buildMatch('"morning walk"')).toBe('"morning walk"')
    expect(buildMatch('coffee "morning walk"')).toBe('"coffee" AND "morning walk"')
  })

  it('neutralises FTS syntax in the input', () => {
    expect(buildMatch('tags:foo OR NEAR(bar) "unbalanced')).toBe(
      '"tags foo" AND "OR" AND "NEAR bar" AND "unbalanced"*',
    )
    expect(buildMatch('***')).toBeNull()
    expect(buildMatch('   ')).toBeNull()
  })

  it('keeps accents and digits', () => {
    expect(buildMatch('café 2024')).toBe('"café" AND "2024"*')
  })
})
