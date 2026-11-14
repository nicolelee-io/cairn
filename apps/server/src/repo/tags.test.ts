import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, addUser, memoryDb } from '../test-helpers.ts'
import { createRepos } from './index.ts'
import { TagExistsError, TagNotFoundError } from './tags.ts'

let handle: ReturnType<typeof memoryDb>
let repos: ReturnType<typeof createRepos>
let j: string

beforeEach(async () => {
  handle = memoryDb()
  repos = createRepos(handle.db, (await addUser(handle.db, 'a')).id)
  j = repos.journals.create({ name: 'one' }).id
})

const make = (tags?: string[], createdAt = 1000) =>
  repos.entries.create({ journalId: j, timezone: 'UTC', bodyMd: 'x', createdAt, tags }).id
const tagsOf = (id: string) => repos.entries.detail(id)!.tags
const ftsTags = (id: string) =>
  (
    handle.sqlite.prepare('SELECT tags FROM entry_fts WHERE entry_id = ?').get(id) as {
      tags: string
    }
  ).tags

describe('entry tags', () => {
  it('sets tags on create and replaces them on update', () => {
    const id = make(['trip', 'food'])
    expect(tagsOf(id)).toEqual(['food', 'trip'])
    repos.entries.update(id, { tags: ['trip', 'rain'] })
    expect(tagsOf(id)).toEqual(['rain', 'trip'])
    repos.entries.update(id, { bodyMd: 'changed' })
    expect(tagsOf(id)).toEqual(['rain', 'trip']) // omitted = untouched
    repos.entries.update(id, { tags: [] })
    expect(tagsOf(id)).toEqual([])
  })

  it('matches names ignoring case and keeps the first spelling', () => {
    const a = make(['Travel'])
    const b = make(['travel', 'TRAVEL', 'Rain'])
    expect(tagsOf(b)).toEqual(['Rain', 'Travel'])
    expect(repos.tags.list()).toEqual([
      { name: 'Travel', count: 2 },
      { name: 'Rain', count: 1 },
    ])
    expect(a).not.toBe(b)
  })

  it('drops a tag nobody carries any more, so its spelling does not linger', () => {
    const id = make(['Travel'])
    repos.entries.update(id, { tags: [] })
    expect(repos.tags.list()).toEqual([])
    repos.entries.update(id, { tags: ['travel'] })
    expect(tagsOf(id)).toEqual(['travel'])
  })

  it('bumps the entry rev and re-indexes, so tags are searchable and sync', () => {
    const id = make()
    const rev = repos.entries.get(id)!.rev
    repos.entries.update(id, { tags: ['kayaking'] })
    expect(repos.entries.get(id)!.rev).toBeGreaterThan(rev)
    expect(ftsTags(id)).toBe('kayaking')
    expect(repos.search.search({ q: 'kayaking' }).items.map((i) => i.id)).toEqual([id])
    repos.entries.update(id, { tags: [] })
    expect(ftsTags(id)).toBe('')
  })
})

describe('tag list and filter', () => {
  it('counts live entries only, most used first', () => {
    make(['a', 'b'])
    make(['b'], 2000)
    const gone = make(['a', 'c'], 3000)
    repos.entries.softDelete(gone)
    expect(repos.tags.list()).toEqual([
      { name: 'b', count: 2 },
      { name: 'a', count: 1 },
    ])
  })

  it('filters the timeline by tag, ignoring case, with paging', () => {
    const e1 = make(['Trip'], 1000)
    make(['other'], 2000)
    const e3 = make(['trip'], 3000)
    const page = repos.entries.timeline({ tag: 'TRIP', limit: 1 })
    expect(page.items.map((i) => i.id)).toEqual([e3])
    const next = repos.entries.timeline({ tag: 'trip', limit: 1, cursor: page.nextCursor! })
    expect(next.items.map((i) => i.id)).toEqual([e1])
    expect(repos.entries.timeline({ tag: 'nope' }).items).toEqual([])
  })
})

