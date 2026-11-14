import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type {
  Location,
  ManualWeather,
  MapData,
  MoodKey,
  TimelineItem,
  WeatherEdit,
} from '@cairn/shared'
import {
  THUMBS_PER_CARD,
  isAutoWeather,
  decodeCursor,
  encodeCursor,
  summarize,
  uuidv7,
} from '@cairn/shared'
import type { Db } from '../db/index.ts'
import {
  attachments,
  entries,
  entryLocations,
  entryTags,
  entryWeather,
  journals,
  photos,
  tags,
} from '../db/schema.ts'
import { removeMedia, syncEntryMedia } from './media.ts'
import { indexEntry, removeFromIndex } from '../search/index.ts'
import type { NewWeather } from './imports.ts'
import { replayOrFree } from './clientId.ts'
import { nextRev } from './rev.ts'
import { findTagId, writeEntryTags } from './tags.ts'

export { summarize }

export class RevConflictError extends Error {
  constructor(
    readonly currentRev: number,
    readonly baseRev: number,
  ) {
    super(`entry changed since rev ${baseRev} (now ${currentRev})`)
  }
}

export class JournalNotFoundError extends Error {
  constructor() {
    super('journal not found')
  }
}

/** Archived journals are read-only until unarchived (SPEC, Phase 3). */
export class JournalArchivedError extends Error {
  constructor() {
    super('journal is archived')
  }
}

/** The client-supplied id belongs to someone else's entry. */
export class IdTakenError extends Error {
  constructor() {
    super('id already in use')
  }
}

export interface EntryInput {
  id?: string
  journalId: string
  bodyMd?: string
  createdAt?: number
  timezone: string
  starred?: boolean
  pinned?: boolean
  allDay?: boolean
  mood?: MoodKey | null
  location?: Location | null
  weather?: ManualWeather | null
  tags?: string[]
}

/** `location`: undefined leaves the place alone, null removes it. */
export type EntryPatch = Partial<
  Pick<
    EntryInput,
    'bodyMd' | 'createdAt' | 'timezone' | 'starred' | 'pinned' | 'allDay' | 'mood' | 'location'
  >
> & { journalId?: string; weather?: WeatherEdit | null; tags?: string[] }

/** A hand-entered weather as a row: only what was entered, the rest blank. */
const manualRow = (w: ManualWeather): NewWeather => ({
  ...w,
  feelsLikeC: null,
  description: null,
  pressureMb: null,
  humidityPct: null,
  windKph: null,
  windBearing: null,
  visibilityKm: null,
  sunrise: null,
  sunset: null,
  source: 'manual',
  sourceCode: null,
  fetchedAt: null,
  raw: null,
})

/** Sets a hand-entered weather, or removes it (null, or `auto`, which then refetches after the save). */
function writeWeather(tx: Db, userId: string, entryId: string, w: WeatherEdit | null) {
  tx.delete(entryWeather).where(eq(entryWeather.entryId, entryId)).run()
  if (w && !('auto' in w))
    tx.insert(entryWeather)
      .values({ ...manualRow(w), entryId, userId })
      .run()
}

/** Replaces (or, with null, removes) an entry's one place. Call inside the writing transaction. */
function writeLocation(tx: Db, userId: string, entryId: string, loc: Location | null) {
  tx.delete(entryLocations).where(eq(entryLocations.entryId, entryId)).run()
  if (loc)
    tx.insert(entryLocations)
      .values({ ...loc, entryId, userId })
      .run()
}

/**
 * Timeline cards for entry rows, in the order given (photos, attachments, place and weather looked
 * up in bulk).
 */
