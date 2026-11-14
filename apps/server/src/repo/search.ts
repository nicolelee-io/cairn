import { and, eq, inArray, isNull } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import {
  dayInRange,
  dayWindowUtc,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  type MoodKey,
  type SearchPage,
  type SearchSort,
} from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { entries } from '../db/schema.ts'
import { buildMatch } from '../search/match.ts'
import { entryCards } from './entries.ts'
import { findTagId } from './tags.ts'

/** Offset into the result list: results are re-ranked on every request, so a keyset won't do. */
const encodeCursor = (offset: number) => `o${offset}`
function decodeCursor(cursor: string): number {
  const m = /^o(\d{1,7})$/.exec(cursor)
  if (!m) throw new Error('bad cursor')
  return Number(m[1])
}

const MARKED = new RegExp(`${SNIPPET_OPEN}([^${SNIPPET_CLOSE}]*)${SNIPPET_CLOSE}`, 'gu')
const MAX_WORDS = 40

export interface SearchOptions {
  q: string
  sort?: SearchSort
  journalId?: string
  starred?: boolean
  /** Only entries with a PDF, video or audio file. */
  attachments?: boolean
  /** Only entries carrying this tag (matched ignoring case). */
  tag?: string
  /** Only entries with this mood. */
  mood?: MoodKey
  /** Only entries written on or after / before this day ('YYYY-MM-DD'), in each entry's own timezone. */
  from?: string
  to?: string
  /** Archived journals are left out unless this is set or `journalId` names one. */
  includeArchived?: boolean
  cursor?: string
  limit?: number
}

