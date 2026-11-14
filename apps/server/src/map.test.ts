import { describe, expect, it } from 'vitest'
import { summarize } from '@cairn/shared'
import { createRepos } from './repo/index.ts'
import { addUser, memoryDb } from './test-helpers.ts'

const loc = (latitude: number, longitude: number) => ({
  latitude,
  longitude,
  placeName: 'Somewhere',
  locality: null,
  region: null,
  country: null,
  address: null,
  googlePlaceId: null,
})

describe('map points', () => {
  it('lists entries with a place, counts all, and follows the journal rules', async () => {
    const { db } = memoryDb()
    const user = await addUser(db, 'a')
    const r = createRepos(db, user.id)
    const j1 = r.journals.create({ name: 'One' })
    const j2 = r.journals.create({ name: 'Two' })
    const a = r.entries.create({
      journalId: j1.id,
      timezone: 'UTC',
      bodyMd: '# Hike\nlong',
      location: loc(1, 2),
    })
    r.entries.create({ journalId: j1.id, timezone: 'UTC', bodyMd: 'no place' })
    const b = r.entries.create({
      journalId: j2.id,
      timezone: 'UTC',
      bodyMd:
        'A long first line that is clearly not a title because it runs on and on and on and on',
      location: loc(3, 4),
    })
    const gone = r.entries.create({
      journalId: j2.id,
      timezone: 'UTC',
      bodyMd: 'x',
      location: loc(5, 6),
    })
    r.entries.softDelete(gone.id)

    const all = r.entries.mapPoints()
    expect(all.total).toBe(3)
    expect(all.points.map((p) => p.id).sort()).toEqual([a.id, b.id].sort())
    expect(all.points.find((p) => p.id === a.id)).toMatchObject({
      title: 'Hike',
      latitude: 1,
      placeName: 'Somewhere',
    })
    expect(all.points.find((p) => p.id === b.id)?.title).toMatch(/^A long first line/)

    expect(r.entries.mapPoints({ journalId: j1.id })).toMatchObject({ total: 2 })
    r.journals.update(j2.id, { archived: true })
    expect(r.entries.mapPoints().points.map((p) => p.id)).toEqual([a.id])
    expect(r.entries.mapPoints({ includeArchived: true }).points).toHaveLength(2)
    expect(r.entries.mapPoints({ journalId: j2.id }).points.map((p) => p.id)).toEqual([b.id])

    r.entries.update(a.id, { location: null })
    expect(r.entries.mapPoints().points).toHaveLength(0)
  })

  it('titles long entries as the whole text would, though it reads only the start', async () => {
    const { db } = memoryDb()
    const user = await addUser(db, 'a')
    const r = createRepos(db, user.id)
    const journalId = r.journals.create({ name: 'J' }).id
    const prose = 'word '.repeat(400)
    const photos = Array.from({ length: 40 }, () => `![](photo:${crypto.randomUUID()})`).join('\n')
    const bodies = [
      `# Heading\n${prose}`,
      `${'a long first line that is prose and not a title '.repeat(3)}\n${prose}`,
      // The cut falls mid-line, inside a link.
      `${'x'.repeat(990)} [a link](https://example.com/${'y'.repeat(50)})\nnext line`,
      // Nothing but photos in the first 1000 chars: the start alone gives no title or excerpt.
      `${photos}\n\nAfter the photos`,
    ]
    for (const bodyMd of bodies)
      r.entries.create({ journalId, timezone: 'UTC', bodyMd, location: loc(1, 2) })
    const titles = r.entries
      .mapPoints()
      .points.map((p) => p.title)
      .sort()
    const expected = bodies
      .map((b) => summarize(b))
      .map((s) => s.title || s.excerpt)
      .sort()
    expect(titles).toEqual(expected)
    expect(titles).toContain('After the photos')
  })

  it("never shows another user's entries", async () => {
    const { db } = memoryDb()
    const a = await addUser(db, 'a')
    const b = await addUser(db, 'b')
    const ra = createRepos(db, a.id)
    ra.entries.create({
      journalId: ra.journals.create({ name: 'J' }).id,
      timezone: 'UTC',
      bodyMd: 'x',
      location: loc(1, 2),
    })
    expect(createRepos(db, b.id).entries.mapPoints()).toEqual({ points: [], total: 0 })
  })
})
