import {
  dayInRange,
  THUMBS_PER_CARD,
  decodeCursor,
  encodeCursor,
  summarize,
  tagKey,
  type EntryDetail,
  type SearchMatches,
  type SearchPage,
  type TagCount,
  type Journal,
  type Photo,
  type TimelineItem,
  readMood,
} from '@cairn/shared'
import { matchEntry, parseQuery } from './localSearch.ts'
import { localDb, outboxKey, type LocalDb, type LocalEntry } from './localDb.ts'

// Answers a few GETs from the local copy (Phase 7.4d), in the exact shapes the server sends, so
// no screen needs to know whether it is reading the server or the device. `api()` asks here when
// the server can't be reached, or when the service worker could only offer an older cached reply.
// `undefined` means "can't answer": the caller keeps whatever it had.

const LIST_MAX = 100

const toPhoto = (p: {
  id: string
  position: number
  width: number | null
  height: number | null
  takenAt: number | null
  latitude: number | null
  longitude: number | null
}): Photo => ({
  id: p.id,
  position: p.position,
  width: p.width,
  height: p.height,
  takenAt: p.takenAt,
  latitude: p.latitude,
  longitude: p.longitude,
})

async function detail(db: LocalDb, id: string): Promise<EntryDetail | undefined> {
  const e = await db.entries.get(id)
  if (!e) return undefined
  const photos = (await db.photos.where('entryId').equals(id).toArray())
    .sort((a, b) => a.position - b.position)
    .map(toPhoto)
  const attachments = (await db.attachments.where('entryId').equals(id).toArray())
    .sort((a, b) => a.position - b.position)
    .map(({ id, kind, position, filename, mime, bytes }) => ({
      id,
      kind,
      position,
      filename,
      mime,
      bytes,
    }))
  return {
    entry: e.entry,
    location: e.location,
    weather: e.weather,
    tags: e.tags,
    photos,
    attachments,
  }
}

/** Timeline cards for entries of the local copy (photos and files looked up in one go). */
async function cardsOf(db: LocalDb, page: LocalEntry[]): Promise<TimelineItem[]> {
  const ids = page.map((e) => e.id)
  const photoRows = await db.photos.where('entryId').anyOf(ids).toArray()
  const withFiles = new Set(
    (await db.attachments.where('entryId').anyOf(ids).toArray()).map((a) => a.entryId),
  )
  return page.map((e): TimelineItem => {
    const ps = photoRows.filter((p) => p.entryId === e.id).sort((a, b) => a.position - b.position)
    return {
      id: e.id,
      journalId: e.journalId,
      createdAt: e.createdAt,
      timezone: e.entry.timezone,
      starred: e.entry.starred,
      pinned: e.entry.pinned,
      allDay: e.entry.allDay,
      mood: readMood(e.entry.mood),
      ...summarize(e.entry.bodyMd),
      photoCount: ps.length,
      photos: ps.slice(0, THUMBS_PER_CARD).map(toPhoto),
      hasAttachments: withFiles.has(e.id),
      placeName: e.location?.placeName ?? null,
      weather: e.weather ? { condition: e.weather.condition, tempC: e.weather.tempC } : null,
    }
  })
}

