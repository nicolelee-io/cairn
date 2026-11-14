import { describe, expect, it } from 'vitest'
import { fromZonedFields, timezoneOptions, zonedFields } from './entryTime.ts'

describe('zonedFields', () => {
  it('reads the wall clock in the given zone', () => {
    const ms = Date.parse('2026-10-30T03:30:00Z')
    expect(zonedFields(ms, 'America/Denver')).toEqual({ date: '2026-10-29', time: '21:30' })
    expect(zonedFields(ms, 'UTC')).toEqual({ date: '2026-10-30', time: '03:30' })
  })

  it('shows midnight as 00:00, not 24:00', () => {
    expect(zonedFields(Date.parse('2026-10-30T06:00:00Z'), 'America/Denver').time).toBe('00:00')
  })
})

describe('fromZonedFields', () => {
  it('round-trips through the zone, including half-hour offsets', () => {
    for (const tz of ['America/Denver', 'Asia/Kolkata', 'Pacific/Auckland', 'UTC']) {
      const ms = Date.parse('2026-07-04T12:34:00Z')
      const { date, time } = zonedFields(ms, tz)
      expect(fromZonedFields(date, time, tz)).toBe(ms)
    }
  })

  it('keeps an 11pm entry on its own day', () => {
    const ms = fromZonedFields('2026-10-29', '23:00', 'America/Denver')
    expect(new Date(ms!).toISOString()).toBe('2026-10-30T05:00:00.000Z')
  })

  it('handles the day clocks go back (2026-11-01, Denver)', () => {
    // 01:30 happens twice; the earlier one is still daylight time (UTC-6).
    expect(new Date(fromZonedFields('2026-11-01', '01:30', 'America/Denver')!).toISOString()).toBe(
      '2026-11-01T07:30:00.000Z',
    )
    expect(new Date(fromZonedFields('2026-11-01', '03:00', 'America/Denver')!).toISOString()).toBe(
      '2026-11-01T10:00:00.000Z',
    )
  })

  it('moves a time that does not exist when clocks go forward (2026-03-08, Denver)', () => {
    const ms = fromZonedFields('2026-03-08', '02:30', 'America/Denver')!
    expect(zonedFields(ms, 'America/Denver').date).toBe('2026-03-08')
    expect(zonedFields(ms, 'America/Denver').time).toBe('03:30')
  })

  it('rejects malformed input', () => {
    expect(fromZonedFields('', '10:00', 'UTC')).toBeNull()
    expect(fromZonedFields('2026-10-29', '', 'UTC')).toBeNull()
  })
})

describe('timezoneOptions', () => {
  it('always includes the current zone and UTC, once each', () => {
    const list = timezoneOptions('Mars/Olympus')
    expect(list).toContain('Mars/Olympus')
    expect(list.filter((z) => z === 'UTC')).toHaveLength(1)
  })
})
