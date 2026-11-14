import { mapWmoWeather } from '@cairn/shared'
import type { NewWeather } from '../repo/imports.ts'
import { WeatherError, type WeatherProvider } from './provider.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Open-Meteo's forecast API serves the last days (its models, hour by hour); older is the archive. */
const RECENT_DAYS = 5
/** An entry this far ahead of now is still "now"; further on there is nothing to say. */
const FUTURE_SLACK = 30 * 60_000

const FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'weather_code',
  'is_day',
] as const
type Field = (typeof FIELDS)[number]

type Hourly = { time?: string[] } & Partial<Record<Field, (number | null)[]>>

/**
 * Open-Meteo (open-meteo.com): no key, free for non-commercial use (CC BY 4.0, so the About card
 * credits it), and history back to 1940, so an entry dated last week or last year gets weather too.
 * Hourly values at the nearest whole hour, in UTC.
 */
export function openMeteoWeather(fetchImpl: typeof fetch = fetch): WeatherProvider {
  async function hourly(
    base: string,
    latitude: number,
    longitude: number,
    range: Record<string, string | number>,
  ): Promise<Hourly> {
    const q = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      hourly: FIELDS.join(','),
      timezone: 'UTC',
      ...Object.fromEntries(Object.entries(range).map(([k, v]) => [k, String(v)])),
    })
    const res = await fetchImpl(`${base}?${q}`, { signal: AbortSignal.timeout(8000) }).catch(
      (e: unknown) => {
        throw new WeatherError(`Open-Meteo request failed: ${String(e)}`)
      },
    )
    if (!res.ok) {
      // Open-Meteo explains itself: { error: true, reason: "..." }.
      const reason = ((await res.json().catch(() => null)) as { reason?: string } | null)?.reason
      throw new WeatherError(`Open-Meteo answered ${res.status}${reason ? `: ${reason}` : ''}`)
    }
    const body = (await res.json().catch(() => null)) as { hourly?: Hourly } | null
    if (!body?.hourly?.time) throw new WeatherError('Open-Meteo sent an answer with no hours')
    return body.hourly
  }

  return {
    async lookup(latitude, longitude, at, now = Date.now()) {
      if (at - now > FUTURE_SLACK) return null
      const hour = Math.round(at / HOUR) * HOUR
      const stamp = new Date(hour).toISOString().slice(0, 13) + ':00' // "2026-11-06T23:00"
      const day = new Date(hour).toISOString().slice(0, 10)
      const h =
        now - at <= RECENT_DAYS * DAY
          ? await hourly('https://api.open-meteo.com/v1/forecast', latitude, longitude, {
              past_days: RECENT_DAYS,
              forecast_days: 1,
            })
          : await hourly('https://archive-api.open-meteo.com/v1/archive', latitude, longitude, {
              start_date: day,
              end_date: day,
            })
      const i = h.time!.indexOf(stamp)
      const at_ = (f: Field) => (i < 0 ? null : (h[f]?.[i] ?? null))
      const code = at_('weather_code')
      if (code === null) return null // the hour is outside what it has, or not computed yet
      const isDay = at_('is_day')
      return {
        tempC: at_('temperature_2m'),
        feelsLikeC: at_('apparent_temperature'),
        condition: mapWmoWeather(code),
        isDay: isDay === null ? null : isDay === 1,
        description: null,
        pressureMb: at_('pressure_msl'),
        humidityPct: at_('relative_humidity_2m'),
        windKph: at_('wind_speed_10m'),
        windBearing: at_('wind_direction_10m'),
        visibilityKm: null,
        sunrise: null,
        sunset: null,
        source: 'open-meteo',
        sourceCode: String(code),
        fetchedAt: now,
        raw: JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, at_(f)]))),
      } satisfies NewWeather
    },
  }
}
