import { z } from 'zod'

/** Canonical weather conditions (SPEC 4c). Provider codes are mapped into this; the raw code is kept. */
export const WEATHER_CONDITIONS = [
  'clear',
  'mostly-clear',
  'partly-cloudy',
  'mostly-cloudy',
  'cloudy',
  'haze',
  'fog',
  'drizzle',
  'rain',
  'thunderstorm',
  'snow',
  'sleet',
  'hail',
  'wind',
  'unknown',
] as const
export const WeatherConditionSchema = z.enum(WEATHER_CONDITIONS)
export type WeatherCondition = z.infer<typeof WeatherConditionSchema>

// Keys are normalized codes (see normalizeDayOneWeatherCode). Observed in a real export: Clear,
// clear, MostlyClear, PartlyCloudy, MostlyCloudy, Cloudy, Drizzle, Rain, Thunderstorms, Windy, Haze.
// The rest are the other WeatherKit / Forecast.io names, so future exports don't fall to 'unknown'.
const DAYONE_WEATHER: Record<string, WeatherCondition> = {
  clear: 'clear',
  sunny: 'clear',
  mostlyclear: 'mostly-clear',
  partlycloudy: 'partly-cloudy',
  mostlycloudy: 'mostly-cloudy',
  cloudy: 'cloudy',
  haze: 'haze',
  smoky: 'haze',
  fog: 'fog',
  foggy: 'fog',
  drizzle: 'drizzle',
  freezingdrizzle: 'drizzle',
  rain: 'rain',
  heavyrain: 'rain',
  freezingrain: 'rain',
  thunderstorms: 'thunderstorm',
  thunderstorm: 'thunderstorm',
  snow: 'snow',
  heavysnow: 'snow',
  flurries: 'snow',
  blizzard: 'snow',
  sleet: 'sleet',
  wintrymix: 'sleet',
  hail: 'hail',
  windy: 'wind',
  wind: 'wind',
  breezy: 'wind',
}

/** Lowercases, drops a Forecast.io `-day`/`-night` suffix (returned as isDay) and non-letters. */
export function normalizeDayOneWeatherCode(code: string): { key: string; isDay: boolean | null } {
  const lower = code.trim().toLowerCase()
  const isDay = lower.endsWith('-day') ? true : lower.endsWith('-night') ? false : null
  return { key: lower.replace(/-(day|night)$/, '').replace(/[^a-z]/g, ''), isDay }
}

export function mapDayOneWeather(code: string): {
  condition: WeatherCondition
  isDay: boolean | null
} {
  const { key, isDay } = normalizeDayOneWeatherCode(code)
  return { condition: DAYONE_WEATHER[key] ?? 'unknown', isDay }
}

// Google Weather API `weatherCondition.type` values (43 of them) onto the canonical enum. Light
// rain counts as drizzle; every rain/snow/thunder variant folds into its family. Anything new or
// TYPE_UNSPECIFIED becomes 'unknown' (the raw type is kept in source_code).
const GOOGLE_WEATHER: Record<string, WeatherCondition> = {
  CLEAR: 'clear',
  MOSTLY_CLEAR: 'mostly-clear',
  PARTLY_CLOUDY: 'partly-cloudy',
  MOSTLY_CLOUDY: 'mostly-cloudy',
  CLOUDY: 'cloudy',
  WINDY: 'wind',
  WIND_AND_RAIN: 'rain',
  LIGHT_RAIN_SHOWERS: 'drizzle',
  LIGHT_RAIN: 'drizzle',
  CHANCE_OF_SHOWERS: 'rain',
  SCATTERED_SHOWERS: 'rain',
  RAIN_SHOWERS: 'rain',
  HEAVY_RAIN_SHOWERS: 'rain',
  LIGHT_TO_MODERATE_RAIN: 'rain',
  MODERATE_TO_HEAVY_RAIN: 'rain',
  RAIN: 'rain',
  HEAVY_RAIN: 'rain',
  RAIN_PERIODICALLY_HEAVY: 'rain',
  LIGHT_SNOW_SHOWERS: 'snow',
  CHANCE_OF_SNOW_SHOWERS: 'snow',
  SCATTERED_SNOW_SHOWERS: 'snow',
  SNOW_SHOWERS: 'snow',
  HEAVY_SNOW_SHOWERS: 'snow',
  LIGHT_TO_MODERATE_SNOW: 'snow',
  MODERATE_TO_HEAVY_SNOW: 'snow',
  SNOW: 'snow',
  LIGHT_SNOW: 'snow',
  HEAVY_SNOW: 'snow',
  SNOWSTORM: 'snow',
  SNOW_PERIODICALLY_HEAVY: 'snow',
  HEAVY_SNOW_STORM: 'snow',
  BLOWING_SNOW: 'snow',
  RAIN_AND_SNOW: 'sleet',
  HAIL: 'hail',
  HAIL_SHOWERS: 'hail',
  THUNDERSTORM: 'thunderstorm',
  THUNDERSHOWER: 'thunderstorm',
  LIGHT_THUNDERSTORM_RAIN: 'thunderstorm',
  SCATTERED_THUNDERSTORMS: 'thunderstorm',
  HEAVY_THUNDERSTORM: 'thunderstorm',
}

