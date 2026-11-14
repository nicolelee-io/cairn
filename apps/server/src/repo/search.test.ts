import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { SNIPPET_CLOSE, SNIPPET_OPEN } from '@cairn/shared'
import { ensureSearchIndex } from '../search/index.ts'
import { addUser, memoryDb } from '../test-helpers.ts'
import { createRepos } from './index.ts'

type Repos = ReturnType<typeof createRepos>
let handle: ReturnType<typeof memoryDb>
let a: Repos
let b: Repos
let journal: string

const DAY = 86_400_000
const write = (
  body: string,
  extra: { createdAt?: number; starred?: boolean; journalId?: string } = {},
) => a.entries.create({ journalId: journal, bodyMd: body, timezone: 'UTC', ...extra })
const find = (
  q: string,
  o: Parameters<Repos['search']['search']>[0] extends infer T ? Partial<T> : never = {},
) => a.search.search({ q, ...o }).items.map((i) => i.id)

beforeEach(async () => {
  handle = memoryDb()
  const [ua, ub] = [await addUser(handle.db, 'a'), await addUser(handle.db, 'b')]
  a = createRepos(handle.db, ua.id)
  b = createRepos(handle.db, ub.id)
  journal = a.journals.create({ name: 'Main' }).id
})

describe('matching', () => {
  it('stems, matches prefixes and ignores accents', () => {
    const walk = write('I walked home through the park')
    const cafe = write('Coffee at the café')
    expect(find('walking')).toEqual([walk.id])
    expect(find('wal')).toEqual([walk.id]) // prefix while typing
    expect(find('cafe')).toEqual([cafe.id])
    expect(find('home park')).toEqual([walk.id]) // all words must match
    expect(find('home coffee')).toEqual([])
  })

  it('matches quoted phrases only in order', () => {
    const e = write('A slow morning walk by the river')
    write('A walk in the morning')
    expect(find('"morning walk"')).toEqual([e.id])
  })

  it('does not match image ids or link targets', () => {
    write('Look ![](photo:0192abcd-1111-7222-8333-444455556666) [here](https://example.com/zebra)')
    expect(find('0192abcd')).toEqual([])
    expect(find('zebra')).toEqual([])
    expect(find('here')).toHaveLength(1)
  })

  it('treats FTS syntax and stray characters as plain text, never an error', () => {
    write('hello world')
    for (const q of ['"', 'AND', 'OR hello', 'tags:foo', 'NEAR(', '*', 'hello"', '(((']) {
      expect(() => a.search.search({ q })).not.toThrow()
    }
    expect(find('***')).toEqual([])
  })

  it('marks matches in the body snippet, and keeps the title out of it', () => {
    write('# Sunday\n\nA long day, ending with a lovely sunset over the hills')
    const [hit] = a.search.search({ q: 'sunsets' }).items
    expect(hit?.snippet).toContain(`${SNIPPET_OPEN}sunset${SNIPPET_CLOSE}`)
    expect(hit?.snippet).not.toContain('Sunday')
    expect(hit?.titleMarked).toBe('Sunday') // no match in the title: nothing marked
  })

  it('marks a match in the title on the title, without repeating it in the snippet', () => {
    write('# Sunset walk\n\nWe went out after dinner and kept going')
    const [hit] = a.search.search({ q: 'sunset' }).items
    expect(hit?.titleMarked).toBe(`${SNIPPET_OPEN}Sunset${SNIPPET_CLOSE} walk`)
    expect(hit?.snippet).toBe('We went out after dinner and kept going') // the body's start, unmarked
  })

  it('ranks a title match above a body match', () => {
    const body = write('Rainy day\n\nI kept thinking about lighthouse stories')
    const title = write('Lighthouse\n\nA different day entirely')
    expect(find('lighthouse', { sort: 'relevance' })).toEqual([title.id, body.id])
  })

  it('reports the words of an entry that a search matched', () => {
    const e = write('# Trail\n\nWe walked the café loop twice')
    expect(a.search.matchedWords(e.id, 'walking cafe')).toEqual(['walked', 'café'])
    expect(a.search.matchedWords(e.id, 'zebra')).toEqual([])
    expect(a.search.matchedWords(e.id, '***')).toEqual([])
    // Not anyone else's entry.
    expect(b.search.matchedWords(e.id, 'walked')).toEqual([])
  })

  it('searches place names and tags too', () => {
    const j = a.journals.create({ name: 'Imported' }).id
    a.imports.importEntry({
      sourceId: 'D1',
      journalId: j,
      bodyMd: 'Just a walk',
      createdAt: 1,
      modifiedAt: 1,
      timezone: 'UTC',
      starred: false,
      pinned: false,
      allDay: false,
      creationDevice: null,
      sourceRaw: '{}',
      tags: ['hiking'],
      location: { latitude: 1, longitude: 2, placeName: 'Monument Canyon', region: 'Colorado' },
      weather: null,
      photos: [],
    })
    expect(find('hiking')).toHaveLength(1)
    expect(find('colorado')).toHaveLength(1)
    expect(find('monument')).toHaveLength(1)
  })
})