/** Timeline cards from the local copy; only journals kept on this device have any. */
async function timeline(
  db: LocalDb,
  q: URLSearchParams,
): Promise<{ items: TimelineItem[]; nextCursor: string | null } | undefined> {
  const journalId = q.get('journalId') || undefined
  const includeArchived = q.get('includeArchived') === 'true' || q.get('includeArchived') === '1'
  const limit = Math.min(Number(q.get('limit')) || 50, LIST_MAX)
  const cursor = q.get('cursor')
  const tag = q.get('tag') ? tagKey(q.get('tag')!) : null
  const after = cursor ? decodeCursor(cursor) : null
  if (cursor && !after) return undefined

  const kept = new Set((await db.meta.get('offline'))?.value as string[] | undefined)
  if (journalId && !kept.has(journalId)) {
    // A journal created offline isn't on the device yet, but its waiting entries are: an empty
    // page for the overlay (lib/outbox.ts) to add them to.
    const waiting = await db.outbox.where('entryId').equals(outboxKey('journal', journalId)).first()
    return waiting ? { items: [], nextCursor: null } : undefined
  }
  if (kept.size === 0) return undefined
  const archived = new Set(
    (await db.journals.toArray()).filter((j) => j.archivedAt).map((j) => j.id),
  )

  const inScope = (e: LocalEntry) =>
    kept.has(e.journalId) &&
    (!journalId || e.journalId === journalId) &&
    (!!journalId || includeArchived || !archived.has(e.journalId)) &&
    (!tag || e.tags.some((t) => tagKey(t) === tag))
  const olderThan = (e: LocalEntry) =>
    !after || e.createdAt < after.createdAt || (e.createdAt === after.createdAt && e.id < after.id)

  // Pinned first (the same order as the server), then the rest newest first. Pins are few, so
  // they are scanned out of the copy; the rest walk the createdAt index and stop after one page
  // (and one more, to know if there is a next): the whole copy is never loaded.
  const pinned =
    !after || after.pinned
      ? (
          await db.entries.filter((e) => e.entry.pinned && inScope(e) && olderThan(e)).toArray()
        ).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
      : []
  const rows = pinned.slice(0, limit + 1)
  if (rows.length <= limit) {
    const restAfter = after && !after.pinned
    const base = restAfter
      ? db.entries.where('createdAt').belowOrEqual(after.createdAt)
      : db.entries.orderBy('createdAt')
    rows.push(
      ...(await base
        .reverse()
        .filter((e) => !e.entry.pinned && inScope(e) && (!restAfter || olderThan(e)))
        .limit(limit + 1 - rows.length)
        .toArray()),
    )
  }
  const page = rows.slice(0, limit)

  const items = await cardsOf(db, page)
  const last = page[page.length - 1]
  return {
    items,
    nextCursor:
      rows.length > limit && last ? encodeCursor(last.createdAt, last.id, last.entry.pinned) : null,
  }
}

const truthy = (v: string | null) => v === 'true' || v === '1'

/**
 * GET /search over the journals kept on this device: newest first (a relevance sort is answered
 * newest first too), exact word forms (lib/localSearch.ts). Undefined while nothing is kept.
 */
async function search(db: LocalDb, q: URLSearchParams): Promise<SearchPage | undefined> {
  const kept = new Set((await db.meta.get('offline'))?.value as string[] | undefined)
  if (kept.size === 0) return undefined
  const terms = parseQuery(q.get('q') ?? '')
  const journalId = q.get('journalId') || undefined
  const starred = truthy(q.get('starred'))
  const attachments = truthy(q.get('attachments'))
  const tag = q.get('tag') ? tagKey(q.get('tag')!) : null
  const mood = q.get('mood') || null
  const from = q.get('from') || undefined
  const to = q.get('to') || undefined
  const includeArchived = truthy(q.get('includeArchived'))
  const limit = Math.min(Number(q.get('limit')) || 30, LIST_MAX)
  const cursor = q.get('cursor')
  const offset = cursor ? Number(/^o(\d{1,7})$/.exec(cursor)?.[1] ?? NaN) : 0
  if (Number.isNaN(offset)) return undefined
  // Like the server: with no words, only a filter makes it a list.
  if (terms.length === 0 && !starred && !attachments && !tag && !mood && !from && !to) {
    return { items: [], nextCursor: null }
  }

  const archived = new Set(
    (await db.journals.toArray()).filter((j) => j.archivedAt).map((j) => j.id),
  )
  const withFiles = attachments
    ? new Set((await db.attachments.toArray()).map((a) => a.entryId))
    : null
  const searchable = (e: LocalEntry) => ({
    bodyMd: e.entry.bodyMd,
    placeName: e.location?.placeName ?? null,
    tags: e.tags,
  })
  const hits = await db.entries
    .orderBy('createdAt')
    .reverse()
    .filter(
      (e) =>
        kept.has(e.journalId) &&
        (!journalId || e.journalId === journalId) &&
        (!!journalId || includeArchived || !archived.has(e.journalId)) &&
        (!starred || e.entry.starred) &&
        (!withFiles || withFiles.has(e.id)) &&
        (!tag || e.tags.some((t) => tagKey(t) === tag)) &&
        (!mood || e.entry.mood === mood) &&
        dayInRange(e.createdAt, e.entry.timezone, from, to) &&
        (terms.length === 0 || matchEntry(searchable(e), terms) !== null),
    )
    .offset(offset)
    .limit(limit + 1)
    .toArray()
  const page = hits.slice(0, limit)
  const cards = await cardsOf(db, page)
  return {
    items: cards.map((c, i) => {
      const m = terms.length ? matchEntry(searchable(page[i]!), terms) : null
      return {
        ...c,
        snippet: m?.snippet ?? '',
        titleMarked: m?.titleMarked ?? '',
        snippetField: m?.snippetField ?? 'body',
      }
    }),
    nextCursor: hits.length > limit ? `o${offset + limit}` : null,
  }
}