/** Full-text search over this user's live entries. Every query is filtered by `userId`. */
export function searchRepo(db: Db, userId: string) {
  return {
    search({
      q,
      sort = 'newest',
      journalId,
      starred = false,
      attachments = false,
      tag,
      mood,
      from,
      to,
      includeArchived = false,
      cursor,
      limit = 30,
    }: SearchOptions): SearchPage {
      const match = buildMatch(q)
      // No words but Starred, Attachments or a tag on: every such entry, newest first, with
      // nothing to highlight.
      if (!match && !starred && !attachments && tag === undefined && !mood && !from && !to) {
        return { items: [], nextCursor: null }
      }
      const tagId = tag === undefined ? undefined : (findTagId(db, userId, tag) ?? null)
      if (tagId === null) return { items: [], nextCursor: null } // no such tag, so no entry has it
      const offset = cursor ? decodeCursor(cursor) : 0

      // The FTS query is materialized first: snippet(), highlight() and bm25() only work while the
      // index itself is being read, not after the outer query has joined or re-sorted it. Columns:
      // 0 entry_id, 1 user_id, 2 title, 3 body, 4 place, 5 tags. A title hit counts most.
      type Hit = {
        id: string
        titleMarked: string
        body: string
        tags: string
        place: string
        createdAt: number
        timezone: string
      }
      // SQLite can't read a day in an entry's own zone, so SQL only narrows to the range widened by
      // the largest UTC offset, and the days are checked in code. That breaks LIMIT/OFFSET, so a
      // date range pages in code too (it reads at most MAX_RANGED candidates).
      const ranged = !!(from || to)
      const MAX_RANGED = 5000
      const window = {
        from: from ? dayWindowUtc(from).from : undefined,
        to: to ? dayWindowUtc(to).to : undefined,
      }
      const filters = sql`
        WHERE e.user_id = ${userId} AND e.deleted_at IS NULL
          AND j.user_id = ${userId} AND j.deleted_at IS NULL
          ${journalId ? sql`AND e.journal_id = ${journalId}` : sql``}
          ${journalId || includeArchived ? sql`` : sql`AND j.archived_at IS NULL`}
          ${starred ? sql`AND e.starred = 1` : sql``}
          ${mood ? sql`AND e.mood_key = ${mood}` : sql``}
          ${window.from !== undefined ? sql`AND e.created_at >= ${window.from}` : sql``}
          ${window.to !== undefined ? sql`AND e.created_at < ${window.to}` : sql``}
          ${
            tagId
              ? sql`AND EXISTS (SELECT 1 FROM entry_tag et WHERE et.entry_id = e.id
                  AND et.tag_id = ${tagId} AND et.user_id = ${userId})`
              : sql``
          }
          ${
            attachments
              ? sql`AND EXISTS (SELECT 1 FROM attachment a WHERE a.entry_id = e.id
                  AND a.user_id = ${userId} AND a.deleted_at IS NULL)`
              : sql``
          }`
      const hits: Hit[] = match
        ? db.all<Hit>(sql`
        WITH s AS MATERIALIZED (
          SELECT entry_id,
                 highlight(entry_fts, 2, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE}) AS title_marked,
                 snippet(entry_fts, 3, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE}, '…', 24) AS body_snippet,
                 snippet(entry_fts, 4, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE}, '…', 24) AS place_snippet,
                 snippet(entry_fts, 5, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE}, '…', 24) AS tags_snippet,
                 bm25(entry_fts, 0, 0, 5.0, 1.0, 2.0, 3.0) AS rank
          FROM entry_fts
          WHERE entry_fts MATCH ${match} AND user_id = ${userId}
        )
        SELECT e.id AS id, s.title_marked AS titleMarked, s.body_snippet AS body,
               s.tags_snippet AS tags, s.place_snippet AS place,
               e.created_at AS createdAt, e.timezone AS timezone
        FROM s
        JOIN entry e ON e.id = s.entry_id
        JOIN journal j ON j.id = e.journal_id
        ${filters}
        ORDER BY ${sort === 'relevance' ? sql`s.rank, e.created_at DESC, e.id DESC` : sql`e.created_at DESC, e.id DESC`}
        ${ranged ? sql`LIMIT ${MAX_RANGED}` : sql`LIMIT ${limit + 1} OFFSET ${offset}`}`)
        : db.all<Hit>(sql`
        SELECT e.id AS id, '' AS titleMarked, '' AS body, '' AS tags, '' AS place,
               e.created_at AS createdAt, e.timezone AS timezone
        FROM entry e
        JOIN journal j ON j.id = e.journal_id
        ${filters}
        ORDER BY e.created_at DESC, e.id DESC
        ${ranged ? sql`LIMIT ${MAX_RANGED}` : sql`LIMIT ${limit + 1} OFFSET ${offset}`}`)
      if (ranged) {
        const inRange = hits.filter((h) => dayInRange(h.createdAt, h.timezone, from, to))
        hits.splice(0, hits.length, ...inRange.slice(offset, offset + limit + 1))
      }

      const page = hits.slice(0, limit)
      const rows = page.length
        ? db
            .select()
            .from(entries)
            .where(
              and(
                inArray(
                  entries.id,
                  page.map((h) => h.id),
                ),
                eq(entries.userId, userId),
                isNull(entries.deletedAt),
              ),
            )
            .all()
        : []
      const byId = new Map(rows.map((r) => [r.id, r]))
      const ordered = page.flatMap((h) => byId.get(h.id) ?? [])
      const cards = entryCards(db, userId, ordered)
      // The text to show under the title: wherever the match is, body first. If only the title
      // matched, the body's start (no highlights) reads like a normal excerpt.
      const hit = (t: string) => t.includes(SNIPPET_OPEN)
      const shown = new Map(
        page.map((h) => {
          const from = (['body', 'tags', 'place'] as const).find((f) => hit(h[f])) ?? 'body'
          return [h.id, { snippet: h[from], snippetField: from, titleMarked: h.titleMarked }]
        }),
      )

      return {
        items: cards.map((c) => ({
          ...c,
          snippet: shown.get(c.id)?.snippet ?? '',
          titleMarked: shown.get(c.id)?.titleMarked ?? '',
          snippetField: shown.get(c.id)?.snippetField ?? 'body',
        })),
        nextCursor: hits.length > limit ? encodeCursor(offset + limit) : null,
      }
    },

    /**
     * The words of one entry that `q` matched (as they appear in the entry, so "walking" can
     * report "walked"), for highlighting while reading it. Empty if the entry isn't a match.
     */
    matchedWords(entryId: string, q: string): string[] {
      const match = buildMatch(q)
      if (!match) return []
      const row = db.get<{ marked: string }>(sql`
        SELECT highlight(entry_fts, 2, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE}) || ' ' ||
               highlight(entry_fts, 3, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE}) || ' ' ||
               highlight(entry_fts, 4, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE}) || ' ' ||
               highlight(entry_fts, 5, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE}) AS marked
        FROM entry_fts
        WHERE entry_fts MATCH ${match} AND user_id = ${userId} AND entry_id = ${entryId}
        LIMIT 1`)
      const words = new Set<string>()
      for (const m of row?.marked.matchAll(MARKED) ?? []) {
        for (const w of m[1]!.split(/[^\p{L}\p{N}]+/u)) if (w) words.add(w.toLowerCase())
      }
      return [...words].slice(0, MAX_WORDS)
    },
  }
}
