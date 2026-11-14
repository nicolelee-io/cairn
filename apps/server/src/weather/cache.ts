import type { NewWeather } from '../repo/imports.ts'
import type { WeatherProvider } from './provider.ts'

/** How long an answer is reused: from the editor's preview to the Save that follows it. */
const TTL_MS = 10 * 60_000
/** Times in the same 10 minutes share an answer (the editor's preview is keyed the same way). */
const BUCKET_MS = 10 * 60_000
const MAX_ENTRIES = 100

interface Held {
  row: NewWeather
  at: number
}
export type WeatherCache = Map<string, Held>

/** A provider that remembers its answers for a few minutes and can say what it already knows. */
export interface CachedWeatherProvider extends WeatherProvider {
  /** The answer already looked up for this place and time, if fresh. Never makes a request. */
  cached(latitude: number, longitude: number, at: number, now?: number): NewWeather | undefined
}

/**
 * Wraps a provider so the editor's preview and the Save after it make one request, not two: Save
 * finds the answer here and stores it before the response goes out, so the reader opens with the
 * weather already on the entry. Only answers are kept (a failure or "nothing for that time" is asked
 * again), keyed by `id` (the provider, so switching it never serves the other's data), the exact
 * coordinates and the 10 minutes. The store is the caller's, shared across the provider objects
 * made per request.
 */
export function withWeatherCache(
  provider: WeatherProvider,
  id: string,
  store: WeatherCache,
): CachedWeatherProvider {
  const key = (latitude: number, longitude: number, at: number) =>
    `${id}|${latitude},${longitude}|${Math.floor(at / BUCKET_MS)}`
  const cached = (latitude: number, longitude: number, at: number, now = Date.now()) => {
    const held = store.get(key(latitude, longitude, at))
    return held && now - held.at < TTL_MS ? held.row : undefined
  }
  return {
    cached,
    async lookup(latitude, longitude, at, now = Date.now()) {
      const hit = cached(latitude, longitude, at, now)
      if (hit) return hit
      const row = await provider.lookup(latitude, longitude, at, now)
      if (row) {
        const k = key(latitude, longitude, at)
        store.delete(k) // re-inserted last, so the oldest is always first
        store.set(k, { row, at: now })
        if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!)
      }
      return row
    },
  }
}
