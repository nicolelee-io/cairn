import { beforeEach, describe, expect, it } from 'vitest'
import { addUser, memoryDb } from '../test-helpers.ts'
import { createRepos } from './index.ts'

let repos: ReturnType<typeof createRepos>

beforeEach(async () => {
  const { db } = memoryDb()
  repos = createRepos(db, (await addUser(db, 'a')).id)
})

describe('journals', () => {
  it('lists by sort order, then creation time', () => {
    const second = repos.journals.create({ name: 'second' }, 2000)
    const first = repos.journals.create({ name: 'first' }, 3000)
    repos.journals.update(first.id, { sortOrder: -1 })
    expect(repos.journals.list().map((j) => j.name)).toEqual(['first', 'second'])
    expect(second.color).toBeNull()
  })

  it('puts a new journal last, even after a reorder', () => {
    const a = repos.journals.create({ name: 'a' }, 1000)
    const b = repos.journals.create({ name: 'b' }, 2000)
    repos.journals.reorder([b.id, a.id])
    repos.journals.create({ name: 'c' }, 3000)
    expect(repos.journals.list().map((j) => j.name)).toEqual(['b', 'a', 'c'])
  })

  it('reorders, bumping rev only for journals that moved', () => {
    const a = repos.journals.create({ name: 'a' }, 1000)
    const b = repos.journals.create({ name: 'b' }, 2000)
    const c = repos.journals.create({ name: 'c' }, 3000)
    repos.journals.reorder([a.id, c.id, b.id])
    expect(repos.journals.list().map((j) => j.name)).toEqual(['a', 'c', 'b'])
    expect(repos.journals.get(a.id)!.rev).toBe(a.rev)
    expect(repos.journals.get(b.id)!.rev).toBeGreaterThan(b.rev)
  })

  it('keeps journals left out of a reorder after the listed ones', () => {
    const a = repos.journals.create({ name: 'a' }, 1000)
    const b = repos.journals.create({ name: 'b' }, 2000)
    repos.journals.create({ name: 'c' }, 3000)
    repos.journals.reorder([b.id])
    expect(repos.journals.list().map((j) => j.name)).toEqual(['b', 'a', 'c'])
    expect(a.name).toBe('a')
  })

  it("skips ids that aren't the user's live journals", async () => {
    const a = repos.journals.create({ name: 'a' }, 1000)
    const b = repos.journals.create({ name: 'b' }, 2000)
    const gone = repos.journals.create({ name: 'gone' }, 3000)
    repos.journals.softDelete(gone.id)
    const { db } = memoryDb()
    const other = createRepos(db, (await addUser(db, 'b')).id)
    const theirs = other.journals.create({ name: 'theirs' })
    repos.journals.reorder([b.id, theirs.id, gone.id, b.id, a.id])
    expect(repos.journals.list().map((j) => j.name)).toEqual(['b', 'a'])
    expect(other.journals.get(theirs.id)!.sortOrder).toBe(0)
    expect(other.journals.get(theirs.id)!.rev).toBe(theirs.rev)
  })

  it('hides archived journals by default and restores them on unarchive', () => {
    const j = repos.journals.create({ name: 'old' })
    repos.journals.create({ name: 'current' })

    repos.journals.update(j.id, { archived: true }, 5000)
    expect(repos.journals.list().map((x) => x.name)).toEqual(['current'])
    expect(repos.journals.list({ includeArchived: true })).toHaveLength(2)
    expect(repos.journals.get(j.id)?.archivedAt).toBe(5000)

    repos.journals.update(j.id, { archived: false })
    expect(repos.journals.get(j.id)?.archivedAt).toBeNull()
    expect(repos.journals.list()).toHaveLength(2)
  })

  it('renames and recolors, bumping rev', () => {
    const j = repos.journals.create({ name: 'a' })
    const u = repos.journals.update(j.id, { name: 'b', color: '#7B7B45' })!
    expect(u).toMatchObject({ name: 'b', color: '#7B7B45' })
    expect(u.rev).toBeGreaterThan(j.rev)
  })

  it('stores an icon, and clears it with null', () => {
    const j = repos.journals.create({ name: 'a', icon: '🍋' })
    expect(j.icon).toBe('🍋')
    expect(repos.journals.update(j.id, { icon: null })!.icon).toBeNull()
  })

  it('soft-deletes: hidden from get and list even when including archived', () => {
    const j = repos.journals.create({ name: 'gone' })
    expect(repos.journals.softDelete(j.id)).toBe(true)
    expect(repos.journals.get(j.id)).toBeUndefined()
    expect(repos.journals.list({ includeArchived: true })).toEqual([])
    expect(repos.journals.softDelete(j.id)).toBe(false)
  })

  it('returns undefined when updating a journal that does not exist', () => {
    expect(repos.journals.update('nope', { name: 'x' })).toBeUndefined()
  })
})