export function entryCards(
  db: Db,
  userId: string,
  page: (typeof entries.$inferSelect)[],
): TimelineItem[] {
  const ids = page.map((e) => e.id)
  const photoRows = ids.length
    ? db
        .select()
        .from(photos)
        .where(
          and(inArray(photos.entryId, ids), eq(photos.userId, userId), isNull(photos.deletedAt)),
        )
        .orderBy(asc(photos.position))
        .all()
    : []
  const places = ids.length
    ? db
        .select({ entryId: entryLocations.entryId, placeName: entryLocations.placeName })
        .from(entryLocations)
        .where(and(inArray(entryLocations.entryId, ids), eq(entryLocations.userId, userId)))
        .all()
    : []
  const withFiles = new Set(
    ids.length
      ? db
          .selectDistinct({ entryId: attachments.entryId })
          .from(attachments)
          .where(
            and(
              inArray(attachments.entryId, ids),
              eq(attachments.userId, userId),
              isNull(attachments.deletedAt),
            ),
          )
          .all()
          .map((a) => a.entryId)
      : [],
  )
  const weathers = ids.length
    ? db
        .select()
        .from(entryWeather)
        .where(and(inArray(entryWeather.entryId, ids), eq(entryWeather.userId, userId)))
        .all()
    : []

  return page.map((e): TimelineItem => {
    const ps = photoRows.filter((p) => p.entryId === e.id)
    const w = weathers.find((x) => x.entryId === e.id)
    return {
      id: e.id,
      journalId: e.journalId,
      createdAt: e.createdAt,
      timezone: e.timezone,
      starred: e.starred,
      pinned: e.pinned,
      allDay: e.allDay,
      mood: e.moodKey,
      ...summarize(e.bodyMd),
      photoCount: ps.length,
      photos: ps.slice(0, THUMBS_PER_CARD).map((p) => ({
        id: p.id,
        position: p.position,
        width: p.width,
        height: p.height,
        takenAt: p.takenAt,
        latitude: p.latitude,
        longitude: p.longitude,
      })),
      hasAttachments: withFiles.has(e.id),
      placeName: places.find((l) => l.entryId === e.id)?.placeName ?? null,
      weather: w ? { condition: w.condition, tempC: w.tempC } : null,
    }
  })
}

/** Every query here is filtered by `userId` and excludes tombstones. */
/** How much of an entry's text the map reads for a pin's title (it shows at most ~240 chars). */
const MAP_HEAD_CHARS = 1000

