import { z } from 'zod'
import { MoodSchema, moodByKey, type MoodKey } from './mood.ts'
import { TimelineItemSchema } from './api.ts'

// Insights are computed on demand from entries (no stored aggregates), and every figure groups by
// the entry's own time zone, so these helpers are shared by the server's queries and their tests.

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
      })
    } catch {
      f = formatter('UTC') // an unknown zone name in old data: read it as UTC rather than fail
    }
    formatters.set(tz, f)
  }
  return f
}

/** The local calendar day ('YYYY-MM-DD') and hour (0-23) of an instant in `tz`. */
export function localDayHour(ms: number, tz: string): { day: string; hour: number } {
  const p: Record<string, string> = {}
  for (const x of formatter(tz).formatToParts(ms)) p[x.type] = x.value
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }
}

/** No zone is more than 14 hours from UTC; widen a UTC window by this to catch every local day. */
export const MAX_UTC_OFFSET_MS = 14 * 3_600_000

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** A row the insights are built from. */
export interface InsightRow {
  /** Only needed by the month view, which names the entry of a day that has just one. */
  id?: string
  /** Only needed by the month view, which colours a day by the journals it has entries in. */
  journalId?: string
  createdAt: number
  timezone: string
  mood: MoodKey | null
  /** Only needed by the stats, which add up the words written. */
  words?: number
}

export const TIME_OF_DAY = [
  { key: 'morning', label: 'Morning', from: 5, to: 11 },
  { key: 'afternoon', label: 'Afternoon', from: 12, to: 16 },
  { key: 'evening', label: 'Evening', from: 17, to: 20 },
  { key: 'night', label: 'Night', from: 21, to: 4 },
] as const
export type TimeOfDay = (typeof TIME_OF_DAY)[number]['key']

export const timeOfDay = (hour: number): TimeOfDay =>
  hour >= 5 && hour <= 11
    ? 'morning'
    : hour >= 12 && hour <= 16
      ? 'afternoon'
      : hour >= 17 && hour <= 20
        ? 'evening'
        : 'night'

export const InsightsRangeSchema = z.enum(['week', 'month', 'all'])
export type InsightsRange = z.infer<typeof InsightsRangeSchema>
const RANGE_DAYS = { week: 7, month: 30 } as const

/** The first local day of `range` ending at `today`; null for all time. */
export const rangeFromDay = (today: string, range: InsightsRange): string | null =>
  range === 'all' ? null : addDays(today, 1 - RANGE_DAYS[range])

export const InsightsStatsSchema = z.object({
  /** Entries in the range. */
  total: z.number(),
  /** Different local days in the range with an entry, and the words written in it. */
  days: z.number(),
  words: z.number(),
  /** Consecutive days with an entry, ending today (or yesterday, if nothing is written yet today). */
  currentStreak: z.number(),
  longestStreak: z.number(),
  /** Entries in the range per time of day; `mostActive` is the busiest one, null with no entries. */
  timeOfDay: z.object({
    morning: z.number(),
    afternoon: z.number(),
    evening: z.number(),
    night: z.number(),
  }),
  mostActive: z.enum(['morning', 'afternoon', 'evening', 'night']).nullable(),
  /** The tag on the most entries in the range (ties go to the first by name); null when none is tagged. */
  topTag: z.object({ name: z.string(), count: z.number() }).nullable(),
})
export type InsightsStats = z.infer<typeof InsightsStatsSchema>
/** What the pure maths covers; the repo adds the top tag, which needs the tag tables. */
export type ComputedStats = Omit<InsightsStats, 'topTag'>

/** Streaks cover all time; `total`, `days`, `words` and the time of day cover `range` ending at `today` (local). */
export function computeStats(
  rows: InsightRow[],
  today: string,
  range: InsightsRange,
): ComputedStats {
  const days = new Set<string>()
  const counts = { morning: 0, afternoon: 0, evening: 0, night: 0 }
  const from = rangeFromDay(today, range)
  const inRange = new Set<string>()
  let total = 0
  let words = 0
  for (const r of rows) {
    const { day, hour } = localDayHour(r.createdAt, r.timezone)
    days.add(day)
    if (day > today || (from !== null && day < from)) continue
    total++
    words += r.words ?? 0
    inRange.add(day)
    counts[timeOfDay(hour)]++
  }

  let current = 0
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1))
    current++
  let longest = 0
  let run = 0
  let prev: string | null = null
  for (const d of [...days].sort()) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = d
  }

  const busiest = TIME_OF_DAY.reduce((a, b) => (counts[b.key] > counts[a.key] ? b : a))
  return {
    total,
    days: inRange.size,
    words,
    currentStreak: current,
    longestStreak: longest,
    timeOfDay: counts,
    mostActive: total === 0 ? null : busiest.key,
  }
}

