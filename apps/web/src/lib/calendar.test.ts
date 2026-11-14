import { describe, expect, it } from 'vitest'
import { monthGrid } from './calendar.ts'

describe('monthGrid', () => {
  it('pads to Sunday-first weeks (October 2026 starts on a Thursday)', () => {
    const { label, weeks } = monthGrid(2026, 10)
    expect(label).toBe('October 2026')
    expect(weeks[0]).toEqual([null, null, null, null, 1, 2, 3])
    expect(weeks[weeks.length - 1]).toEqual([25, 26, 27, 28, 29, 30, 31])
    expect(weeks.every((w) => w.length === 7)).toBe(true)
  })

  it('handles leap Februaries and months that fill the grid exactly', () => {
    const feb = monthGrid(2024, 2)
      .weeks.flat()
      .filter((d) => d !== null)
    expect(feb).toHaveLength(29)
    // February 2026 starts on a Sunday and has 28 days: four full weeks, no padding.
    const exact = monthGrid(2026, 2)
    expect(exact.weeks).toHaveLength(4)
    expect(exact.weeks.flat()).not.toContain(null)
  })

  it('adds a sixth week when the month needs one', () => {
    // August 2026 starts on a Saturday with 31 days.
    expect(monthGrid(2026, 8).weeks).toHaveLength(6)
  })
})
