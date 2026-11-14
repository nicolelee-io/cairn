import type { TimelineItem } from '@cairn/shared'
import { cToUnit, getTempUnit } from './tempUnit.ts'

// Entries are always shown in the timezone they were written in, never the viewer's (SPEC 4).
// Intl does the zone maths, so DST and half-hour offsets just work.
const cache = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts)
  let f = cache.get(key)
  if (!f) cache.set(key, (f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz })))
  return f
}

/** 'YYYY-MM-DD' of the instant in `tz`; the grouping key for a day. */
export function dayKey(ms: number, tz: string): string {
  const p = Object.fromEntries(
    fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day}`
}

export const monthLabel = (ms: number, tz: string) =>
  fmt(tz, { month: 'long', year: 'numeric' }).format(ms)

/** { weekday: 'Thu', day: '29' } for the day column on a card. */
export function dayLabel(ms: number, tz: string) {
  const parts = fmt(tz, { weekday: 'short', day: 'numeric' }).formatToParts(ms)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { weekday: get('weekday'), day: get('day') }
}

export const timeLabel = (ms: number, tz: string) =>
  fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(ms)

/** 'Thursday, October 29, 2026' */
export const fullDate = (ms: number, tz: string) =>
  fmt(tz, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(ms)

/** 'Oct 5, 2024' */
export const shortDate = (ms: number, tz: string) =>
  fmt(tz, { year: 'numeric', month: 'short', day: 'numeric' }).format(ms)

/** '10/5/2024' (what the slash date command types). */
export const numericDate = (ms: number, tz: string) =>
  fmt(tz, { year: 'numeric', month: 'numeric', day: 'numeric' }).format(ms)

/** 'Friday' (what a template's {{weekday}} becomes). */
export const weekdayName = (ms: number, tz: string) => fmt(tz, { weekday: 'long' }).format(ms)

/** '3:04 PM MDT': the zone abbreviation says which clock the time is on. */
export const timeWithZone = (ms: number, tz: string) =>
  fmt(tz, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(ms)

export interface DayGroup {
  key: string
  weekday: string
  day: string
  items: TimelineItem[]
}
export interface MonthGroup {
  key: string
  label: string
  days: DayGroup[]
}

/**
 * Groups newest-first cards into months and days, each by the entry's own timezone. Grouping only
 * merges neighbours, so it works page by page and an entry never jumps between groups.
 */
export function groupTimeline(items: TimelineItem[]): MonthGroup[] {
  const months: MonthGroup[] = []
  for (const item of items) {
    const dKey = dayKey(item.createdAt, item.timezone)
    const mKey = dKey.slice(0, 7)
    let month = months[months.length - 1]
    if (month?.key !== mKey) {
      month = { key: mKey, label: monthLabel(item.createdAt, item.timezone), days: [] }
      months.push(month)
    }
    let day = month.days[month.days.length - 1]
    if (day?.key !== dKey) {
      day = { key: dKey, ...dayLabel(item.createdAt, item.timezone), items: [] }
      month.days.push(day)
    }
    day.items.push(item)
  }
  return months
}

/** `1 entry`, `3 entries`. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Stored metric, shown in the device's unit (°F by default). */
export const formatTemp = (c: number) => {
  const u = getTempUnit()
  return `${Math.round(cToUnit(c, u))}°`
}
