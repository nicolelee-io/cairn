import { describe, expect, it } from 'vitest'
import { parseDay } from './parseDay.ts'

describe('parseDay', () => {
  it('reads ISO and US order, with any of / - . between', () => {
    expect(parseDay('2026-02-15')).toBe('2026-02-15')
    expect(parseDay('2/5/2026')).toBe('2026-02-05')
    expect(parseDay('02/15/2026')).toBe('2026-02-15')
    expect(parseDay(' 2026.2.5 ')).toBe('2026-02-05')
    expect(parseDay('12-31-2025')).toBe('2025-12-31')
  })
  it('refuses what is not a real day', () => {
    for (const bad of [
      '',
      '2026-02-31',
      '13/1/2026',
      '15/02/2026',
      '2/5/26',
      'tomorrow',
      '2026-02',
      '2/29/2026',
    ])
      expect(parseDay(bad), bad).toBeNull()
    expect(parseDay('2/29/2028')).toBe('2028-02-29')
  })
})
