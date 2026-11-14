import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import {
  computeMonth,
  computeStats,
  countWords,
  dayWindowUtc,
  rangeFromDay,
  type InsightsDay,
  type InsightsDetails,
  localDayHour,
  MAX_UTC_OFFSET_MS,
  type InsightRow,
  type InsightsMonth,
  type InsightsRange,
  type InsightsStats,
  type OnThisDay,
} from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { attachments, entries, entryTags, journals, photos, tags } from '../db/schema.ts'
import { entryCards } from './entries.ts'

/**
 * Insights are worked out on demand from the entries (no stored aggregates): SQLite can't turn an
 * instant into a day in an IANA zone, and a stored local date would drift whenever an entry's time
 * is edited. SQL narrows to a UTC window wide enough for any zone; `@cairn/shared` then groups by
 * each entry's own local day. Revisit with a stored `local_date` only if journals reach ~50k entries.
 */
export function insightsRepo(db: Db, userId: string) {
  // Archived journals are left out of every insight (calendar, mood, stats, day list, On this day).
  // `journalId` narrows to one journal (the Entries calendar follows the journal being browsed).
  const live = (journalId?: string) =>
    and(
      eq(entries.userId, userId),
      isNull(entries.deletedAt),
      isNull(journals.archivedAt),
      journalId ? eq(entries.journalId, journalId) : undefined,
    )

  // A tombstoned journal's entries are gone with it.
  const journalJoin = and(
    eq(journals.id, entries.journalId),
    eq(journals.userId, userId),
    isNull(journals.deletedAt),
  )

  const rowsIn = (windows: { from: number; to: number }[], journalId?: string): InsightRow[] =>
    db
      .select({
        id: entries.id,
        journalId: entries.journalId,
        createdAt: entries.createdAt,
        timezone: entries.timezone,
        mood: entries.moodKey,
      })
      .from(entries)
      .innerJoin(journals, journalJoin)
      .where(
        and(
          live(journalId),
          or(
            ...windows.map((w) => and(gte(entries.createdAt, w.from), lt(entries.createdAt, w.to))),
          ),
        ),
      )
      .all()

  /** The most used tag among the entries of `range`; their local days are checked in JS. */
  const topTag = (today: string, range: InsightsRange) => {
    const from = rangeFromDay(today, range)
    let inRange: ReturnType<typeof inArray> | undefined
    if (from !== null) {
      const ids = db
        .select({ id: entries.id, createdAt: entries.createdAt, timezone: entries.timezone })
        .from(entries)
        .innerJoin(journals, journalJoin)
        .where(
          and(
            live(),
            gte(entries.createdAt, dayWindowUtc(from).from),
            lt(entries.createdAt, dayWindowUtc(today).to),
          ),
        )
        .all()
        .filter((e) => {
          const day = localDayHour(e.createdAt, e.timezone).day
          return day >= from && day <= today
        })
        .map((e) => e.id)
      if (!ids.length) return null
      inRange = inArray(entryTags.entryId, ids)
    }
    return (
      db
        .select({ name: tags.name, count: sql<number>`count(*)` })
        .from(entryTags)
        .innerJoin(tags, eq(tags.id, entryTags.tagId))
        .innerJoin(entries, eq(entries.id, entryTags.entryId))
        .innerJoin(journals, journalJoin)
        .where(and(eq(entryTags.userId, userId), isNull(tags.deletedAt), live(), inRange))
        .groupBy(tags.id)
        .orderBy(sql`count(*) desc`, sql`lower(${tags.name})`)
        .limit(1)
        .get() ?? null
    )
  }

  return {
    stats(today: string, range: InsightsRange): InsightsStats {
      const rows = db
        .select({
          createdAt: entries.createdAt,
          timezone: entries.timezone,
          mood: entries.moodKey,
          body: entries.bodyMd,
        })
        .from(entries)
        .innerJoin(journals, journalJoin)
        .where(live())
        .all()
        .map(({ body, ...r }) => ({ ...r, words: countWords(body) }))
      return { ...computeStats(rows, today, range), topTag: topTag(today, range) }
    },

    /** `month` is 'YYYY-MM'. */
    month(month: string, journalId?: string): InsightsMonth {
      const first = `${month}-01`
      const next = new Date(`${first}T00:00:00Z`)
      next.setUTCMonth(next.getUTCMonth() + 1)
      // From 14h before the month starts in UTC to 14h after it ends.
      const from = dayWindowUtc(first).from
      const to = dayWindowUtc(next.toISOString().slice(0, 10)).from + 2 * MAX_UTC_OFFSET_MS
      return computeMonth(rowsIn([{ from, to }], journalId), month)
    },

    /**
     * The month ('YYYY-MM') of the oldest entry, or null when there are none. Taken in UTC minus
     * the largest zone offset, so it can name a month too early (an empty one) but never too late.
     */
    firstMonth(journalId?: string): string | null {
      const oldest = db
        .select({ at: sql<number | null>`min(${entries.createdAt})` })
        .from(entries)
        .innerJoin(journals, journalJoin)
        .where(live(journalId))
        .get()?.at
      return oldest == null ? null : new Date(oldest - MAX_UTC_OFFSET_MS).toISOString().slice(0, 7)
    },

    /**
     * The month ('YYYY-MM') of the newest entry, or null when there are none. The mirror of
     * firstMonth: it can name a month too late (an empty one) but never too early.
     */
    lastMonth(journalId?: string): string | null {
      const newest = db
        .select({ at: sql<number | null>`max(${entries.createdAt})` })
        .from(entries)
        .innerJoin(journals, journalJoin)
        .where(live(journalId))
        .get()?.at
      return newest == null ? null : new Date(newest + MAX_UTC_OFFSET_MS).toISOString().slice(0, 7)
    },

    /**
     * Every month ('YYYY-MM', oldest first) that has an entry on one of its local days, for the
     * entry list's month picker. Archived journals count only when named, like the timeline.
     */
    monthsWithEntries(journalId?: string): string[] {
      const rows = db
        .select({ createdAt: entries.createdAt, timezone: entries.timezone })
        .from(entries)
        .innerJoin(journals, journalJoin)
        .where(
          and(
            eq(entries.userId, userId),
            isNull(entries.deletedAt),
            journalId ? eq(entries.journalId, journalId) : isNull(journals.archivedAt),
          ),
        )
        .all()
      const months = new Set(rows.map((r) => localDayHour(r.createdAt, r.timezone).day.slice(0, 7)))
      return [...months].sort()
    },

    /**
     * Numbers for the Details view. Archived journals count only when named, like the timeline and
     * the media feed.
     */
    details(today: string, journalId?: string): InsightsDetails {
      const scope = and(
        eq(entries.userId, userId),
        isNull(entries.deletedAt),
        journalId ? eq(entries.journalId, journalId) : isNull(journals.archivedAt),
      )
      const rows = db
        .select({
          id: entries.id,
          createdAt: entries.createdAt,
          timezone: entries.timezone,
          body: entries.bodyMd,
        })
        .from(entries)
        .innerJoin(journals, journalJoin)
        .where(scope)
        .all()
      const days = [...new Set(rows.map((r) => localDayHour(r.createdAt, r.timezone).day))].sort()
      const { currentStreak, longestStreak } = computeStats(
        rows.map((r) => ({ ...r, mood: null })),
        today,
        'all',
      )
      const count = (table: typeof photos | typeof attachments) =>
        db
          .select({ n: sql<number>`count(*)` })
          .from(table)
          .innerJoin(entries, eq(entries.id, table.entryId))
          .innerJoin(journals, journalJoin)
          .where(and(eq(table.userId, userId), isNull(table.deletedAt), scope))
          .get()?.n ?? 0
      return {
        entries: rows.length,
        days: days.length,
        media: count(photos) + count(attachments),
        firstDay: days[0] ?? null,
        lastDay: days[days.length - 1] ?? null,
        words: rows.reduce((n, r) => n + countWords(r.body), 0),
        currentStreak,
        longestStreak,
      }
    },

    /** The entries written on one local day, newest first (live journals only). */
    day(date: string, journalId?: string): InsightsDay {
      const w = dayWindowUtc(date)
      const found = db
        .select({ e: entries })
        .from(entries)
        .innerJoin(journals, journalJoin)
        .where(and(live(journalId), gte(entries.createdAt, w.from), lt(entries.createdAt, w.to)))
        .orderBy(desc(entries.createdAt), desc(entries.id))
        .all()
        .map((r) => r.e)
        .filter((e) => localDayHour(e.createdAt, e.timezone).day === date)
      return { items: entryCards(db, userId, found) }
    },

    /** Entries from earlier years on `date`'s month and day (Feb 29 only in leap years). */
    onThisDay(date: string): OnThisDay {
      const [year, md] = [Number(date.slice(0, 4)), date.slice(4)]
      const oldest = db
        .select({ at: sql<number | null>`min(${entries.createdAt})` })
        .from(entries)
        .innerJoin(journals, journalJoin)
        .where(live())
        .get()?.at
      if (oldest == null) return { years: [] }
      const windows: { from: number; to: number }[] = []
      for (let y = year - 1; y >= new Date(oldest - 86_400_000).getUTCFullYear(); y--) {
        const day = `${String(y).padStart(4, '0')}${md}`
        if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) continue // no Feb 29
        windows.push(dayWindowUtc(day))
      }
      if (!windows.length) return { years: [] }
      const found = db
        .select({ e: entries })
        .from(entries)
        .innerJoin(journals, journalJoin)
        .where(
          and(
            live(),
            or(
              ...windows.map((w) =>
                and(gte(entries.createdAt, w.from), lt(entries.createdAt, w.to)),
              ),
            ),
          ),
        )
        .orderBy(asc(entries.createdAt))
        .all()
        .map((r) => r.e)
        .filter((e) => {
          const day = localDayHour(e.createdAt, e.timezone).day
          return day.slice(4) === md && Number(day.slice(0, 4)) < year
        })
      const cards = entryCards(db, userId, found)
      const byYear = new Map<number, typeof cards>()
      for (const c of cards) {
        const y = Number(localDayHour(c.createdAt, c.timezone).day.slice(0, 4))
        byYear.set(y, [...(byYear.get(y) ?? []), c])
      }
      return {
        years: [...byYear.entries()]
          .sort(([a], [b]) => b - a)
          .map(([y, items]) => ({ year: y, items })),
      }
    },
  }
}
