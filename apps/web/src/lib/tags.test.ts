import { describe, expect, it } from 'vitest'
import { sameTags, withRememberedTags, withTag } from './tags.ts'

describe('sameTags', () => {
  it('ignores order and case', () => {
    expect(sameTags(['Trip', 'food'], ['FOOD', 'trip'])).toBe(true)
    expect(sameTags([], [])).toBe(true)
  })
  it('tells different sets apart', () => {
    expect(sameTags(['a'], ['a', 'b'])).toBe(false)
    expect(sameTags(['a', 'b'], ['a', 'c'])).toBe(false)
  })
})

describe('withTag', () => {
  it('adds a trimmed name without a leading #', () => {
    expect(withTag(['a'], '  #b ')).toEqual(['a', 'b'])
  })
  it('does not add a case-variant or an empty name', () => {
    expect(withTag(['Trip'], 'trip')).toEqual(['Trip'])
    expect(withTag(['a'], ' # ')).toEqual(['a'])
  })
})

describe('withRememberedTags', () => {
  it('keeps the device list first and adds remembered tags it lacks, ignoring case', () => {
    const device = [{ name: 'Trip', count: 1 }]
    const remembered = [
      { name: 'trip', count: 9 },
      { name: 'food', count: 4 },
    ]
    expect(withRememberedTags(device, remembered)).toEqual([
      { name: 'Trip', count: 1 },
      { name: 'food', count: 4 },
    ])
    expect(withRememberedTags([], remembered)).toEqual(remembered)
    expect(withRememberedTags(device, undefined)).toEqual(device)
  })
})
