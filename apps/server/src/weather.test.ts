import { describe, expect, it, vi } from 'vitest'
import { mapGoogleWeather, mapWmoWeather } from '@cairn/shared'
import { createApp } from './app.ts'
import { googleKeys } from './places/index.ts'
import { createRepos } from './repo/index.ts'
import { addUser, memoryDb } from './test-helpers.ts'
import { googleWeather } from './weather/google.ts'
import { openMeteoWeather } from './weather/openMeteo.ts'
import type { NewWeather } from './repo/imports.ts'
import { withWeatherCache, type WeatherCache } from './weather/cache.ts'
import { WeatherError, type WeatherProvider } from './weather/provider.ts'
import { refreshWeather, refreshWeatherFromCache } from './weather/service.ts'

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

const NOW = Date.parse('2026-10-30T02:30:00Z')
const current = {
  weatherCondition: { type: 'MOSTLY_CLOUDY', description: { text: 'Mostly cloudy' } },
  temperature: { unit: 'CELSIUS', degrees: 11.5 },
  feelsLikeTemperature: { unit: 'CELSIUS', degrees: 10.4 },
  airPressure: { meanSeaLevelMillibars: 1016 },
  wind: { direction: { degrees: 355 }, speed: { unit: 'KILOMETERS_PER_HOUR', value: 8 } },
  visibility: { unit: 'KILOMETERS', distance: 16 },
  relativeHumidity: 50,
  isDaytime: false,
}
const history = {
  historyHours: [
    {
      interval: { startTime: '2026-10-30T01:00:00Z', endTime: '2026-10-30T02:00:00Z' },
      ...current,
      weatherCondition: { type: 'RAIN' },
    },
    {
      interval: { startTime: '2026-10-30T00:00:00Z', endTime: '2026-10-30T01:00:00Z' },
      ...current,
      weatherCondition: { type: 'SNOW' },
    },
  ],
}

describe('google weather mapping', () => {
  it('folds the families and falls back to unknown', () => {
    expect(mapGoogleWeather('CLEAR')).toBe('clear')
    expect(mapGoogleWeather('LIGHT_RAIN')).toBe('drizzle')
    expect(mapGoogleWeather('MODERATE_TO_HEAVY_RAIN')).toBe('rain')
    expect(mapGoogleWeather('HEAVY_SNOW_STORM')).toBe('snow')
    expect(mapGoogleWeather('RAIN_AND_SNOW')).toBe('sleet')
    expect(mapGoogleWeather('SCATTERED_THUNDERSTORMS')).toBe('thunderstorm')
    expect(mapGoogleWeather('TYPE_UNSPECIFIED')).toBe('unknown')
    expect(mapGoogleWeather('SOMETHING_NEW')).toBe('unknown')
  })
})

