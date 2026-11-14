import type { TimelineItem } from '@cairn/shared'
import { describe, expect, it } from 'vitest'
import { dayKey, fullDate, groupTimeline, timeWithZone } from './format.ts'

const item = (id: string, iso: string, timezone: string): TimelineItem => ({
  id,
  journalId: 'j',
  createdAt: Date.parse(iso),
  timezone,
  starred: false,
  pinned: false,
  allDay: false,
  mood: null,
  title: '',
  excerpt: '',
  photoCount: 0,
  photos: [],
  hasAttachments: false,
  placeName: null,
  weather: null,
})

describe('entry-local dates', () => {
  // 03:30 UTC on the 30th is still the evening of the 29th in Denver.
  const instant = Date.parse('2026-10-30T03:30:00Z')

  it('uses the entry timezone, not the viewer’s', () => {
    expect(dayKey(instant, 'America/Denver')).toBe('2026-10-29')
    expect(dayKey(instant, 'UTC')).toBe('2026-10-30')
    expect(dayKey(instant, 'Asia/Tokyo')).toBe('2026-10-30')
  })

  it('formats the date and a zone-labelled time', () => {
    expect(fullDate(instant, 'America/Denver')).toBe('Thursday, October 29, 2026')
    expect(timeWithZone(instant, 'America/Denver')).toBe('9:30 PM MDT')
  })

  it('handles the daylight-saving change', () => {
    // US clocks went back on 2026-11-01: the same wall time is MST afterwards.
    expect(timeWithZone(Date.parse('2026-11-01T20:00:00Z'), 'America/Denver')).toBe('1:00 PM MST')
  })
})

describe('groupTimeline', () => {
  it('groups by month and day in each entry’s own zone', () => {
    const groups = groupTimeline([
      item('a', '2026-11-01T06:30:00Z', 'America/Denver'), // 11/01 00:30 MDT
      item('b', '2026-11-01T03:00:00Z', 'America/Denver'), // 10/31 21:00 MDT: previous month locally
      item('c', '2026-10-31T10:00:00Z', 'America/Denver'),
      item('d', '2026-10-30T12:00:00Z', 'UTC'),
    ])
    expect(
      groups.map((m) => [m.label, m.days.map((d) => [d.key, d.items.map((i) => i.id)])]),
    ).toEqual([
      ['November 2026', [['2026-11-01', ['a']]]],
      [
        'October 2026',
        [
          ['2026-10-31', ['b', 'c']],
          ['2026-10-30', ['d']],
        ],
      ],
    ])
  })

  it('labels days with weekday and number, and returns nothing for no items', () => {
    const [m] = groupTimeline([item('a', '2026-10-29T18:00:00Z', 'America/Denver')])
    expect(m!.days[0]).toMatchObject({ weekday: 'Thu', day: '29' })
    expect(groupTimeline([])).toEqual([])
  })
})
