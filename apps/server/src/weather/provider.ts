import type { NewWeather } from '../repo/imports.ts'

/** The provider failed or refused; callers keep going without weather. */
export class WeatherError extends Error {}

export interface WeatherProvider {
  /**
   * Weather at a place for the moment `at` (epoch ms). Null when the provider has nothing for that
   * time (Google's history reaches back 24 hours, SPEC 4c; nobody has observations of the future).
   * Throws WeatherError when the provider fails.
   */
  lookup(latitude: number, longitude: number, at: number, now?: number): Promise<NewWeather | null>
}