describe('managing tags', () => {
  const rev = (id: string) => repos.entries.get(id)!.rev
  const found = (q: string) => repos.search.search({ q }).items.map((i) => i.id)

  it('renames a tag on every entry, bumping revs and the search index', () => {
    const e1 = make(['hiking'])
    const e2 = make(['hiking', 'food'], 2000)
    const untouched = make(['food'], 3000)
    const [r1, r2, r3] = [rev(e1), rev(e2), rev(untouched)]
    const modified = repos.entries.get(e1)!.modifiedAt
    expect(repos.tags.rename('HIKING', 'Trekking')).toEqual({ entries: 2 })
    expect(tagsOf(e1)).toEqual(['Trekking'])
    expect(tagsOf(e2)).toEqual(['food', 'Trekking'])
    expect(rev(e1)).toBeGreaterThan(r1)
    expect(rev(e2)).toBeGreaterThan(r2)
    expect(rev(untouched)).toBe(r3)
    expect(repos.entries.get(e1)!.modifiedAt).toBe(modified) // not an edit of the entry
    expect(found('trekking').sort()).toEqual([e1, e2].sort())
    expect(found('hiking')).toEqual([])
    expect(repos.tags.list().map((t) => t.name)).toEqual(['food', 'Trekking'])
  })

  it("lets a tag change its capitalisation, but refuses another tag's name", () => {
    const e = make(['food', 'hiking'])
    repos.tags.rename('food', 'Food')
    expect(tagsOf(e)).toEqual(['Food', 'hiking'])
    expect(() => repos.tags.rename('hiking', 'FOOD')).toThrow(TagExistsError)
    expect(() => repos.tags.rename('nope', 'x')).toThrow(TagNotFoundError)
    expect(tagsOf(e)).toEqual(['Food', 'hiking'])
  })

  it('merges one tag into another, keeping the target spelling and each entry once', () => {
    const both = make(['Hiking', 'walks'])
    const only = make(['walks'], 2000)
    const keep = make(['Hiking'], 3000)
    const r = rev(both)
    expect(repos.tags.merge('walks', 'hiking')).toEqual({ entries: 2 })
    expect(tagsOf(both)).toEqual(['Hiking'])
    expect(tagsOf(only)).toEqual(['Hiking'])
    expect(tagsOf(keep)).toEqual(['Hiking'])
    expect(rev(both)).toBeGreaterThan(r)
    expect(repos.tags.list()).toEqual([{ name: 'Hiking', count: 3 }])
    expect(found('walks')).toEqual([])
    expect(found('hiking').sort()).toEqual([both, only, keep].sort())
    expect(repos.tags.merge('hiking', 'HIKING')).toEqual({ entries: 0 })
    expect(() => repos.tags.merge('walks', 'hiking')).toThrow(TagNotFoundError)
  })

  it('deletes a tag from its entries, which stay', () => {
    const e = make(['food', 'hiking'])
    const r = rev(e)
    expect(repos.tags.remove('Hiking')).toEqual({ entries: 1 })
    expect(tagsOf(e)).toEqual(['food'])
    expect(rev(e)).toBeGreaterThan(r)
    expect(repos.entries.get(e)).toBeDefined()
    expect(found('hiking')).toEqual([])
    expect(repos.tags.list()).toEqual([{ name: 'food', count: 1 }])
    expect(() => repos.tags.remove('hiking')).toThrow(TagNotFoundError)
  })

  it('renames onto the name of a tag only deleted entries carry', () => {
    const gone = make(['old'], 1000)
    repos.entries.softDelete(gone)
    const e = make(['new'], 2000)
    expect(repos.tags.rename('new', 'old')).toEqual({ entries: 1 })
    expect(tagsOf(e)).toEqual(['old'])
  })

  it('shows up in the sync feed as a changed entry', () => {
    const e = make(['hiking'])
    const since = repos.entries.get(e)!.rev
    repos.tags.rename('hiking', 'Trekking')
    const changed = repos.sync.changes({ since, limit: 50 }).entries.find((x) => x.entry.id === e)
    expect(changed?.tags).toEqual(['Trekking'])
  })
})

describe('migration 0011 (case-insensitive tag names)', () => {
  it('folds tags that differ only by case into the oldest, keeping every entry tagged', () => {
    const { sqlite } = handle
    // The index as it was before 0011: case-sensitive, so case variants can coexist.
    sqlite.exec('DROP INDEX tag_user_name_uq')
    sqlite.exec(
      'CREATE UNIQUE INDEX tag_user_name_uq ON tag (user_id, name) WHERE deleted_at IS NULL',
    )
    const uid = (sqlite.prepare('SELECT id FROM user').get() as { id: string }).id
    const tag = sqlite.prepare(
      'INSERT INTO tag (id, user_id, name, created_at, updated_at, rev) VALUES (?,?,?,?,?,1)',
    )
    tag.run('t1', uid, 'Travel', 1, 1)
    tag.run('t2', uid, 'travel', 2, 2)
    tag.run('t3', uid, 'TRAVEL', 3, 3)
    tag.run('t4', uid, 'food', 4, 4)
    const e1 = make()
    const e2 = make(undefined, 2000)
    const link = sqlite.prepare('INSERT INTO entry_tag (entry_id, tag_id, user_id) VALUES (?,?,?)')
    link.run(e1, 't1', uid)
    link.run(e1, 't2', uid) // already has the keeper: must not collide
    link.run(e2, 't3', uid)
    link.run(e2, 't4', uid)

    const file = readFileSync(join(MIGRATIONS, '0011_stormy_bloodstrike.sql'), 'utf8')
    for (const stmt of file.split('--> statement-breakpoint')) {
      sqlite.exec(stmt)
    }

    expect(tagsOf(e1)).toEqual(['Travel'])
    expect(tagsOf(e2)).toEqual(['food', 'Travel'])
    expect(sqlite.prepare('SELECT count(*) AS n FROM tag').get()).toEqual({ n: 2 })
    expect(() => tag.run('t9', uid, 'FOOD', 9, 9)).toThrow(/UNIQUE/)
  })
})
