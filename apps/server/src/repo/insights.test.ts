import { beforeEach, describe, expect, it } from 'vitest'
import type { MoodKey } from '@cairn/shared'
import { addUser, memoryDb } from '../test-helpers.ts'
import { createRepos } from './index.ts'

let repos: ReturnType<typeof createRepos>
let other: ReturnType<typeof createRepos>
let journal: string

const write = (
  iso: string,
  extra: { mood?: MoodKey; timezone?: string; body?: string; tags?: string[] } = {},
) =>
  repos.entries.create({
    tags: extra.tags,
    journalId: journal,
    bodyMd: extra.body ?? 'x',
    createdAt: Date.parse(iso),
    timezone: extra.timezone ?? 'UTC',
    mood: extra.mood ?? null,
  })

beforeEach(async () => {
  const { db } = memoryDb()
  const [a, b] = [await addUser(db, 'a'), await addUser(db, 'b')]
  repos = createRepos(db, a.id)
  other = createRepos(db, b.id)
  journal = repos.journals.create({ name: 'J' }).id
})

describe('insights', () => {
  it('averages a month day by its own zone and skips unrated entries', () => {
    write('2026-10-05T08:00:00Z', { mood: 'sad' })
    write('2026-10-05T09:00:00Z', { mood: 'happy' })
    write('2026-10-05T10:00:00Z')
    // 11pm in Denver on the 31st is already November in UTC.
    const lone = write('2026-11-01T05:00:00Z', { timezone: 'America/Denver', mood: 'content' })
    const m = repos.insights.month('2026-10')
    expect(m.days).toEqual([
      {
        day: '2026-10-05',
        entries: 3,
        mood: 'happy',
        moodKinds: 2,
        valence: 0,
        entryId: null,
        journalIds: [journal],
      },
      {
        day: '2026-10-31',
        entries: 1,
        mood: 'content',
        moodKinds: 1,
        valence: 1,
        entryId: lone.id,
        journalIds: [journal],
      },
    ])
    expect(repos.insights.month('2026-11').days).toEqual([])
    // The Denver entry's own day is Oct 31, so November has none; Oct is listed once.
    write('2024-03-02T12:00:00Z')
    expect(repos.insights.monthsWithEntries()).toEqual(['2024-03', '2026-10'])
  })

  it('narrows the month, the day and the first month to one journal', () => {
    write('2026-10-05T12:00:00Z')
    const second = repos.journals.create({ name: 'K' }).id
    repos.entries.create({
      journalId: second,
      bodyMd: 'y',
      createdAt: Date.parse('2026-08-20T12:00:00Z'),
      timezone: 'UTC',
    })
    expect(repos.insights.firstMonth()).toBe('2026-08')
    expect(repos.insights.firstMonth(journal)).toBe('2026-10')
    expect(repos.insights.lastMonth()).toBe('2026-10')
    expect(repos.insights.lastMonth(second)).toBe('2026-08')
    expect(repos.insights.month('2026-08', journal).days).toEqual([])
    expect(repos.insights.month('2026-08', second).days).toHaveLength(1)
    expect(repos.insights.day('2026-10-05', second).items).toEqual([])
    expect(repos.insights.day('2026-10-05', journal).items).toHaveLength(1)
    // Someone else's journal id yields nothing.
    expect(other.insights.firstMonth(journal)).toBeNull()
    expect(other.insights.month('2026-10', journal).days).toEqual([])
  })

  it("counts details by each entry's own day, in live journals unless one is named", () => {
    write('2026-10-05T10:00:00Z')
    write('2026-10-05T23:30:00Z')
    write('2026-10-05T23:30:00Z', { timezone: 'Asia/Tokyo' })
    write('2026-10-07T10:00:00Z')
    const gone = write('2026-10-08T10:00:00Z')
    repos.entries.softDelete(gone.id)
    const second = repos.journals.create({ name: 'K' }).id
    repos.entries.create({
      journalId: second,
      bodyMd: 'y',
      createdAt: Date.parse('2026-10-09T12:00:00Z'),
      timezone: 'UTC',
    })
    const today = '2026-10-10'
    expect(repos.insights.details(today)).toMatchObject({ entries: 5, days: 4, media: 0 })
    expect(repos.insights.details(today, journal)).toMatchObject({ entries: 4, days: 3, media: 0 })
    repos.journals.update(second, { archived: true })
    expect(repos.insights.details(today)).toMatchObject({ entries: 4, days: 3, media: 0 })
    expect(repos.insights.details(today, second)).toMatchObject({ entries: 1, days: 1, media: 0 })
    expect(other.insights.details(today, journal)).toEqual({
      entries: 0,
      days: 0,
      media: 0,
      firstDay: null,
      lastDay: null,
      words: 0,
      currentStreak: 0,
      longestStreak: 0,
    })
  })

  it('works out the details range, words and streaks', () => {
    write('2026-10-05T10:00:00Z', { body: 'one two three' })
    write('2026-10-06T10:00:00Z', { body: '![a pic](photo:abc)\n\nfour five' })
    write('2026-10-08T10:00:00Z', { body: 'six' })
    write('2026-10-09T10:00:00Z')
    expect(repos.insights.details('2026-10-10', journal)).toMatchObject({
      firstDay: '2026-10-05',
      lastDay: '2026-10-09',
      words: 7,
      currentStreak: 2,
      longestStreak: 2,
    })
    // Nothing written today or yesterday ends the current streak.
    expect(repos.insights.details('2026-10-12', journal).currentStreak).toBe(0)
  })

  it('counts the days and words of the stats over their range', () => {
    write('2026-09-01T10:00:00Z', { body: 'old words here' })
    write('2026-10-29T10:00:00Z', { body: 'one two' })
    write('2026-10-29T18:00:00Z', { body: 'three' })
    write('2026-10-31T10:00:00Z', { body: '![p](photo:a) four' })
    expect(repos.insights.stats('2026-10-31', 'week')).toMatchObject({
      total: 3,
      days: 2,
      words: 4,
    })
    expect(repos.insights.stats('2026-10-31', 'all')).toMatchObject({ total: 4, days: 3, words: 7 })
  })

  it('counts stats over live entries in live journals only', () => {
    write('2026-10-30T20:00:00Z')
    const gone = write('2026-10-31T20:00:00Z')
    repos.entries.softDelete(gone.id)
    const archived = repos.journals.create({ name: 'Old' }).id
    repos.entries.create({
      journalId: archived,
      bodyMd: 'x',
      createdAt: Date.parse('2026-10-29T20:00:00Z'),
      timezone: 'UTC',
    })
    repos.journals.update(archived, { archived: true })
    const s = repos.insights.stats('2026-10-31', 'all')
    expect(s.total).toBe(1)
    expect(s.currentStreak).toBe(1)
    expect(s.mostActive).toBe('evening')
    expect(repos.insights.month('2026-10').days.map((d) => d.day)).not.toContain('2026-10-29')
  })

  it('lists earlier years on this month and day, newest first, in the entry zone', () => {
    write('2025-10-31T12:00:00Z', { body: 'last year' })
    write('2023-10-31T12:00:00Z', { body: 'older' })
    write('2024-11-01T05:00:00Z', { timezone: 'America/Denver', body: 'late night' })
    write('2025-11-01T12:00:00Z', { body: 'next day' })
    write('2026-10-31T12:00:00Z', { body: 'today' })
    const { years } = repos.insights.onThisDay('2026-10-31')
    expect(years.map((y) => [y.year, y.items.map((i) => i.title || i.excerpt)])).toEqual([
      [2025, ['last year']],
      [2024, ['late night']],
      [2023, ['older']],
    ])
  })

  it('matches Feb 29 only in leap years and returns nothing without entries', () => {
    expect(repos.insights.onThisDay('2026-10-31')).toEqual({ years: [] })
    write('2024-02-29T12:00:00Z')
    write('2023-02-28T12:00:00Z')
    expect(repos.insights.onThisDay('2028-02-29').years.map((y) => y.year)).toEqual([2024])
    expect(repos.insights.onThisDay('2026-02-28').years.map((y) => y.year)).toEqual([2023])
  })

  it("never shows another user's entries", () => {
    write('2025-10-31T12:00:00Z', { mood: 'meh' })
    expect(other.insights.stats('2026-10-31', 'all').total).toBe(0)
    expect(other.insights.month('2025-10').days).toEqual([])
    expect(other.insights.onThisDay('2026-10-31')).toEqual({ years: [] })
  })

  it('lists one local day newest first, in the entry zone, live journals only', () => {
    write('2026-10-05T08:00:00Z', { body: 'morning' })
    write('2026-10-05T20:00:00Z', { body: 'evening' })
    write('2026-10-06T03:00:00Z', { timezone: 'America/Denver', body: 'late' }) // still the 5th
    write('2026-10-06T08:00:00Z', { body: 'next day' })
    const archived = repos.journals.create({ name: 'Old' }).id
    repos.entries.create({
      journalId: archived,
      bodyMd: 'archived',
      createdAt: Date.parse('2026-10-05T12:00:00Z'),
      timezone: 'UTC',
    })
    repos.journals.update(archived, { archived: true })
    expect(repos.insights.day('2026-10-05').items.map((i) => i.title)).toEqual([
      'late',
      'evening',
      'morning',
    ])
    expect(repos.insights.day('2026-10-07').items).toEqual([])
    expect(other.insights.day('2026-10-05').items).toEqual([])
  })

  it('names the top tag of the range, ties by name', () => {
    write('2026-10-31T08:00:00Z', { tags: ['Travel', 'food'] })
    write('2026-10-30T08:00:00Z', { tags: ['travel'] })
    write('2026-10-29T08:00:00Z', { tags: ['food', 'Rain'] })
    write('2026-09-01T08:00:00Z', { tags: ['old', 'old2'] })
    write('2026-09-02T08:00:00Z', { tags: ['old'] })
    write('2026-09-03T08:00:00Z', { tags: ['old'] })
    expect(repos.insights.stats('2026-10-31', 'week').topTag).toEqual({ name: 'food', count: 2 })
    expect(repos.insights.stats('2026-10-31', 'all').topTag).toEqual({ name: 'old', count: 3 })
    expect(repos.insights.stats('2026-10-01', 'week').topTag).toBeNull()
    expect(other.insights.stats('2026-10-31', 'all').topTag).toBeNull()
  })
})