describe('google weather lookup', () => {
  const calls: string[] = []
  const provider = googleWeather('K', (url) => {
    calls.push(String(url))
    return json(String(url).includes('history') ? history : current)
  })

  it('uses current conditions for an entry made now, in metric', async () => {
    calls.length = 0
    const w = await provider.lookup(1, 2, NOW - 60_000, NOW)
    expect(calls[0]).toContain('currentConditions:lookup')
    expect(w).toMatchObject({
      tempC: 11.5,
      condition: 'mostly-cloudy',
      isDay: false,
      windKph: 8,
      pressureMb: 1016,
      humidityPct: 50,
      source: 'google',
      sourceCode: 'MOSTLY_CLOUDY',
    })
  })

  it('picks the history hour that contains the entry time', async () => {
    calls.length = 0
    const w = await provider.lookup(1, 2, Date.parse('2026-10-30T00:20:00Z'), NOW)
    expect(calls[0]).toContain('history/hours:lookup')
    expect(w?.condition).toBe('snow')
  })

  it('uses the live reading for a recent time the history does not list yet', async () => {
    calls.length = 0
    const w = await provider.lookup(1, 2, NOW - 30 * 60_000, NOW)
    expect(calls[0]).toContain('history/hours:lookup')
    expect(calls[1]).toContain('currentConditions:lookup')
    expect(w?.condition).toBe('mostly-cloudy')
  })

  it('has nothing for older or future entries, and does not call Google', async () => {
    calls.length = 0
    expect(await provider.lookup(1, 2, NOW - 2 * 86_400_000, NOW)).toBeNull()
    expect(await provider.lookup(1, 2, NOW + 3_600_000, NOW)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('converts imperial units if Google sends them', async () => {
    const p = googleWeather('K', () =>
      json({
        ...current,
        temperature: { unit: 'FAHRENHEIT', degrees: 50 },
        wind: { speed: { unit: 'MILES_PER_HOUR', value: 10 } },
      }),
    )
    const w = await p.lookup(1, 2, NOW, NOW)
    expect(w?.tempC).toBeCloseTo(10)
    expect(w?.windKph).toBeCloseTo(16.09, 1)
  })

  it('throws on a Google failure', async () => {
    const p = googleWeather('K', () => json({}, 403))
    await expect(p.lookup(1, 2, NOW, NOW)).rejects.toThrow('403')
  })
})

describe('open-meteo weather', () => {
  const hours = (stamp: string, over: Record<string, unknown> = {}) => ({
    hourly: {
      time: ['2026-10-30T01:00', stamp, '2026-10-30T03:00'],
      temperature_2m: [9, 11.5, 12],
      apparent_temperature: [8, 10, 11],
      relative_humidity_2m: [50, 55, 60],
      pressure_msl: [1010, 1016, 1017],
      wind_speed_10m: [5, 8, 9],
      wind_direction_10m: [90, 180, 270],
      weather_code: [0, 61, 3],
      is_day: [1, 0, 0],
      ...over,
    },
  })

  it('maps WMO codes onto the canonical conditions', () => {
    expect(
      [0, 1, 2, 3, 45, 53, 63, 66, 73, 81, 86, 95, 99, 42].map((c) => mapWmoWeather(c)),
    ).toEqual([
      'clear',
      'mostly-clear',
      'partly-cloudy',
      'cloudy',
      'fog',
      'drizzle',
      'rain',
      'rain',
      'snow',
      'rain',
      'snow',
      'thunderstorm',
      'thunderstorm',
      'unknown',
    ])
  })

  it('uses the forecast API for recent times and reads the nearest hour', async () => {
    const urls: string[] = []
    const p = openMeteoWeather((url) => {
      urls.push(String(url))
      return json(hours('2026-10-30T02:00'))
    })
    const w = await p.lookup(1, 2, NOW - 10 * 60_000, NOW) // 02:20, nearest hour 02:00
    expect(urls[0]).toContain('api.open-meteo.com/v1/forecast')
    expect(urls[0]).toContain('past_days=5')
    expect(w).toMatchObject({
      source: 'open-meteo',
      sourceCode: '61',
      condition: 'rain',
      tempC: 11.5,
      feelsLikeC: 10,
      isDay: false,
      pressureMb: 1016,
      humidityPct: 55,
      windKph: 8,
      windBearing: 180,
    })
  })

  it('uses the archive for older times, one day at a time', async () => {
    const urls: string[] = []
    const p = openMeteoWeather((url) => {
      urls.push(String(url))
      return json(hours('2026-10-20T02:00'))
    })
    const w = await p.lookup(1, 2, Date.parse('2026-10-20T01:50:00Z'), NOW)
    expect(urls[0]).toContain('archive-api.open-meteo.com/v1/archive')
    expect(urls[0]).toContain('start_date=2026-10-20')
    expect(urls[0]).toContain('end_date=2026-10-20')
    expect(w?.condition).toBe('rain')
  })

  it('has nothing for the future, or an hour it has no code for', async () => {
    let calls = 0
    const p = openMeteoWeather(() => {
      calls++
      return json(hours('2026-10-30T02:00', { weather_code: [0, null, 3] }))
    })
    expect(await p.lookup(1, 2, NOW + 3_600_000, NOW)).toBeNull()
    expect(calls).toBe(0)
    expect(await p.lookup(1, 2, NOW - 10 * 60_000, NOW)).toBeNull()
  })

  it('reports why it failed', async () => {
    const reason = openMeteoWeather(() => json({ error: true, reason: 'Too many requests' }, 429))
    await expect(reason.lookup(1, 2, NOW, NOW)).rejects.toThrow(/429: Too many requests/)
    const garbage = openMeteoWeather(() => json({ nope: 1 }))
    await expect(garbage.lookup(1, 2, NOW, NOW)).rejects.toThrow(/no hours/)
    const down = openMeteoWeather(() => Promise.reject(new Error('offline')))
    await expect(down.lookup(1, 2, NOW, NOW)).rejects.toThrow(/request failed/)
  })
})

describe('weather source setting', () => {
  async function login() {
    const { db } = memoryDb()
    await addUser(db, 'a', 'pw', 'admin')
    const keys = googleKeys(db, undefined, () => json(hours()))
    const app = createApp({ sha: 'x', db, googleKeys: keys })
    const H = { host: 'cairn.test', 'content-type': 'application/json' }
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ username: 'a', password: 'pw' }),
    })
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!
    const call = (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { ...H, cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    return { call, keys }
  }
  const hours = () => ({ nothing: true })

  it('defaults to Open-Meteo, and Google needs its key', async () => {
    const { call, keys } = await login()
    expect(await (await call('GET', '/api/admin/weather')).json()).toEqual({
      provider: 'open-meteo',
      googleConfigured: false,
    })
    const refused = await call('PUT', '/api/admin/weather', { provider: 'google' })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toBe('google_key_needed')
    keys.set('K')
    const ok = await call('PUT', '/api/admin/weather', { provider: 'google' })
    expect(await ok.json()).toEqual({ provider: 'google', googleConfigured: true })
    expect((await call('PUT', '/api/admin/weather', { provider: 'bing' })).status).toBe(400)
  })

  it('tells the preview apart: no weather, failed, unavailable', async () => {
    const { call, keys } = await login()
    const at = Date.now()
    // The fake answers with no hours at all: Open-Meteo "failed".
    const failed = await call('GET', `/api/weather/preview?lat=1&lng=2&at=${at}`)
    expect(failed.status).toBe(424)
    expect((await failed.json()).error).toBe('weather_failed')
    // Google chosen, key later removed: unavailable.
    keys.set('K')
    keys.weatherChoice.set('google')
    keys.clear()
    const gone = await call('GET', `/api/weather/preview?lat=1&lng=2&at=${at}`)
    expect(gone.status).toBe(424)
    expect((await gone.json()).error).toBe('weather_unavailable')
    // Nothing for that time is a plain 404 with its own code.
    keys.weatherChoice.set('open-meteo')
    const future = await call('GET', `/api/weather/preview?lat=1&lng=2&at=${at + 86_400_000}`)
    expect(future.status).toBe(404)
    expect((await future.json()).error).toBe('no_weather')
  })
})

describe('refreshWeather', () => {
  const loc = {
    latitude: 1,
    longitude: 2,
    placeName: null,
    locality: null,
    region: null,
    country: null,
    address: null,
    googlePlaceId: null,
  }
  const provider = googleWeather('K', () => json(current))
  const manual = { condition: 'clear' as const, tempC: 20, isDay: true }

  async function setup(location = true) {
    const { db } = memoryDb()
    const user = await addUser(db, 'a')
    const repos = createRepos(db, user.id)
    const j = repos.journals.create({ name: 'J' })
    const e = repos.entries.create(
      {
        journalId: j.id,
        timezone: 'UTC',
        createdAt: NOW - 60_000,
        location: location ? loc : null,
      },
      NOW,
    )
    return { db, repos, userId: user.id, entry: e }
  }

  it('stores weather without bumping the rev', async () => {
    const { db, repos, userId, entry } = await setup()
    expect(await refreshWeather(db, provider, userId, entry.id, NOW)).toBe('ok')
    const d = repos.entries.detail(entry.id)!
    expect(d.weather?.condition).toBe('mostly-cloudy')
    expect(d.entry.rev).toBe(entry.rev)
  })

  it('reports why there is nothing to fetch', async () => {
    const a = await setup(false)
    expect(await refreshWeather(a.db, provider, a.userId, a.entry.id, NOW)).toBe('no_location')
    const b = await setup()
    expect(await refreshWeather(b.db, undefined, b.userId, b.entry.id, NOW)).toBe('no_key')
    expect(await refreshWeather(b.db, provider, b.userId, 'nope', NOW)).toBe('not_found')
    b.repos.entries.update(b.entry.id, { createdAt: NOW - 5 * 86_400_000 })
    expect(await refreshWeather(b.db, provider, b.userId, b.entry.id, NOW)).toBe('out_of_range')
  })

  it('never replaces hand-entered weather, until the user asks for automatic', async () => {
    const { db, repos, userId, entry } = await setup()
    repos.entries.update(entry.id, { weather: manual })
    expect(repos.entries.detail(entry.id)?.weather).toMatchObject({ source: 'manual', tempC: 20 })
    expect(await refreshWeather(db, provider, userId, entry.id, NOW)).toBe('kept')
    expect(repos.entries.detail(entry.id)?.weather?.source).toBe('manual')

    const before = repos.entries.get(entry.id)!.rev
    repos.entries.update(entry.id, { weather: { auto: true } }) // drops it; the route refetches
    expect(repos.entries.detail(entry.id)?.weather).toBeNull()
    expect(repos.entries.get(entry.id)!.rev).toBeGreaterThan(before)
    expect(await refreshWeather(db, provider, userId, entry.id, NOW)).toBe('ok')
    expect(repos.entries.detail(entry.id)?.weather?.source).toBe('google')

    repos.entries.update(entry.id, { weather: null })
    expect(repos.entries.detail(entry.id)?.weather).toBeNull()
  })

  it('takes weather on create too', async () => {
    const { repos, entry } = await setup()
    const e = repos.entries.create({ journalId: entry.journalId, timezone: 'UTC', weather: manual })
    expect(repos.entries.detail(e.id)?.weather?.source).toBe('manual')
  })

  it("won't touch another user's entry", async () => {
    const { db, entry } = await setup()
    const other = await addUser(db, 'b')
    expect(await refreshWeather(db, provider, other.id, entry.id, NOW)).toBe('not_found')
    expect(createRepos(db, other.id).entries.update(entry.id, { weather: null })).toBeUndefined()
  })
})

describe('weather after a save', () => {
  it('fetches in the background for an entry that already has a place, and validates input', async () => {
    const { db } = memoryDb()
    const user = await addUser(db, 'a')
    let fetched = 0
    const keys = googleKeys(db, 'ENVKEY1234', () => {
      fetched++
      return json(current)
    })
    keys.weatherChoice.set('google') // Open-Meteo is the default
    const app = createApp({ sha: 'x', db, googleKeys: keys })
    const H = { host: 'cairn.test', 'content-type': 'application/json' }
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ username: 'a', password: 'pw' }),
    })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    const call = (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { ...H, cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const repos = createRepos(db, user.id)
    const loc = {
      latitude: 1,
      longitude: 2,
      placeName: 'P',
      locality: null,
      region: null,
      country: null,
      address: null,
      googlePlaceId: null,
    }
    // A place saved before weather existed, on an entry made just now.
    const e = repos.entries.create({
      journalId: repos.journals.create({ name: 'J' }).id,
      timezone: 'UTC',
      location: loc,
    })
    expect((await call('PATCH', `/api/entries/${e.id}`, { starred: true })).status).toBe(200)
    await vi.waitFor(() => expect(repos.entries.detail(e.id)?.weather?.source).toBe('google'))
    expect(fetched).toBe(1)

    // Hand-entered through the save; the next save leaves it alone.
    const res = await call('PATCH', `/api/entries/${e.id}`, {
      weather: { condition: 'rain', tempC: 12, isDay: null },
    })
    expect((await res.json()).weather).toMatchObject({ condition: 'rain', source: 'manual' })
    await call('PATCH', `/api/entries/${e.id}`, { starred: false })
    expect(repos.entries.detail(e.id)?.weather?.source).toBe('manual')
    expect(fetched).toBe(1)

    // Removing it in a save stays removed, even though the entry has a place.
    await call('PATCH', `/api/entries/${e.id}`, { weather: null })
    await new Promise((r) => setTimeout(r, 50))
    expect(repos.entries.detail(e.id)?.weather).toBeNull()
    expect(fetched).toBe(1)

    // The preview endpoint fetches without storing.
    const now = Date.now()
    const prev = await call('GET', `/api/weather/preview?lat=1&lng=2&at=${now}`)
    expect(prev.status).toBe(200)
    expect(await prev.json()).toMatchObject({ condition: 'mostly-cloudy', source: 'google' })
    expect(
      (await call('GET', `/api/weather/preview?lat=1&lng=2&at=${now - 5 * 86_400_000}`)).status,
    ).toBe(404)
    expect((await call('GET', '/api/weather/preview?lat=99&lng=2&at=1')).status).toBe(400)
    expect(repos.entries.detail(e.id)?.weather).toBeNull()

    expect(
      (
        await call('PATCH', `/api/entries/${e.id}`, {
          weather: { condition: 'lava', tempC: 1, isDay: null },
        })
      ).status,
    ).toBe(400)
  })
})