export function entryRepo(db: Db, userId: string) {
  const mine = (id: string) =>
    and(eq(entries.id, id), eq(entries.userId, userId), isNull(entries.deletedAt))

  // A journal id is only valid if it is one of *this user's* live journals, and writable.
  const assertWritableJournal = (tx: Db, journalId: string) => {
    const j = tx
      .select({ archivedAt: journals.archivedAt })
      .from(journals)
      .where(
        and(eq(journals.id, journalId), eq(journals.userId, userId), isNull(journals.deletedAt)),
      )
      .get()
    if (!j) throw new JournalNotFoundError()
    if (j.archivedAt !== null) throw new JournalArchivedError()
  }

  /** An entry row with its location, weather, tag names, photos and attachments (in order). */
  const detailOf = (entry: typeof entries.$inferSelect) => {
    const id = entry.id
    return {
      entry,
      location:
        db
          .select()
          .from(entryLocations)
          .where(and(eq(entryLocations.entryId, id), eq(entryLocations.userId, userId)))
          .get() ?? null,
      weather:
        db
          .select()
          .from(entryWeather)
          .where(and(eq(entryWeather.entryId, id), eq(entryWeather.userId, userId)))
          .get() ?? null,
      tags: db
        .select({ name: tags.name })
        .from(entryTags)
        .innerJoin(tags, eq(tags.id, entryTags.tagId))
        .where(and(eq(entryTags.entryId, id), eq(tags.userId, userId), isNull(tags.deletedAt)))
        .orderBy(sql`lower(${tags.name})`)
        .all()
        .map((t) => t.name),
      photos: db
        .select()
        .from(photos)
        .where(and(eq(photos.entryId, id), eq(photos.userId, userId), isNull(photos.deletedAt)))
        .orderBy(photos.position)
        .all(),
      attachments: db
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.entryId, id),
            eq(attachments.userId, userId),
            isNull(attachments.deletedAt),
          ),
        )
        .orderBy(attachments.position)
        .all(),
    }
  }

  return {
    /** Timeline page, newest first. `before` is an entry created_at cursor. */
    /**
     * Places used by this user's entries, most recently written about first, one per distinct
     * place (its Google id, else its coordinates to ~10 m). Unnamed coordinates-only places are left
     * out: they are no use as a shortcut.
     */
    recentPlaces(limit = 8): Location[] {
      const rows = db
        .select({ l: entryLocations })
        .from(entryLocations)
        .innerJoin(entries, eq(entries.id, entryLocations.entryId))
        .where(
          and(
            eq(entryLocations.userId, userId),
            eq(entries.userId, userId),
            isNull(entries.deletedAt),
          ),
        )
        .orderBy(desc(entries.createdAt))
        .limit(500)
        .all()
      const seen = new Set<string>()
      const out: Location[] = []
      for (const { l } of rows) {
        if (!l.placeName && !l.locality) continue
        const key = l.googlePlaceId ?? `${l.latitude.toFixed(4)},${l.longitude.toFixed(4)}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          latitude: l.latitude,
          longitude: l.longitude,
          placeName: l.placeName,
          locality: l.locality,
          region: l.region,
          country: l.country,
          address: l.address,
          googlePlaceId: l.googlePlaceId,
        })
        if (out.length >= limit) break
      }
      return out
    },

    /**
     * Every entry with a place, for the map, with the same journal rules as the timeline: archived
     * journals are left out unless `includeArchived` or `journalId` names one.
     */
    mapPoints({
      journalId,
      includeArchived = false,
    }: { journalId?: string; includeArchived?: boolean } = {}): MapData {
      const journalJoin = and(
        eq(journals.id, entries.journalId),
        eq(journals.userId, userId),
        isNull(journals.deletedAt),
      )
      const scope = and(
        eq(entries.userId, userId),
        isNull(entries.deletedAt),
        journalId ? eq(entries.journalId, journalId) : undefined,
        journalId || includeArchived ? undefined : isNull(journals.archivedAt),
      )
      const total =
        db
          .select({ n: sql<number>`count(*)` })
          .from(entries)
          .innerJoin(journals, journalJoin)
          .where(scope)
          .get()?.n ?? 0
      // Only the start of each text: a pin needs a title or a short excerpt, and the whole journal's
      // text would otherwise sit in memory at once.
      const rows = db
        .select({
          id: entries.id,
          journalId: entries.journalId,
          createdAt: entries.createdAt,
          timezone: entries.timezone,
          head: sql<string>`substr(${entries.bodyMd}, 1, ${MAP_HEAD_CHARS})`,
          cut: sql<number>`length(${entries.bodyMd}) > ${MAP_HEAD_CHARS}`,
          latitude: entryLocations.latitude,
          longitude: entryLocations.longitude,
          placeName: entryLocations.placeName,
        })
        .from(entries)
        .innerJoin(journals, journalJoin)
        .innerJoin(
          entryLocations,
          and(eq(entryLocations.entryId, entries.id), eq(entryLocations.userId, userId)),
        )
        .where(scope)
        .orderBy(desc(entries.createdAt))
        .all()
      return {
        total,
        points: rows.map((r) => {
          // Whole lines only, so a cut can't turn the last one into something else. Rarely the
          // start isn't enough (no title, and the excerpt didn't fill up): then read it all.
          let { title, excerpt } = summarize(
            r.cut ? r.head.slice(0, r.head.lastIndexOf('\n') + 1) : r.head,
          )
          if (r.cut && !title && !excerpt.endsWith('…')) {
            const full = db.select({ b: entries.bodyMd }).from(entries).where(mine(r.id)).get()
            ;({ title, excerpt } = summarize(full?.b ?? ''))
          }
          return {
            id: r.id,
            journalId: r.journalId,
            latitude: r.latitude,
            longitude: r.longitude,
            createdAt: r.createdAt,
            timezone: r.timezone,
            title: title || excerpt,
            placeName: r.placeName,
          }
        }),
      }
    },

    /**
     * Timeline cards, pinned first, then newest first. Archived journals are left out unless `includeArchived`, or
     * unless `journalId` names one explicitly (browsing the Archived section).
     */
    timeline({
      journalId,
      cursor,
      limit = 50,
      includeArchived = false,
      tag,
    }: {
      journalId?: string
      cursor?: string
      limit?: number
      includeArchived?: boolean
      /** Only entries carrying this tag (matched ignoring case). */
      tag?: string
    } = {}): { items: TimelineItem[]; nextCursor: string | null } {
      const after = cursor ? decodeCursor(cursor) : null
      if (cursor && !after) throw new Error('bad cursor')
      let tagged: ReturnType<typeof inArray> | undefined
      if (tag !== undefined) {
        const tagId = findTagId(db, userId, tag)
        if (!tagId) return { items: [], nextCursor: null }
        tagged = inArray(
          entries.id,
          db
            .select({ id: entryTags.entryId })
            .from(entryTags)
            .where(and(eq(entryTags.tagId, tagId), eq(entryTags.userId, userId))),
        )
      }

      const rows = db
        .select({ e: entries })
        .from(entries)
        .innerJoin(
          journals,
          and(
            eq(journals.id, entries.journalId),
            eq(journals.userId, userId),
            isNull(journals.deletedAt),
          ),
        )
        .where(
          and(
            eq(entries.userId, userId),
            isNull(entries.deletedAt),
            journalId ? eq(entries.journalId, journalId) : undefined,
            journalId || includeArchived ? undefined : isNull(journals.archivedAt),
            tagged,
            after
              ? after.pinned
                ? or(
                    eq(entries.pinned, false),
                    and(
                      eq(entries.pinned, true),
                      or(
                        lt(entries.createdAt, after.createdAt),
                        and(eq(entries.createdAt, after.createdAt), lt(entries.id, after.id)),
                      ),
                    ),
                  )
                : and(
                    eq(entries.pinned, false),
                    or(
                      lt(entries.createdAt, after.createdAt),
                      and(eq(entries.createdAt, after.createdAt), lt(entries.id, after.id)),
                    ),
                  )
              : undefined,
          ),
        )
        .orderBy(desc(entries.pinned), desc(entries.createdAt), desc(entries.id))
        .limit(limit + 1)
        .all()
        .map((r) => r.e)

      const page = rows.slice(0, limit)
      const items = entryCards(db, userId, page)
      const last = page[page.length - 1]
      return {
        items,
        nextCursor:
          rows.length > limit && last ? encodeCursor(last.createdAt, last.id, last.pinned) : null,
      }
    },

    get(id: string) {
      return db.select().from(entries).where(mine(id)).get()
    },

    /** The entry with its location, weather, tag names, photos and attachments (in order). */
    detail(id: string) {
      const entry = db.select().from(entries).where(mine(id)).get()
      return entry && detailOf(entry)
    },

    /**
     * The same, for an entry row the caller has already checked is theirs (and may be in the trash,
     * whose media rows stay live). Every child query still filters by `userId`.
     */
    detailOf,

    /**
     * Idempotent on a client-supplied id: replaying the same create returns the existing entry
     * instead of failing, so a retry after a dropped connection is safe (SPEC 4d).
     */
    create(input: EntryInput, now = Date.now()) {
      return db.transaction((tx) => {
        if (input.id) {
          const replay = replayOrFree(
            tx.select().from(entries).where(eq(entries.id, input.id)).get(),
            userId,
          )
          if (replay) return replay
        }
        assertWritableJournal(tx, input.journalId)
        const row = {
          id: input.id ?? uuidv7(now),
          userId,
          journalId: input.journalId,
          bodyMd: input.bodyMd ?? '',
          createdAt: input.createdAt ?? now,
          modifiedAt: now,
          timezone: input.timezone,
          starred: input.starred ?? false,
          pinned: input.pinned ?? false,
          allDay: input.allDay ?? false,
          moodKey: input.mood ?? null,
          updatedAt: now,
          rev: nextRev(tx, userId),
        }
        tx.insert(entries).values(row).run()
        if (input.location) writeLocation(tx, userId, row.id, input.location)
        if (input.weather) writeWeather(tx, userId, row.id, input.weather)
        if (input.tags?.length) writeEntryTags(tx, userId, row.id, input.tags, now)
        syncEntryMedia(tx, userId, row.id, '', row.bodyMd, now)
        indexEntry(tx, row.id, { fresh: true })
        return tx.select().from(entries).where(eq(entries.id, row.id)).get()!
      })
    },

    /**
     * Returns undefined if the entry isn't this user's. With `baseRev`, refuses to overwrite a
     * newer version (SPEC 4d); the conflict-copy flow comes with sync in Phase 7.
     */
    update(
      id: string,
      patch: EntryPatch,
      opts: { baseRev?: number; removeMediaIds?: string[] } = {},
      now = Date.now(),
    ) {
      return db.transaction((tx) => {
        const current = tx.select().from(entries).where(mine(id)).get()
        if (!current) return undefined
        if (opts.baseRev !== undefined && opts.baseRev !== current.rev) {
          throw new RevConflictError(current.rev, opts.baseRev)
        }
        assertWritableJournal(tx, current.journalId)
        if (patch.journalId !== undefined && patch.journalId !== current.journalId) {
          assertWritableJournal(tx, patch.journalId)
        }
        const { location, weather, tags: tagNames, mood, ...fields } = patch
        const updated = tx
          .update(entries)
          .set({
            ...fields,
            ...(mood !== undefined && { moodKey: mood }),
            modifiedAt: now,
            updatedAt: now,
            rev: nextRev(tx, userId),
          })
          .where(mine(id))
          .returning()
          .get()
        // Only the text is searched; the journal, star and dates are read from the entry itself.
        removeMedia(tx, userId, id, opts.removeMediaIds ?? [], updated?.bodyMd ?? '', now)
        if (location !== undefined) writeLocation(tx, userId, id, location)
        if (weather !== undefined) writeWeather(tx, userId, id, weather)
        if (tagNames !== undefined) writeEntryTags(tx, userId, id, tagNames, now)
        if (patch.bodyMd !== undefined) {
          syncEntryMedia(tx, userId, id, current.bodyMd, patch.bodyMd, now)
        }
        // The place and tags are searchable too, so re-index when any of them changed.
        if (patch.bodyMd !== undefined || location !== undefined || tagNames !== undefined) {
          indexEntry(tx, id)
        }
        return updated
      })
    },

    /**
     * The background weather fetch's write. It never replaces Day One's or hand-entered weather (SPEC
     * 4c), skips archived journals, and does not bump the entry's rev, so a fetch landing after a
     * save can't make the editor's baseRev stale. (Edits made by the user go through update().)
     */
    setFetchedWeather(id: string, w: NewWeather, now = Date.now()): 'written' | 'kept' | undefined {
      return db.transaction((tx) => {
        const entry = tx.select().from(entries).where(mine(id)).get()
        if (!entry) return undefined
        const existing = tx
          .select({ source: entryWeather.source })
          .from(entryWeather)
          .where(eq(entryWeather.entryId, id))
          .get()
        if (existing && !isAutoWeather(existing.source)) return 'kept'
        const j = tx
          .select({ a: journals.archivedAt })
          .from(journals)
          .where(eq(journals.id, entry.journalId))
          .get()
        if (j?.a) return 'kept'
        tx.delete(entryWeather).where(eq(entryWeather.entryId, id)).run()
        tx.insert(entryWeather)
          .values({ ...w, fetchedAt: w.fetchedAt ?? now, entryId: id, userId })
          .run()
        // Not `rev` (see above); the sync feed picks this up through weather_rev.
        tx.update(entries)
          .set({ weatherRev: nextRev(tx, userId) })
          .where(mine(id))
          .run()
        return 'written'
      })
    },

    softDelete(id: string, now = Date.now()) {
      return db.transaction((tx) => {
        const current = tx.select().from(entries).where(mine(id)).get()
        if (!current) return false
        assertWritableJournal(tx, current.journalId)
        tx.update(entries)
          .set({ deletedAt: now, updatedAt: now, rev: nextRev(tx, userId) })
          .where(mine(id))
          .run()
        removeFromIndex(tx, id)
        return true
      })
    },
  }
}

export type EntryRepo = ReturnType<typeof entryRepo>