export const mapGoogleWeather = (type: string): WeatherCondition =>
  GOOGLE_WEATHER[type.toUpperCase()] ?? 'unknown'

// The reverse of DAYONE_WEATHER, for the Day One export: WeatherKit's PascalCase names, which is
// what Day One writes for current entries (no -day/-night suffix appears in a real export; day or
// night is carried by sunriseDate/sunsetDate). 'unknown' has no Day One equivalent.
const DAYONE_CODE: Record<Exclude<WeatherCondition, 'unknown'>, string> = {
  clear: 'Clear',
  'mostly-clear': 'MostlyClear',
  'partly-cloudy': 'PartlyCloudy',
  'mostly-cloudy': 'MostlyCloudy',
  cloudy: 'Cloudy',
  haze: 'Haze',
  fog: 'Foggy',
  drizzle: 'Drizzle',
  rain: 'Rain',
  thunderstorm: 'Thunderstorms',
  snow: 'Snow',
  sleet: 'Sleet',
  hail: 'Hail',
  wind: 'Windy',
}

/** Day One `weatherCode` for a canonical condition; null for 'unknown'. */
export const toDayOneWeatherCode = (condition: WeatherCondition): string | null =>
  condition === 'unknown' ? null : DAYONE_CODE[condition]

// Open-Meteo's `weather_code` is a WMO code. Drizzle (51-57) is drizzle, every rain, shower and
// freezing-rain code is rain, snow and snow grains are snow, 95-99 are thunderstorms (96 and 99
// carry hail but stay thunderstorms). Anything else is 'unknown' (the raw code is kept).
export function mapWmoWeather(code: number): WeatherCondition {
  if (code === 0) return 'clear'
  if (code === 1) return 'mostly-clear'
  if (code === 2) return 'partly-cloudy'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code === 95 || code === 96 || code === 99) return 'thunderstorm'
  return 'unknown'
}

/** Where an entry's weather came from. `google` and `open-meteo` are fetched; the rest are not. */
export const WEATHER_SOURCES = ['dayone', 'google', 'open-meteo', 'manual'] as const
export const WeatherSourceSchema = z.enum(WEATHER_SOURCES)
export type WeatherSource = z.infer<typeof WeatherSourceSchema>

/** Weather a provider fetched, which a new place or time replaces (never Day One's or the user's). */
export const isAutoWeather = (source: WeatherSource | null | undefined): boolean =>
  source === 'google' || source === 'open-meteo'

/** The admin's choice of where automatic weather comes from. Open-Meteo needs no key. */
export const WEATHER_PROVIDERS = ['open-meteo', 'google'] as const
export const WeatherProviderSchema = z.enum(WEATHER_PROVIDERS)
export type WeatherProvider = z.infer<typeof WeatherProviderSchema>

/** GET/PUT /api/admin/weather. */
export const WeatherSettingsSchema = z.object({
  provider: WeatherProviderSchema,
  /** Whether a Google key is saved, which the Google option needs. */
  googleConfigured: z.boolean(),
})
export type WeatherSettings = z.infer<typeof WeatherSettingsSchema>
export const UpdateWeatherSettingsSchema = z.object({ provider: WeatherProviderSchema })
