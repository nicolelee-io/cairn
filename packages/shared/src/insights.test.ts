import { describe, expect, it } from 'vitest'
import {
  computeMonth,
  computeStats,
  dayInRange,
  localDayHour,
  type InsightRow,
} from './insights.ts'
import { MoodSchema, readMood, type MoodKey } from './mood.ts'

const at = (iso: string, timezone = 'UTC', mood: MoodKey | null = null): InsightRow => ({
  createdAt: Date.parse(iso),
  timezone,
  mood,
})

describe('localDayHour', () => {
  it("uses the entry's zone, not UTC", () => {
    // 03:30 UTC on the 2nd is 9:30pm on the 1st in Denver (MDT).
    expect(localDayHour(Date.parse('2026-10-02T03:30:00Z'), 'America/Denver')).toEqual({
      day: '2026-10-01',
      hour: 21,
    })
  })
  it('reads an unknown zone as UTC', () => {
    expect(localDayHour(Date.parse('2026-10-02T03:30:00Z'), 'Nowhere/Land').day).toBe('2026-10-02')
  })
})

describe('computeStats', () => {
  it('counts a streak back from today, or from yesterday when today is empty', () => {
    const rows = [
      at('2026-10-29T12:00:00Z'),
      at('2026-10-30T12:00:00Z'),
      at('2026-10-31T01:00:00Z'),
    ]
    expect(computeStats(rows, '2026-10-31', 'all').currentStreak).toBe(3)
    expect(computeStats(rows, '2026-11-01', 'all').currentStreak).toBe(3)
    expect(computeStats(rows, '2026-11-02', 'all').currentStreak).toBe(0)
  })
  it('finds the longest streak across gaps', () => {
    const rows = ['01', '02', '03', '10', '11'].map((d) => at(`2026-10-${d}T12:00:00Z`))
    expect(computeStats(rows, '2026-10-31', 'all').longestStreak).toBe(3)
  })
  it('keeps a late-night entry on its own local day for the streak', () => {
    // 11pm on the 30th and 11pm on the 31st in Denver are the 31st and 1st in UTC.
    const rows = [
      at('2026-10-31T05:00:00Z', 'America/Denver'),
      at('2026-11-01T05:00:00Z', 'America/Denver'),
    ]
    expect(computeStats(rows, '2026-10-31', 'all').currentStreak).toBe(2)
  })
  it('limits the total and time of day to the range, not the streaks', () => {
    const rows = [
      at('2026-10-31T08:00:00Z'),
      at('2026-10-30T23:00:00Z'),
      at('2026-09-01T08:00:00Z'),
    ]
    const week = computeStats(rows, '2026-10-31', 'week')
    expect(week.total).toBe(2)
    expect(week.timeOfDay).toEqual({ morning: 1, afternoon: 0, evening: 0, night: 1 })
    expect(computeStats(rows, '2026-10-31', 'all').total).toBe(3)
    expect(week.currentStreak).toBe(2)
  })
  it('has no most active time without entries', () => {
    expect(computeStats([], '2026-10-31', 'all').mostActive).toBeNull()
  })
  it('names the busiest time of day', () => {
    const rows = [
      at('2026-10-30T19:00:00Z'),
      at('2026-10-31T20:00:00Z'),
      at('2026-10-31T08:00:00Z'),
    ]
    expect(computeStats(rows, '2026-10-31', 'all').mostActive).toBe('evening')
  })
})

describe('computeMonth', () => {
  it('shows the most common mood of a day, the latest winning a tie, and ignores unrated entries', () => {
    const m = computeMonth(
      [
        at('2026-10-05T08:00:00Z', 'UTC', 'sad'),
        at('2026-10-05T18:00:00Z', 'UTC', 'happy'),
        at('2026-10-05T20:00:00Z', 'UTC', null),
        { ...at('2026-10-06T08:00:00Z'), id: 'e6' },
        at('2026-09-30T08:00:00Z', 'UTC', 'sad'),
      ],
      '2026-10',
    )
    expect(m.days).toEqual([
      { day: '2026-10-05', entries: 3, mood: 'happy', moodKinds: 2, valence: 0, entryId: null, journalIds: [] },
      { day: '2026-10-06', entries: 1, mood: null, moodKinds: 0, valence: null, entryId: 'e6', journalIds: [] },
    ])
  })
  it('lists the journals of a day once each, in order of appearance', () => {
    const m = computeMonth(
      [
        { ...at('2026-10-05T08:00:00Z'), journalId: 'b' },
        { ...at('2026-10-05T09:00:00Z'), journalId: 'a' },
        { ...at('2026-10-05T10:00:00Z'), journalId: 'b' },
      ],
      '2026-10',
    )
    expect(m.days[0]?.journalIds).toEqual(['b', 'a'])
  })
  it("puts an entry in the month of its own zone's day", () => {
    const m = computeMonth([at('2026-11-01T03:00:00Z', 'America/Denver')], '2026-10')
    expect(m.days.map((d) => d.day)).toEqual(['2026-10-31'])
  })
})

describe('computeMonth moods', () => {
  it('takes the most frequent mood over a later one', () => {
    const m = computeMonth(
      [
        at('2026-10-05T08:00:00Z', 'UTC', 'anxious'),
        at('2026-10-05T12:00:00Z', 'UTC', 'anxious'),
        at('2026-10-05T20:00:00Z', 'UTC', 'calm'),
      ],
      '2026-10',
    )
    expect(m.days[0]).toMatchObject({ mood: 'anxious', moodKinds: 2 })
  })
})

describe('mood keys', () => {
  it('reads old 1-5 ratings as the keys they became', () => {
    expect(readMood(1)).toBe('sad')
    expect(readMood(3)).toBe('meh')
    expect(readMood(5)).toBe('happy')
    expect(readMood('angry')).toBe('angry')
  })
  it('treats anything else as unrated and rejects it in the schema', () => {
    expect(readMood(6)).toBeNull()
    expect(readMood('ecstatic')).toBeNull()
    expect(readMood(null)).toBeNull()
    expect(MoodSchema.safeParse(0).success).toBe(false)
    expect(MoodSchema.safeParse('ecstatic').success).toBe(false)
  })
})

describe('dayInRange', () => {
  it('compares the entry’s own local day, inclusive, either end optional', () => {
    const t = Date.parse('2026-10-02T03:30:00Z') // 2026-10-01 in Denver
    expect(dayInRange(t, 'America/Denver', '2026-10-01', '2026-10-01')).toBe(true)
    expect(dayInRange(t, 'America/Denver', '2026-10-02', undefined)).toBe(false)
    expect(dayInRange(t, 'UTC', '2026-10-02', '2026-10-02')).toBe(true)
    expect(dayInRange(t, 'UTC', undefined, '2026-10-01')).toBe(false)
    expect(dayInRange(t, 'UTC', undefined, undefined)).toBe(true)
  })
})
