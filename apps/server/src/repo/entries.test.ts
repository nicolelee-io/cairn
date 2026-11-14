import { beforeEach, describe, expect, it } from 'vitest'
import { addUser, memoryDb } from '../test-helpers.ts'
import { summarize } from './entries.ts'
import { createRepos } from './index.ts'

let repos: ReturnType<typeof createRepos>
let j1: string
let j2: string

beforeEach(async () => {
  const { db } = memoryDb()
  repos = createRepos(db, (await addUser(db, 'a')).id)
  j1 = repos.journals.create({ name: 'one' }).id
  j2 = repos.journals.create({ name: 'two' }).id
  for (let t = 1; t <= 5; t++) {
    repos.entries.create({ journalId: t % 2 ? j1 : j2, createdAt: t * 1000, timezone: 'UTC' })
  }
})

describe('entry timeline', () => {
  const times = (page: { items: { createdAt: number }[] }) => page.items.map((e) => e.createdAt)

  it('returns newest first and honors the limit', () => {
    expect(times(repos.entries.timeline({ limit: 2 }))).toEqual([5000, 4000])
  })

  it('pages with the cursor without gaps or repeats', () => {
    const page1 = repos.entries.timeline({ limit: 2 })
    const page2 = repos.entries.timeline({ limit: 2, cursor: page1.nextCursor! })
    const page3 = repos.entries.timeline({ limit: 2, cursor: page2.nextCursor! })
    expect([page1, page2, page3].flatMap(times)).toEqual([5000, 4000, 3000, 2000, 1000])
    expect(page3.nextCursor).toBeNull()
  })

  it('filters by journal and skips tombstones', () => {
    expect(times(repos.entries.timeline({ journalId: j1 }))).toEqual([5000, 3000, 1000])
    const newest = repos.entries.timeline({ journalId: j1, limit: 1 }).items[0]!
    repos.entries.softDelete(newest.id)
    expect(times(repos.entries.timeline({ journalId: j1 }))).toEqual([3000, 1000])
  })

  it('moves an entry between own journals', () => {
    const e = repos.entries.timeline({ journalId: j1, limit: 1 }).items[0]!
    expect(repos.entries.update(e.id, { journalId: j2 })?.journalId).toBe(j2)
  })
})

describe('pinned entries', () => {
  it('sort first in the timeline, and paging crosses into the rest without gaps', () => {
    const all = repos.entries.timeline().items
    const old = all.at(-1)! // 1000
    const mid = all[2]! // 3000
    repos.entries.update(old.id, { pinned: true })
    repos.entries.update(mid.id, { pinned: true })
    const order: number[] = []
    let cursor: string | undefined
    do {
      const page = repos.entries.timeline({ limit: 1, cursor })
      order.push(...page.items.map((i) => i.createdAt))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(order).toEqual([3000, 1000, 5000, 4000, 2000])
  })
})

describe('summarize', () => {
  it('uses a heading as the title and the rest as the excerpt', () => {
    expect(summarize('# Hike\n\nStarted early.\n\n![](photo:abc)\n\nMidway **view**.')).toEqual({
      title: 'Hike',
      excerpt: 'Started early. Midway view.',
    })
  })

  it('uses a short first line as the title, like Day One', () => {
    expect(summarize('Escape room with Zach\nI felt good today.')).toEqual({
      title: 'Escape room with Zach',
      excerpt: 'I felt good today.',
    })
  })

  it('leaves the title empty when the first line is prose, so no text is lost', () => {
    const prose =
      'I woke at 4:30 and getting dressed made me extremely dysphoric, the same as always lately.'
    expect(prose.length).toBeGreaterThan(80)
    expect(summarize(prose)).toEqual({ title: '', excerpt: prose })
  })

  it('still treats a long heading as the title (clipped)', () => {
    const { title } = summarize(`# ${'word '.repeat(40)}\n\nbody`)
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(121)
  })

  it('strips markdown, escapes and images; handles photo-only and empty bodies', () => {
    expect(summarize('- one \\- two\n> quoted [link](http://x)')).toEqual({
      title: 'one - two',
      excerpt: 'quoted link',
    })
    expect(summarize('![](photo:a)\n![](photo:b)')).toEqual({ title: '', excerpt: '' })
    expect(summarize('')).toEqual({ title: '', excerpt: '' })
  })

  it('clips a long excerpt', () => {
    const { excerpt } = summarize(`Title\n${'a'.repeat(500)}`)
    expect(excerpt.length).toBe(241)
    expect(excerpt.endsWith('…')).toBe(true)
  })
})