describe('keeping the index current', () => {
  it('follows edits and deletes', () => {
    const e = write('draft about apples')
    expect(find('apples')).toHaveLength(1)

    a.entries.update(e.id, { bodyMd: 'now about oranges' })
    expect(find('apples')).toEqual([])
    expect(find('oranges')).toEqual([e.id])

    a.entries.softDelete(e.id)
    expect(find('oranges')).toEqual([])
  })

  it('drops a deleted journal’s entries', () => {
    const j = a.journals.create({ name: 'Temp' }).id
    write('findable words', { journalId: j })
    expect(find('findable')).toHaveLength(1)
    a.journals.softDelete(j)
    expect(find('findable')).toEqual([])
  })

  it('keeps one index row per entry through edits, a VACUUM, delete and restore', () => {
    const rows = () => handle.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM entry_fts`)[0]!.n
    const e = write('first words')
    a.entries.update(e.id, { bodyMd: 'second words' })
    handle.sqlite.exec('VACUUM')
    a.entries.update(e.id, { bodyMd: 'third words' })
    expect(rows()).toBe(1)
    expect(find('third')).toEqual([e.id])
    expect(find('second')).toEqual([])
    a.entries.softDelete(e.id)
    expect(rows()).toBe(0)
    a.trash.restoreEntry(e.id)
    expect(find('third')).toEqual([e.id])
  })

  it('removes an entry’s row by rowid, not by scanning the index', () => {
    const plan = handle.sqlite
      .prepare(
        'EXPLAIN QUERY PLAN DELETE FROM entry_fts WHERE rowid = (SELECT fts_rowid FROM entry_fts_key WHERE entry_id = ?)',
      )
      .all('x') as { detail: string }[]
    const text = plan.map((p) => p.detail).join('\n')
    expect(text).toMatch(/entry_fts_key USING (COVERING )?INDEX/)
    // `0:=` is a rowid lookup; a scan of the unindexed entry_id column shows as `0:`.
    expect(text).toMatch(/VIRTUAL TABLE INDEX 0:=/)
  })

  it('rebuilds from the entries when the index is missing or out of date', () => {
    write('rebuild me')
    handle.db.run(sql`DELETE FROM entry_fts`)
    expect(find('rebuild')).toEqual([])

    expect(ensureSearchIndex(handle.db)).toBe(true)
    expect(find('rebuild')).toHaveLength(1)
    expect(ensureSearchIndex(handle.db)).toBe(false) // already current: no second rebuild
  })
})

describe('filters and order', () => {
  it('lists newest first by default and best match first on request', () => {
    const old = write('coffee coffee coffee', { createdAt: 1 * DAY })
    const recent = write('one long entry that mentions coffee only once among many other words', {
      createdAt: 9 * DAY,
    })
    expect(find('coffee')).toEqual([recent.id, old.id])
    expect(find('coffee', { sort: 'relevance' })).toEqual([old.id, recent.id])
  })

  it('filters by star and journal', () => {
    const other = a.journals.create({ name: 'Other' }).id
    const star = write('tea time', { starred: true })
    const plain = write('tea again')
    const elsewhere = write('tea abroad', { journalId: other })
    expect(find('tea', { starred: true })).toEqual([star.id])
    expect(find('tea', { journalId: other })).toEqual([elsewhere.id])
    expect(new Set(find('tea'))).toEqual(new Set([star.id, plain.id, elsewhere.id]))
  })

  it('lists every starred entry when there are no words, and nothing otherwise', () => {
    const old = write('first', { starred: true, createdAt: 1 * DAY })
    const recent = write('second', { starred: true, createdAt: 5 * DAY })
    write('unstarred')
    expect(find('', { starred: true })).toEqual([recent.id, old.id])
    expect(find('')).toEqual([])
    expect(b.search.search({ q: '', starred: true }).items).toEqual([])
  })

  it('filters to entries with attachments (not photos), with or without words', () => {
    const file = (id: string) =>
      a.attachments.add({
        id,
        kind: 'pdf',
        path: `attachments/u/${id}.pdf`,
        mime: 'application/pdf',
        bytes: 1,
        sha256: id,
        filename: `${id}.pdf`,
      })
    file('f1')
    file('f2')
    const withFile = write('receipt ![r](attachment:f1)', { createdAt: 2 * DAY })
    const photoOnly = write('receipt ![](photo:p1)', { createdAt: 3 * DAY })
    const removed = write('receipt ![r](attachment:f2)', { createdAt: 4 * DAY })
    a.attachments.remove('f2')
    expect(find('receipt', { attachments: true })).toEqual([withFile.id])
    expect(find('', { attachments: true })).toEqual([withFile.id])
    expect(new Set(find('receipt'))).toEqual(new Set([withFile.id, photoOnly.id, removed.id]))
    expect(b.search.search({ q: '', attachments: true }).items).toEqual([])
    // The card says so too.
    const cards = a.search.search({ q: 'receipt' }).items
    expect(cards.find((c) => c.id === withFile.id)?.hasAttachments).toBe(true)
    expect(cards.find((c) => c.id === removed.id)?.hasAttachments).toBe(false)
  })

  it('leaves archived journals out unless asked, or named', () => {
    const old = a.journals.create({ name: 'Old' }).id
    const kept = write('lantern light')
    const archived = write('lantern glow', { journalId: old })
    a.journals.update(old, { archived: true })

    expect(find('lantern')).toEqual([kept.id])
    expect(new Set(find('lantern', { includeArchived: true }))).toEqual(
      new Set([kept.id, archived.id]),
    )
    expect(find('lantern', { journalId: old })).toEqual([archived.id])
  })

  it('pages through results', () => {
    const ids = [1, 2, 3, 4, 5].map((n) => write('pebble', { createdAt: n * DAY }).id).reverse()
    const first = a.search.search({ q: 'pebble', limit: 2 })
    expect(first.items.map((i) => i.id)).toEqual(ids.slice(0, 2))
    const second = a.search.search({ q: 'pebble', limit: 2, cursor: first.nextCursor! })
    expect(second.items.map((i) => i.id)).toEqual(ids.slice(2, 4))
    const third = a.search.search({ q: 'pebble', limit: 2, cursor: second.nextCursor! })
    expect(third.items.map((i) => i.id)).toEqual(ids.slice(4))
    expect(third.nextCursor).toBeNull()
  })

  it('rejects a malformed cursor', () => {
    expect(() => a.search.search({ q: 'x', cursor: 'nope' })).toThrow()
  })

  it('returns cards, with title and excerpt, not raw rows', () => {
    write('# Morning\n\nThe fog lifted slowly')
    const [hit] = a.search.search({ q: 'fog' }).items
    expect(hit).toMatchObject({ title: 'Morning', excerpt: 'The fog lifted slowly' })
    expect(hit).not.toHaveProperty('bodyMd')
  })
})

describe('user scoping', () => {
  it("B cannot find A's entries, even with the same words", () => {
    write('a very private secret')
    const bJournal = b.journals.create({ name: 'B' }).id
    const mine = b.entries.create({ journalId: bJournal, bodyMd: 'my own secret', timezone: 'UTC' })
    expect(find('secret')).toHaveLength(1)
    expect(b.search.search({ q: 'secret' }).items.map((i) => i.id)).toEqual([mine.id])
    expect(b.search.search({ q: 'private' }).items).toEqual([])
  })
})

describe('tag filter', () => {
  const tagged = (body: string, tags: string[], extra = {}) =>
    a.entries.create({ journalId: journal, bodyMd: body, timezone: 'UTC', tags, ...extra })

  it('lists every entry with the tag when no words are typed, ignoring case', () => {
    const e1 = tagged('walk one', ['Hiking'], { createdAt: 1000 })
    const e2 = tagged('walk two', ['hiking', 'food'], { createdAt: 2000 })
    tagged('walk three', ['food'])
    expect(find('', { tag: 'HIKING' })).toEqual([e2.id, e1.id])
    expect(find('', { tag: 'nope' })).toEqual([])
  })

  it('narrows a text search, and combines with the other filters', () => {
    const e1 = tagged('river walk', ['hiking'], { starred: true })
    tagged('river swim', ['food'])
    tagged('hill walk', ['hiking'])
    expect(find('river', { tag: 'hiking' })).toEqual([e1.id])
    expect(find('walk', { tag: 'hiking', starred: true })).toEqual([e1.id])
    expect(find('swim', { tag: 'hiking' })).toEqual([])
  })

  it('follows tag edits and does not see deleted entries', () => {
    const e = tagged('river walk', ['hiking'])
    a.entries.update(e.id, { tags: ['food'] })
    expect(find('', { tag: 'hiking' })).toEqual([])
    expect(find('', { tag: 'food' })).toEqual([e.id])
    a.entries.softDelete(e.id)
    expect(find('', { tag: 'food' })).toEqual([])
  })

  it('says which part of the entry a snippet is from', () => {
    tagged('plain text', ['kayaking'])
    const [byTag] = a.search.search({ q: 'kayaking' }).items
    expect(byTag?.snippetField).toBe('tags')
    tagged('kayaking all day', [])
    const [byBody] = a.search.search({ q: 'all day' }).items
    expect(byBody?.snippetField).toBe('body')
  })

  it("does not reach another user's tag", () => {
    tagged('mine', ['shared-name'])
    expect(b.search.search({ q: '', tag: 'shared-name' }).items).toEqual([])
  })
})

describe('mood and date filters', () => {
  const at = (
    iso: string,
    timezone: string,
    extra: { mood?: 'happy' | 'sad'; body?: string } = {},
  ) =>
    a.entries.create({
      journalId: journal,
      bodyMd: extra.body ?? 'walk',
      timezone,
      createdAt: Date.parse(iso),
      mood: extra.mood,
    })

  it('lists entries with a mood, with or without words, and never mixes users', () => {
    const happy = at('2026-03-01T12:00:00Z', 'UTC', { mood: 'happy' })
    at('2026-03-02T12:00:00Z', 'UTC', { mood: 'sad' })
    at('2026-03-03T12:00:00Z', 'UTC')
    b.entries.create({
      journalId: b.journals.create({ name: 'B' }).id,
      bodyMd: 'walk',
      timezone: 'UTC',
      mood: 'happy',
    })
    expect(find('', { mood: 'happy' })).toEqual([happy.id])
    expect(find('walk', { mood: 'happy' })).toEqual([happy.id])
    expect(find('nothing', { mood: 'happy' })).toEqual([])
  })

  it('reads the day range in each entry’s own timezone', () => {
    // Local 2026-03-01 in Denver (UTC-7), but already the 2nd in UTC.
    const denver = at('2026-03-02T03:00:00Z', 'America/Denver')
    // Local 2026-03-02 in Auckland (UTC+13), still the 1st in UTC.
    const auckland = at('2026-03-01T20:00:00Z', 'Pacific/Auckland')
    const first = find('', { from: '2026-03-01', to: '2026-03-01' })
    expect(first).toEqual([denver.id])
    expect(find('', { from: '2026-03-02', to: '2026-03-02' })).toEqual([auckland.id])
    expect(new Set(find('', { from: '2026-03-01' }))).toEqual(new Set([denver.id, auckland.id]))
    expect(find('', { to: '2026-02-28' })).toEqual([])
  })

  it('pages a date range and combines it with words and mood', () => {
    const ids = [1, 2, 3, 4, 5].map(
      (d) => at(`2026-04-0${d}T12:00:00Z`, 'UTC', { mood: d % 2 ? 'happy' : 'sad' }).id,
    )
    const p1 = a.search.search({ q: '', from: '2026-04-02', to: '2026-04-05', limit: 2 })
    expect(p1.items.map((i) => i.id)).toEqual([ids[4], ids[3]])
    const p2 = a.search.search({
      q: '',
      from: '2026-04-02',
      to: '2026-04-05',
      limit: 2,
      cursor: p1.nextCursor!,
    })
    expect(p2.items.map((i) => i.id)).toEqual([ids[2], ids[1]])
    expect(p2.nextCursor).toBeNull()
    expect(find('walk', { from: '2026-04-01', to: '2026-04-05', mood: 'happy' })).toEqual([
      ids[4],
      ids[2],
      ids[0],
    ])
  })
})
