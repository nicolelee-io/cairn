import { isAutoWeather } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { createRepos } from '../repo/index.ts'
import type { CachedWeatherProvider } from './cache.ts'
import type { WeatherProvider } from './google.ts'

export type WeatherOutcome = 'ok' | 'kept' | 'not_found' | 'no_location' | 'no_key' | 'out_of_range'

/** The entry's place and what is already on it, or why there is nothing to fetch. */
function wanted(db: Db, provider: unknown, userId: string, entryId: string) {
  const repos = createRepos(db, userId)
  const d = repos.entries.detail(entryId)
  if (!d) return 'not_found' as const
  if (!d.location) return 'no_location' as const
  if (!provider) return 'no_key' as const
  if (d.weather && !isAutoWeather(d.weather.source)) return 'kept' as const // skip the request
  return { repos, d, location: d.location }
}

/**
 * Fetches the weather for an entry's place and time and stores it (the background job after a
 * save). It leaves Day One and hand-entered weather alone. Throws WeatherError if the provider
 * fails; the caller swallows that, because weather never blocks saving (SPEC 4c).
 */
export async function refreshWeather(
  db: Db,
  provider: WeatherProvider | undefined,
  userId: string,
  entryId: string,
  now = Date.now(),
): Promise<WeatherOutcome> {
  const w = wanted(db, provider, userId, entryId)
  if (typeof w === 'string') return w
  const { repos, d, location } = w
  const row = await provider!.lookup(location.latitude, location.longitude, d.entry.createdAt, now)
  if (!row) return 'out_of_range'
  return repos.entries.setFetchedWeather(entryId, row, now) === 'kept' ? 'kept' : 'ok'
}

/**
 * The same, but only from what the provider has already looked up (the editor's preview): it makes
 * no request, so it is safe to run before a save's response goes out, which then carries the
 * weather. `miss` means nothing was cached; the caller falls back to `refreshWeather`.
 */
export function refreshWeatherFromCache(
  db: Db,
  provider: CachedWeatherProvider | undefined,
  userId: string,
  entryId: string,
  now = Date.now(),
): WeatherOutcome | 'miss' {
  const w = wanted(db, provider, userId, entryId)
  if (typeof w === 'string') return w
  const { repos, d, location } = w
  const row = provider!.cached(location.latitude, location.longitude, d.entry.createdAt, now)
  if (!row) return 'miss'
  return repos.entries.setFetchedWeather(entryId, row, now) === 'kept' ? 'kept' : 'ok'
}
