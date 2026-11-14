import { Hono } from 'hono'
import { z } from 'zod'
import type { Weather } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { GoogleKeys } from '../places/index.ts'
import { WeatherError } from '../weather/google.ts'
import { badRequest } from './util.ts'

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  at: z.coerce.number().int(),
})

/**
 * Weather for a place and time without storing anything: the editor's preview before Save.
 * Answers: 200 the weather; 404 `no_weather` (the provider has nothing for that time, which is
 * normal and not an error); 424 `weather_unavailable` (Google chosen but no key) or
 * `weather_failed` (the provider failed; the reason is in the server log); 400 for a bad query.
 */
export function weatherRoutes(keys: GoogleKeys) {
  const r = new Hono<AuthEnv>()
  r.get('/preview', async (c) => {
    const q = Query.safeParse(c.req.query())
    if (!q.success) return badRequest(c)
    const provider = keys.weather()
    if (!provider) return c.json({ error: 'weather_unavailable' }, 424)
    try {
      const w = await provider.lookup(q.data.lat, q.data.lng, q.data.at)
      if (!w) return c.json({ error: 'no_weather' }, 404)
      return c.json<Weather>({
        condition: w.condition ?? 'unknown',
        isDay: w.isDay ?? null,
        tempC: w.tempC ?? null,
        description: w.description ?? null,
        pressureMb: w.pressureMb ?? null,
        humidityPct: w.humidityPct ?? null,
        windKph: w.windKph ?? null,
        source: w.source,
      })
    } catch (e) {
      if (e instanceof WeatherError) {
        console.error(`weather: ${e.message}`)
        return c.json({ error: 'weather_failed' }, 424)
      }
      throw e
    }
  })
  return r
}
