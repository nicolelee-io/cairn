import { describe, expect, it } from 'vitest'
import { createRepos } from './repo/index.ts'
import { addUser, memoryDb } from './test-helpers.ts'

const place = (name: string | null, lat: number, id: string | null = null) => ({
  latitude: lat,
  longitude: 0,
  placeName: name,
  locality: null,
  region: null,
  country: null,
  address: null,
  googlePlaceId: id,
})

describe('recent places', () => {
  it('lists distinct named places, newest entry first, and skips deleted and unnamed ones', async () => {
    const { db } = memoryDb()
    const user = await addUser(db, 'a')
    const r = createRepos(db, user.id)
    const j = r.journals.create({ name: 'J' }).id
    const at = (createdAt: number, location: ReturnType<typeof place>) =>
      r.entries.create({ journalId: j, timezone: 'UTC', createdAt, location })
    at(1000, place('Cafe', 1, 'g-cafe'))
    at(2000, place('Park', 2))
    at(3000, place('Cafe again', 1.00001, 'g-cafe')) // same Google place: one row, the newer entry's text
    at(4000, place(null, 3)) // coordinates only
    const gone = at(5000, place('Deleted', 4))
    r.entries.softDelete(gone.id)

    expect(r.entries.recentPlaces().map((p) => p.placeName)).toEqual(['Cafe again', 'Park'])
    expect(r.entries.recentPlaces(1)).toHaveLength(1)
  })

  it("never shows another user's places", async () => {
    const { db } = memoryDb()
    const a = await addUser(db, 'a')
    const b = await addUser(db, 'b')
    const ra = createRepos(db, a.id)
    ra.entries.create({
      journalId: ra.journals.create({ name: 'J' }).id,
      timezone: 'UTC',
      location: place('Mine', 1),
    })
    expect(createRepos(db, b.id).entries.recentPlaces()).toEqual([])
  })
})