describe('weather cache', () => {
  const row = (tempC: number) =>
    ({
      condition: 'clear',
      tempC,
      source: 'open-meteo',
      fetchedAt: NOW,
    }) as unknown as NewWeather
  const counting = (answer: () => NewWeather | null) => {
    const calls = { n: 0 }
    const provider: WeatherProvider = {
      lookup: () => {
        calls.n++
        return Promise.resolve(answer())
      },
    }
    return { calls, provider }
  }

  it('answers a repeat of the same place and time without asking again', async () => {
    const { calls, provider } = counting(() => row(10))
    const cache: WeatherCache = new Map()
    const p = withWeatherCache(provider, 'open-meteo', cache)
    expect(p.cached(1, 2, NOW, NOW)).toBeUndefined() // nothing yet, and no request made
    expect(calls.n).toBe(0)
    expect((await p.lookup(1, 2, NOW, NOW))?.tempC).toBe(10)
    // A new provider object (one is made per request) shares the store.
    const again = withWeatherCache(provider, 'open-meteo', cache)
    expect((await again.lookup(1, 2, NOW + 60_000, NOW + 60_000))?.tempC).toBe(10)
    expect(again.cached(1, 2, NOW, NOW + 60_000)?.tempC).toBe(10)
    expect(calls.n).toBe(1)
  })

  it('does not mix places, times or providers, and forgets after ten minutes', async () => {
    const { calls, provider } = counting(() => row(10))
    const cache: WeatherCache = new Map()
    const p = withWeatherCache(provider, 'open-meteo', cache)
    await p.lookup(1, 2, NOW, NOW)
    await p.lookup(1, 3, NOW, NOW) // another place
    await p.lookup(1, 2, NOW + 3_600_000, NOW) // an hour on
    await withWeatherCache(provider, 'google', cache).lookup(1, 2, NOW, NOW) // another provider
    expect(calls.n).toBe(4)
    expect(p.cached(1, 2, NOW, NOW + 10 * 60_000 - 1)).toBeDefined()
    expect(p.cached(1, 2, NOW, NOW + 10 * 60_000)).toBeUndefined()
    await p.lookup(1, 2, NOW, NOW + 11 * 60_000)
    expect(calls.n).toBe(5)
  })

  it('keeps only answers: a failure or "nothing for that time" is asked again', async () => {
    let answer: NewWeather | null = null
    const { calls, provider } = counting(() => answer)
    const p = withWeatherCache(provider, 'open-meteo', new Map())
    expect(await p.lookup(1, 2, NOW, NOW)).toBeNull()
    expect(await p.lookup(1, 2, NOW, NOW)).toBeNull()
    expect(calls.n).toBe(2)
    const failing = withWeatherCache(
      { lookup: () => Promise.reject(new WeatherError('down')) },
      'open-meteo',
      new Map(),
    )
    await expect(failing.lookup(1, 2, NOW, NOW)).rejects.toThrow('down')
    answer = row(5)
    expect((await p.lookup(1, 2, NOW, NOW))?.tempC).toBe(5)
  })

  it('holds the newest hundred', async () => {
    const { provider } = counting(() => row(1))
    const cache: WeatherCache = new Map()
    const p = withWeatherCache(provider, 'open-meteo', cache)
    for (let i = 0; i < 105; i++) await p.lookup(i, 0, NOW, NOW)
    expect(cache.size).toBe(100)
    expect(p.cached(0, 0, NOW, NOW)).toBeUndefined()
    expect(p.cached(104, 0, NOW, NOW)).toBeDefined()
  })
})