/** GET /search/matches: the words of one kept entry that the query matched. */
async function searchMatches(db: LocalDb, q: URLSearchParams): Promise<SearchMatches | undefined> {
  const e = await db.entries.get(q.get('entryId') ?? '')
  if (!e) return undefined
  const terms = parseQuery(q.get('q') ?? '')
  const m = terms.length
    ? matchEntry(
        { bodyMd: e.entry.bodyMd, placeName: e.location?.placeName ?? null, tags: e.tags },
        terms,
      )
    : null
  return { words: m?.words.slice(0, 40) ?? [] }
}

async function journals(db: LocalDb): Promise<Journal[] | undefined> {
  const all = await db.journals.toArray()
  if (all.length === 0) return undefined
  return Promise.all(
    all
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
      .map(async (j) => ({
        ...j,
        entryCount: await db.entries.where('journalId').equals(j.id).count(),
      })),
  )
}

/** The tags of the entries kept on this device, with counts, as GET /tags sends them. */
async function tagCounts(db: LocalDb): Promise<{ tags: TagCount[] } | undefined> {
  const kept = new Set((await db.meta.get('offline'))?.value as string[] | undefined)
  if (kept.size === 0) return undefined
  const byKey = new Map<string, TagCount>()
  await db.entries
    .filter((e) => kept.has(e.journalId))
    .each((e) => {
      for (const name of e.tags) {
        const hit = byKey.get(tagKey(name))
        if (hit) hit.count++
        else byKey.set(tagKey(name), { name, count: 1 })
      }
    })
  return {
    tags: [...byKey.values()].sort(
      (a, b) => b.count - a.count || tagKey(a.name).localeCompare(tagKey(b.name)),
    ),
  }
}

/**
 * `path` is an API path without the `/api` prefix (query string included). `cachedReplyExists`
 * says the service worker already has an older answer to this request: for the journal list that
 * answer is better (the local copy only counts the journals it holds), so it is left alone.
 */
export async function localRead(
  userId: string | null,
  path: string,
  cachedReplyExists: boolean,
): Promise<unknown> {
  if (!userId) return undefined
  try {
    const db = localDb(userId)
    const url = new URL(path, 'http://local')
    const m = /^\/entries\/([^/]+)$/.exec(url.pathname)
    if (m && m[1] !== 'map' && m[1] !== 'recent-places') return await detail(db, m[1]!)
    if (url.pathname === '/entries') return await timeline(db, url.searchParams)
    if (url.pathname === '/tags') return await tagCounts(db)
    if (url.pathname === '/search') return await search(db, url.searchParams)
    if (url.pathname === '/search/matches') return await searchMatches(db, url.searchParams)
    if (url.pathname === '/journals' && !cachedReplyExists) return await journals(db)
  } catch {
    // A blocked or broken database is the same as having no copy.
  }
  return undefined
}
