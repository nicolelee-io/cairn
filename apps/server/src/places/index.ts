import type { GoogleKeyStatus } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { appSettingsRepo } from '../repo/appSettings.ts'
import {
  withWeatherCache,
  type CachedWeatherProvider,
  type WeatherCache,
} from '../weather/cache.ts'
import { googleWeather } from '../weather/google.ts'
import { openMeteoWeather } from '../weather/openMeteo.ts'
import { weatherSetting } from '../weather/settings.ts'
import { googlePlaces } from './google.ts'
import type { PlacesProvider } from './provider.ts'

const KEY = 'google_api_key'

/**
 * The Google key can come from Settings (stored in the DB, wins) or GOOGLE_API_KEY in the
 * environment. It is read on every call, so saving one in Settings takes effect without a restart.
 */
export function googleKeys(db: Db, envKey?: string, fetchImpl?: typeof fetch) {
  const store = appSettingsRepo(db)
  const current = () => store.get(KEY) || envKey || undefined
  const provider = (): PlacesProvider | undefined => {
    const key = current()
    return key ? googlePlaces(key, fetchImpl) : undefined
  }
  const weatherChoice = weatherSetting(db)
  // Answers kept for a few minutes, so the editor's preview and the Save after it ask once.
  const weatherCache: WeatherCache = new Map()
  /** Automatic weather from the admin's chosen provider; Google's needs the key (else none). */
  const weather = (): CachedWeatherProvider | undefined => {
    if (weatherChoice.get() === 'open-meteo')
      return withWeatherCache(openMeteoWeather(fetchImpl), 'open-meteo', weatherCache)
    const key = current()
    return key ? withWeatherCache(googleWeather(key, fetchImpl), 'google', weatherCache) : undefined
  }
  return {
    provider,
    weather,
    weatherChoice,
    googleConfigured: () => !!current(),
    status(): GoogleKeyStatus {
      const saved = store.get(KEY)
      const key = saved || envKey
      return {
        configured: !!key,
        source: saved ? 'settings' : envKey ? 'env' : null,
        // Enough to recognise which key it is; never the key itself.
        hint: key ? key.slice(-4) : null,
      }
    },
    set: (key: string) => store.set(KEY, key),
    clear: () => store.delete(KEY),
  }
}
export type GoogleKeys = ReturnType<typeof googleKeys>
