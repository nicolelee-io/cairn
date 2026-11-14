import { mapGoogleWeather } from '@cairn/shared'
import type { NewWeather } from '../repo/imports.ts'
import { WeatherError, type WeatherProvider } from './provider.ts'

export { WeatherError, type WeatherProvider }

const HOUR = 3_600_000
/** An entry this close to now gets the live reading, which is fresher than the last whole hour. */
const LIVE_WINDOW = 10 * 60_000
/** A little short of 24h so the hour we want is certain to still be in the history. */
const HISTORY_WINDOW = 23 * HOUR

interface Measure {
  unit?: string
  degrees?: number
  value?: number
  distance?: number
}
interface Conditions {
  weatherCondition?: { type?: string; description?: { text?: string } }
  temperature?: Measure
  feelsLikeTemperature?: Measure
  airPressure?: { meanSeaLevelMillibars?: number }
  wind?: { direction?: { degrees?: number }; speed?: Measure }
  visibility?: Measure
  relativeHumidity?: number
  isDaytime?: boolean
}

const celsius = (m?: Measure) =>
  m?.degrees === undefined ? null : m.unit === 'FAHRENHEIT' ? ((m.degrees - 32) * 5) / 9 : m.degrees
const kph = (m?: Measure) =>
  m?.value === undefined ? null : m.unit === 'MILES_PER_HOUR' ? m.value * 1.609344 : m.value
const km = (m?: Measure) =>
  m?.distance === undefined ? null : m.unit === 'MILES' ? m.distance * 1.609344 : m.distance

function toRow(c: Conditions, now: number): NewWeather {
  const type = c.weatherCondition?.type ?? 'TYPE_UNSPECIFIED'
  return {
    tempC: celsius(c.temperature),
    feelsLikeC: celsius(c.feelsLikeTemperature),
    condition: mapGoogleWeather(type),
    isDay: c.isDaytime ?? null,
    description: c.weatherCondition?.description?.text ?? null,
    pressureMb: c.airPressure?.meanSeaLevelMillibars ?? null,
    humidityPct: c.relativeHumidity ?? null,
    windKph: kph(c.wind?.speed),
    windBearing: c.wind?.direction?.degrees ?? null,
    visibilityKm: km(c.visibility),
    sunrise: null,
    sunset: null,
    source: 'google',
    sourceCode: type,
    fetchedAt: now,
    raw: JSON.stringify(c),
  }
}

/** Google Weather API: current conditions for "now", hourly history for the last 24 hours. */
export function googleWeather(apiKey: string, fetchImpl: typeof fetch = fetch): WeatherProvider {
  async function get(path: string, params: Record<string, string | number>) {
    const q = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      key: apiKey,
    })
    const res = await fetchImpl(`https://weather.googleapis.com/v1/${path}?${q}`, {
      signal: AbortSignal.timeout(8000),
    }).catch((e: unknown) => {
      throw new WeatherError(`Weather request failed: ${String(e)}`)
    })
    if (!res.ok) throw new WeatherError(`Weather answered ${res.status}`)
    return res.json() as Promise<unknown>
  }

  return {
    async lookup(latitude, longitude, at, now = Date.now()) {
      const where = { 'location.latitude': latitude, 'location.longitude': longitude }
      const age = now - at
      if (age < -LIVE_WINDOW || age > HISTORY_WINDOW) return null
      if (age <= LIVE_WINDOW) {
        return toRow((await get('currentConditions:lookup', where)) as Conditions, now)
      }
      const body = (await get('history/hours:lookup', { ...where, hours: 24 })) as {
        historyHours?: (Conditions & { interval?: { startTime: string; endTime: string } })[]
      }
      const hour = body.historyHours?.find((h) => {
        const start = Date.parse(h.interval?.startTime ?? '')
        const end = Date.parse(h.interval?.endTime ?? '')
        return at >= start && at < end
      })
      if (hour) return toRow(hour, now)
      // The hour in progress may not be in the history yet: for a recent time the live reading is
      // the closest thing, and better than no weather (the preview 404'd on a "now" entry).
      if (age <= 2 * HOUR) {
        return toRow((await get('currentConditions:lookup', where)) as Conditions, now)
      }
      return null
    },
  }
}