export const InsightsMonthSchema = z.object({
  month: z.string(),
  days: z.array(
    z.object({
      /** 'YYYY-MM-DD' */
      day: z.string(),
      entries: z.number(),
      /** The day's most frequent mood, ties going to the latest entry; null when none is rated. */
      mood: MoodSchema.nullable(),
      /** How many different moods the day has (the calendar hints at more than the one shown). */
      moodKinds: z.number(),
      /** Mean valence (-2..2) of the day's rated entries, for the cell tint; null when none is rated. */
      valence: z.number().nullable(),
      /** The entry itself when the day has exactly one (the calendar opens it directly). */
      entryId: z.string().nullable(),
      /** The journals the day's entries are in (first appearance order), for the cell colour. */
      journalIds: z.array(z.string()),
    }),
  ),
})
export type InsightsMonth = z.infer<typeof InsightsMonthSchema>

/** Days of `month` ('YYYY-MM') that have entries. Unrated entries count as entries, not as a mood. */
export function computeMonth(rows: InsightRow[], month: string): InsightsMonth {
  const byDay = new Map<
    string,
    {
      entries: number
      id: string | null
      journalIds: Set<string>
      /** Per mood: how many entries, and the createdAt of the latest. */
      moods: Map<MoodKey, { n: number; latest: number }>
    }
  >()
  for (const r of rows) {
    const { day } = localDayHour(r.createdAt, r.timezone)
    if (!day.startsWith(month)) continue
    const d = byDay.get(day) ?? { entries: 0, id: r.id ?? null, journalIds: new Set<string>(), moods: new Map() }
    d.entries++
    if (d.entries > 1) d.id = null
    if (r.journalId) d.journalIds.add(r.journalId)
    if (r.mood !== null) {
      const m = d.moods.get(r.mood) ?? { n: 0, latest: 0 }
      m.n++
      m.latest = Math.max(m.latest, r.createdAt)
      d.moods.set(r.mood, m)
    }
    byDay.set(day, d)
  }
  return {
    month,
    days: [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, d]) => {
        const ranked = [...d.moods.entries()].sort(
          ([, a], [, b]) => b.n - a.n || b.latest - a.latest,
        )
        let sum = 0
        let rated = 0
        for (const [key, { n }] of ranked) {
          sum += (moodByKey(key)?.valence ?? 0) * n
          rated += n
        }
        return {
          day,
          entries: d.entries,
          mood: ranked[0]?.[0] ?? null,
          moodKinds: ranked.length,
          valence: rated ? sum / rated : null,
          entryId: d.id,
          journalIds: [...d.journalIds],
        }
      }),
  }
}

export const OnThisDaySchema = z.object({
  /** Earlier years with entries on this month and day, newest year first. */
  years: z.array(z.object({ year: z.number(), items: z.array(TimelineItemSchema) })),
})
export type OnThisDay = z.infer<typeof OnThisDaySchema>

/** 'YYYY-MM-DD' that is a real calendar day. */
export const DayKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
  })
export const MonthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

/** The UTC span that holds every instant whose local day, in any zone, is `day`. */
export function dayWindowUtc(day: string): { from: number; to: number } {
  const start = Date.parse(`${day}T00:00:00Z`)
  return { from: start - MAX_UTC_OFFSET_MS, to: start + 24 * 3_600_000 + MAX_UTC_OFFSET_MS }
}

/** Whether an entry's own local day (in its own timezone) lies in `from`..`to`, both inclusive and optional. */
export function dayInRange(
  createdAt: number,
  timezone: string,
  from: string | undefined,
  to: string | undefined,
): boolean {
  if (!from && !to) return true
  const { day } = localDayHour(createdAt, timezone)
  return (!from || day >= from) && (!to || day <= to)
}

/** The months ('YYYY-MM') of the oldest and the newest entry; null when there are none. */
export const InsightsFirstMonthSchema = z.object({
  month: z.string().nullable(),
  lastMonth: z.string().nullable(),
})

/** The months ('YYYY-MM', oldest first) that have entries, for the month picker. */
export const InsightsMonthsSchema = z.object({ months: z.array(z.string()) })

/**
 * The Entries Details view's numbers: entries, the different days they were written on (each in the
 * entry's own zone), photos plus files, the first and last of those days (null with no entries),
 * words written and the streaks (the current one ends today or yesterday, like Insights').
 */
export const InsightsDetailsSchema = z.object({
  entries: z.number(),
  days: z.number(),
  media: z.number(),
  firstDay: z.string().nullable(),
  lastDay: z.string().nullable(),
  words: z.number(),
  currentStreak: z.number(),
  longestStreak: z.number(),
})

/** Words in an entry's markdown; photo and file references and bare markers (`#`, `-`) don't count. */
export function countWords(md: string): number {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').match(/\S*[\p{L}\p{N}]\S*/gu)?.length ?? 0
}
export type InsightsDetails = z.infer<typeof InsightsDetailsSchema>

export const InsightsDaySchema = z.object({ items: z.array(TimelineItemSchema) })
export type InsightsDay = z.infer<typeof InsightsDaySchema>