describe('weather from the editor preview', () => {
  const loc = {
    latitude: 1,
    longitude: 2,
    placeName: 'P',
    locality: null,
    region: null,
    country: null,
    address: null,
    googlePlaceId: null,
  }

  async function setup() {
    const { db } = memoryDb()
    const user = await addUser(db, 'a')
    const fetched = { n: 0 }
    const keys = googleKeys(db, 'ENVKEY1234', () => {
      fetched.n++
      return json(current)
    })
    keys.weatherChoice.set('google') // Open-Meteo is the default
    const app = createApp({ sha: 'x', db, googleKeys: keys })
    const H = { host: 'cairn.test', 'content-type': 'application/json' }
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ username: 'a', password: 'pw' }),
    })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    const call = (method: string, path: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: { ...H, cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const repos = createRepos(db, user.id)
    const journalId = repos.journals.create({ name: 'J' }).id
    return { db, repos, journalId, fetched, call, keys, userId: user.id }
  }

  it('stores what the preview found before the response goes out, with one request', async () => {
    const { repos, journalId, fetched, call } = await setup()
    const at = Date.now()
    // The editor shows the weather for the place and time...
    expect((await call('GET', `/api/weather/preview?lat=1&lng=2&at=${at}`)).status).toBe(200)
    expect(fetched.n).toBe(1)
    // ...and Save finds it: the created entry already carries it, nothing more is asked.
    const res = await call('POST', '/api/entries', {
      journalId,
      timezone: 'UTC',
      createdAt: at,
      location: loc,
    })
    expect(res.status).toBe(201)
    const made = await res.json()
    expect(made.weather).toMatchObject({ condition: 'mostly-cloudy', source: 'google' })
    expect(fetched.n).toBe(1)
    expect(repos.entries.detail(made.entry.id)?.weather?.source).toBe('google')

    // Moving the place drops what followed it; with no new preview it is fetched after the response.
    const moved = await call('PATCH', `/api/entries/${made.entry.id}`, {
      location: { ...loc, latitude: 3 },
    })
    expect(moved.status).toBe(200)
    await vi.waitFor(() => expect(fetched.n).toBe(2))
  })

  it('also fills a PATCH from the preview, and never replaces hand-entered weather', async () => {
    const { repos, journalId, fetched, call } = await setup()
    const at = Date.now()
    const e = repos.entries.create({ journalId, timezone: 'UTC', createdAt: at })
    await call('GET', `/api/weather/preview?lat=1&lng=2&at=${at}`)
    const res = await call('PATCH', `/api/entries/${e.id}`, { location: loc })
    expect((await res.json()).weather).toMatchObject({ source: 'google' })
    expect(fetched.n).toBe(1)

    const hand = await call('PATCH', `/api/entries/${e.id}`, {
      weather: { condition: 'rain', tempC: 12, isDay: null },
    })
    expect((await hand.json()).weather).toMatchObject({ condition: 'rain', source: 'manual' })
    await call('PATCH', `/api/entries/${e.id}`, { starred: true })
    expect(repos.entries.detail(e.id)?.weather?.source).toBe('manual')
    expect(fetched.n).toBe(1)
  })

  it('falls back to the background fetch when the preview has not been asked', async () => {
    const { repos, journalId, fetched, call } = await setup()
    const res = await call('POST', '/api/entries', {
      journalId,
      timezone: 'UTC',
      createdAt: Date.now(),
      location: loc,
    })
    const made = await res.json()
    expect(made.weather).toBeNull() // not there yet when the response goes out
    await vi.waitFor(() =>
      expect(repos.entries.detail(made.entry.id)?.weather?.source).toBe('google'),
    )
    expect(fetched.n).toBe(1)
  })

  it('refreshWeatherFromCache makes no request and says miss', async () => {
    const { db, repos, journalId, fetched, keys, userId } = await setup()
    const e = repos.entries.create({ journalId, timezone: 'UTC', createdAt: NOW, location: loc })
    const provider = keys.weather()!
    expect(refreshWeatherFromCache(db, provider, userId, e.id, NOW)).toBe('miss')
    expect(fetched.n).toBe(0)
    await provider.lookup(1, 2, NOW, NOW)
    expect(refreshWeatherFromCache(db, provider, userId, e.id, NOW)).toBe('ok')
    expect(refreshWeatherFromCache(db, undefined, userId, e.id, NOW)).toBe('no_key')
    expect(refreshWeatherFromCache(db, provider, userId, 'nope', NOW)).toBe('not_found')
  })
})
