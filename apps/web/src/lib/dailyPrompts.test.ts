import { describe, expect, it } from 'vitest'
import { dailyPrompts, listSignature, shuffle, type DailyState } from './dailyPrompts.ts'

// A small deterministic generator so a failing run can be repeated.
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`)

describe('shuffle', () => {
  it('keeps every item and leaves the input alone', () => {
    const input = ids(20)
    const out = shuffle(input, seeded(1))
    expect([...out].sort()).toEqual([...input].sort())
    expect(input).toEqual(ids(20))
  })
})

describe('listSignature', () => {
  it('ignores order and changes with the list', () => {
    expect(listSignature(['a', 'b', 'c'])).toBe(listSignature(['c', 'a', 'b']))
    expect(listSignature(['a', 'b'])).not.toBe(listSignature(['a', 'c']))
    expect(listSignature(['a'])).not.toBe(listSignature(['a', 'b']))
  })
})

describe('dailyPrompts', () => {
  it('shows nothing for an empty list', () => {
    expect(dailyPrompts(null, [], '2026-11-04').shown).toEqual([])
  })

  it('shows what there is when there are fewer than three', () => {
    expect(dailyPrompts(null, ['a', 'b'], '2026-11-04').shown.sort()).toEqual(['a', 'b'])
    expect(dailyPrompts(null, ['a'], '2026-11-04', { refresh: true }).shown).toEqual(['a'])
  })

  it('draws three distinct prompts and keeps them for the day', () => {
    const list = ids(10)
    const first = dailyPrompts(null, list, '2026-11-04', { random: seeded(2) })
    expect(first.shown).toHaveLength(3)
    expect(new Set(first.shown).size).toBe(3)
    // A reload (a different random source) changes nothing.
    const again = dailyPrompts(first, list, '2026-11-04', { random: seeded(99) })
    expect(again.shown).toEqual(first.shown)
  })

  it('draws a new set on a new day, and on refresh', () => {
    const list = ids(10)
    const day1 = dailyPrompts(null, list, '2026-11-04', { random: seeded(3) })
    const day2 = dailyPrompts(day1, list, '2026-11-05', { random: seeded(3) })
    expect(day2.day).toBe('2026-11-05')
    expect(day2.shown.some((id) => day1.shown.includes(id))).toBe(false)
    const refreshed = dailyPrompts(day2, list, '2026-11-05', { refresh: true, random: seeded(3) })
    expect(refreshed.shown.some((id) => day2.shown.includes(id))).toBe(false)
  })

  it('repeats nothing until the whole list has been used', () => {
    const list = ids(9)
    const seen: string[] = []
    let state: DailyState | null = null
    const random = seeded(4)
    for (let i = 0; i < 3; i++) {
      state = dailyPrompts(state, list, '2026-11-04', { refresh: true, random })
      seen.push(...state.shown)
    }
    expect([...seen].sort()).toEqual([...list].sort())
    // The next draw starts a fresh bag, still three distinct ones.
    state = dailyPrompts(state, list, '2026-11-04', { refresh: true, random })
    expect(new Set(state.shown).size).toBe(3)
  })

  it('keeps the bag going when the list does not divide by three', () => {
    const list = ids(4)
    let state: DailyState | null = null
    const random = seeded(5)
    for (let i = 0; i < 20; i++) {
      state = dailyPrompts(state, list, '2026-11-04', { refresh: true, random })
      expect(new Set(state.shown).size).toBe(3)
      expect(state.shown.every((id) => list.includes(id))).toBe(true)
    }
  })

  it('a prompt deleted mid-day is dropped and the set topped up; the others stay', () => {
    const list = ids(10)
    const first = dailyPrompts(null, list, '2026-11-04', { random: seeded(6) })
    const gone = first.shown[1]!
    const rest = list.filter((id) => id !== gone)
    const next = dailyPrompts(first, rest, '2026-11-04', { random: seeded(7) })
    expect(next.shown).toHaveLength(3)
    expect(next.shown).not.toContain(gone)
    expect(next.shown).toEqual(expect.arrayContaining(first.shown.filter((id) => id !== gone)))
  })

  it('a prompt added mid-day leaves the three alone, and reshuffles the bag with them last', () => {
    const list = ids(10)
    const first = dailyPrompts(null, list, '2026-11-04', { random: seeded(8) })
    const more = [...list, 'new']
    const next = dailyPrompts(first, more, '2026-11-04', { random: seeded(9) })
    expect(next.shown).toEqual(first.shown)
    expect(next.sig).not.toBe(first.sig)
    expect([...next.bag].sort()).toEqual([...more].sort())
    expect(next.bag.slice(-3).sort()).toEqual([...first.shown].sort())
    // The next refresh therefore draws from prompts not on screen.
    const refreshed = dailyPrompts(next, more, '2026-11-04', { refresh: true, random: seeded(9) })
    expect(refreshed.shown.some((id) => first.shown.includes(id))).toBe(false)
  })

  it('goes from empty to a full set once prompts exist', () => {
    const empty = dailyPrompts(null, [], '2026-11-04')
    expect(dailyPrompts(empty, ids(5), '2026-11-04').shown).toHaveLength(3)
  })
})
