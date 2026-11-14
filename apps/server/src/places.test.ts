import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { googlePlaces } from './places/google.ts'
import { googleKeys } from './places/index.ts'
import { createRepos } from './repo/index.ts'
import { addUser, memoryDb } from './test-helpers.ts'

const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('google provider', () => {
  it('maps autocomplete, dropping query predictions', async () => {
    const calls: string[] = []
    const p = googlePlaces('K', (url, init) => {
      calls.push(`${url} ${(init?.headers as Record<string, string>)['X-Goog-Api-Key']}`)
      return reply({
        suggestions: [
          {
            placePrediction: {
              placeId: 'p1',
              structuredFormat: {
                mainText: { text: 'Gas Works Park' },
                secondaryText: { text: 'Seattle, WA' },
              },
            },
          },
          { queryPrediction: { text: { text: 'parks near me' } } },
        ],
      })
    })
    expect(await p.search('gas', { latitude: 1, longitude: 2 })).toEqual([
      { placeId: 'p1', name: 'Gas Works Park', detail: 'Seattle, WA' },
    ])
    expect(calls[0]).toContain('places:autocomplete K')
  })

  it('maps details to a location', async () => {
    const p = googlePlaces('K', () =>
      reply({
        id: 'p1',
        displayName: { text: 'Gas Works Park' },
        formattedAddress: '2101 N Northlake Way',
        location: { latitude: 47.6, longitude: -122.3 },
        addressComponents: [
          { longText: 'Seattle', types: ['locality'] },
          { longText: 'Washington', types: ['administrative_area_level_1'] },
          { longText: 'United States', types: ['country'] },
        ],
      }),
    )
    expect(await p.details('p1')).toEqual({
      latitude: 47.6,
      longitude: -122.3,
      placeName: 'Gas Works Park',
      locality: 'Seattle',
      region: 'Washington',
      country: 'United States',
      address: '2101 N Northlake Way',
      googlePlaceId: 'p1',
    })
  })

  it('reverse geocodes, and reports nothing found as null', async () => {
    const found = googlePlaces('K', () =>
      reply({
        status: 'OK',
        results: [
          {
            formatted_address: '1 Main St, Denver, CO',
            place_id: 'g1',
            address_components: [
              { long_name: '1', types: ['street_number'] },
              { long_name: 'Main St', types: ['route'] },
              { long_name: 'Denver', types: ['locality'] },
            ],
          },
        ],
      }),
    )
    expect(await found.reverse(39.7, -105)).toMatchObject({
      placeName: '1 Main St',
      locality: 'Denver',
      latitude: 39.7,
    })
    const none = googlePlaces('K', () => reply({ status: 'ZERO_RESULTS', results: [] }))
    expect(await none.reverse(0, 0)).toBeNull()
  })

  it('turns a failing Google into PlacesError', async () => {
    const p = googlePlaces('K', () => reply({}, 403))
    await expect(p.search('x')).rejects.toThrow('403')
  })
})

describe('google key', () => {
  it('prefers Settings over the environment and never reveals the key', () => {
    const keys = googleKeys(memoryDb().db, 'ENVKEY1234')
    expect(keys.status()).toEqual({ configured: true, source: 'env', hint: '1234' })
    keys.set('SETTINGSKEY9999')
    expect(keys.status()).toEqual({ configured: true, source: 'settings', hint: '9999' })
    keys.clear()
    expect(keys.status().source).toBe('env')
    expect(googleKeys(memoryDb().db).status()).toEqual({
      configured: false,
      source: null,
      hint: null,
    })
  })
})

