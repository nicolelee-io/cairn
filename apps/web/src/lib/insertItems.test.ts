import { describe, expect, it } from 'vitest'
import { BUILT_IN_ITEMS, matchItems, shiftedDate, type InsertContext } from './insertItems.ts'

const item = (id: string) => BUILT_IN_ITEMS.find((i) => i.id === id)!
const build = (id: string, value = '', start = value.length, end = start, ctx = CTX) => {
  const e = item(id).build(value, start, end, ctx)
  return { text: value.slice(0, e.from) + e.insert + value.slice(e.to), e }
}

// 2026-11-06 23:30 in New York is already 2026-11-07 in UTC.
const CTX: InsertContext = { now: Date.UTC(2026, 10, 7, 4, 30), timezone: 'America/New_York' }

describe('date inserts', () => {
  it('use the entry timezone, not the viewer’s', () => {
    expect(build('date').text).toBe('11/6/2026')
    expect(build('time').text).toBe('11:30 PM')
    expect(build('datetime').text).toBe('11/6/2026, 11:30 PM')
    expect(build('date', '', 0, 0, { ...CTX, timezone: 'Asia/Tokyo' }).text).toBe('11/7/2026')
  })

  it('replace a selection and leave the caret after the text', () => {
    const { text, e } = build('date', 'On XX today', 3, 5)
    expect(text).toBe('On 11/6/2026 today')
    expect(e.selStart).toBe(3 + '11/6/2026'.length)
  })

  it('shift by calendar days across month, year and DST edges', () => {
    expect(shiftedDate(CTX.now, CTX.timezone, -1)).toBe('11/5/2026')
    expect(shiftedDate(CTX.now, CTX.timezone, 1)).toBe('11/7/2026')
    const newYear = Date.UTC(2027, 0, 1, 12)
    expect(shiftedDate(newYear, 'UTC', -1)).toBe('12/31/2026')
    // The night US clocks go back (a 25-hour day): tomorrow is still the next date.
    const dstDay = Date.UTC(2026, 10, 1, 5, 30) // 12:30 AM EDT on 2026-11-01
    expect(shiftedDate(dstDay, 'America/New_York', 1)).toBe('11/2/2026')
    expect(shiftedDate(dstDay, 'America/New_York', -1)).toBe('10/31/2026')
  })
})

describe('format inserts', () => {
  it('make a heading, quote or list of the caret line', () => {
    expect(build('h2', 'Morning').text).toBe('## Morning')
    expect(build('quote', 'Said so').text).toBe('> Said so')
    expect(build('bullets', 'one').text).toBe('- one')
  })

  it('put a code block in its own paragraph with the caret inside it', () => {
    const { text, e } = build('code', 'Before')
    expect(text).toBe('Before\n\n```\n\n```\n')
    expect(text.slice(0, e.selStart)).toBe('Before\n\n```\n')
  })

  it('make a table with the first header cell selected', () => {
    const { text, e } = build('table')
    expect(text.slice(e.selStart, e.selEnd)).toBe('Column')
    expect(text.split('\n')).toHaveLength(4)
  })
})

describe('matchItems', () => {
  const ids = (q: string) => matchItems(BUILT_IN_ITEMS, q).map((i) => i.id)

  it('lists everything for an empty query', () => {
    expect(ids('')).toHaveLength(BUILT_IN_ITEMS.length)
  })

  it('matches labels and keywords by prefix, label hits first', () => {
    expect(ids('da')[0]).toBe('date')
    expect(ids('da')).toContain('datetime')
    expect(ids('da')).toContain('yesterday') // keyword "date"
    expect(ids('todo')).toEqual(['checklist'])
    expect(ids('head')).toEqual(['h1', 'h2', 'h3'])
  })

  it('takes several words: spaces are ignored against the label', () => {
    expect(ids('date and')).toEqual(['datetime'])
    expect(ids('Date And Time ')).toEqual(['datetime'])
    // More than one word never matches through a keyword ("date" is a keyword of Yesterday).
    expect(ids('date y')).toEqual([])
    expect(ids('heading 2')).toEqual(['h2'])
  })

  it('ignores case and the spaces in a label', () => {
    expect(ids('DateAnd')).toEqual(['datetime'])
    expect(ids('nothing-like-this')).toEqual([])
  })
})