describe('/api/places', () => {
  const HOST = 'cairn.test'
  let app: ReturnType<typeof createApp>
  let cookie: string
  const seen: string[] = []

  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { host: HOST, cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  beforeAll(async () => {
    const { db } = memoryDb()
    await addUser(db, 'a', 'pw', 'admin')
    const keys = googleKeys(db, undefined, (url, init) => {
      seen.push(String(url) + ((init?.headers as Record<string, string>)?.['X-Goog-Api-Key'] ?? ''))
      return reply({ status: 'ZERO_RESULTS' })
    })
    app = createApp({ sha: 'x', db, googleKeys: keys })
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'a', password: 'pw' }),
    })
    cookie = res.headers.get('set-cookie')!.split(';')[0]!
  })

  it('needs a session', async () => {
    expect((await app.request('/api/places/search?q=x', { headers: { host: HOST } })).status).toBe(
      401,
    )
    expect((await app.request('/api/places/key', { headers: { host: HOST } })).status).toBe(401)
  })

  it('answers 424 until a key is saved, then uses it without a restart', async () => {
    expect((await call('GET', '/api/places/reverse?lat=1&lng=2')).status).toBe(424)
    expect((await call('PUT', '/api/places/key', { key: 'short' })).status).toBe(400)
    const saved = await call('PUT', '/api/places/key', { key: 'my-secret-key-1234' })
    expect(await saved.json()).toEqual({ configured: true, source: 'settings', hint: '1234' })
    expect(JSON.stringify(await (await call('GET', '/api/places/key')).json())).not.toContain(
      'secret',
    )
    expect((await call('GET', '/api/places/reverse?lat=1&lng=2')).status).toBe(404) // ZERO_RESULTS
    expect(seen).toHaveLength(1)
    await call('DELETE', '/api/places/key')
    expect((await call('GET', '/api/places/reverse?lat=1&lng=2')).status).toBe(424)
  })

  it('rejects bad coordinates', async () => {
    await call('PUT', '/api/places/key', { key: 'my-secret-key-1234' })
    expect((await call('GET', '/api/places/reverse?lat=99&lng=2')).status).toBe(400)
  })
})

describe('entry location', () => {
  const loc = {
    latitude: 47.6,
    longitude: -122.3,
    placeName: 'Gas Works Park',
    locality: 'Seattle',
    region: 'Washington',
    country: 'United States',
    address: null,
    googlePlaceId: null,
  }

  it('sets, replaces and removes a place, bumping rev and keeping search current', async () => {
    const { db } = memoryDb()
    const user = await addUser(db, 'a')
    const r = createRepos(db, user.id)
    const j = r.journals.create({ name: 'J' })
    const e = r.entries.create({
      journalId: j.id,
      timezone: 'UTC',
      bodyMd: 'a walk',
      location: loc,
    })
    expect(r.entries.detail(e.id)?.location).toMatchObject({ placeName: 'Gas Works Park' })
    expect(r.search.search({ q: 'seattle' }).items).toHaveLength(1)

    const e2 = r.entries.update(e.id, {
      location: { ...loc, placeName: 'Pike Place', locality: 'Tacoma' },
    })!
    expect(e2.rev).toBeGreaterThan(e.rev)
    expect(r.search.search({ q: 'seattle' }).items).toHaveLength(0)
    expect(r.search.search({ q: 'tacoma' }).items).toHaveLength(1)

    r.entries.update(e.id, { starred: true }) // untouched when omitted
    expect(r.entries.detail(e.id)?.location?.placeName).toBe('Pike Place')

    r.entries.update(e.id, { location: null })
    expect(r.entries.detail(e.id)?.location).toBeNull()
    expect(r.search.search({ q: 'tacoma' }).items).toHaveLength(0)
  })

  it("won't touch another user's entry", async () => {
    const { db } = memoryDb()
    const a = await addUser(db, 'a')
    const b = await addUser(db, 'b')
    const ra = createRepos(db, a.id)
    const e = ra.entries.create({
      journalId: ra.journals.create({ name: 'J' }).id,
      timezone: 'UTC',
      location: loc,
    })
    expect(createRepos(db, b.id).entries.update(e.id, { location: null })).toBeUndefined()
    expect(ra.entries.detail(e.id)?.location).not.toBeNull()
  })
})
