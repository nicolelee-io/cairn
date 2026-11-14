import {
  isAutoWeather,
  type Location,
  type WeatherCondition,
  type WeatherEdit,
  type WeatherSource,
} from '@cairn/shared'
import { sameLocation } from './location.ts'
import type { IconName } from '../components/Icon.tsx'

/** Canonical condition (+ day/night where it matters) -> Material Symbol. Unknown shows a cloud. */
export function weatherIcon(condition: WeatherCondition, isDay: boolean | null): IconName {
  const night = isDay === false
  switch (condition) {
    case 'clear':
    case 'mostly-clear':
      return night ? 'nightlight' : 'clear_day'
    case 'partly-cloudy':
      return night ? 'partly_cloudy_night' : 'partly_cloudy_day'
    case 'mostly-cloudy':
    case 'cloudy':
    case 'unknown':
      return 'cloud'
    case 'haze':
      return 'mist'
    case 'fog':
      return 'foggy'
    case 'drizzle':
      return 'rainy_light'
    case 'rain':
      return 'rainy'
    case 'thunderstorm':
      return 'thunderstorm'
    case 'snow':
      return 'weather_snowy'
    case 'sleet':
      return 'weather_mix'
    case 'hail':
      return 'weather_hail'
    case 'wind':
      return 'air'
  }
}

const LABELS: Record<WeatherCondition, string> = {
  clear: 'Clear',
  'mostly-clear': 'Mostly clear',
  'partly-cloudy': 'Partly cloudy',
  'mostly-cloudy': 'Mostly cloudy',
  cloudy: 'Cloudy',
  haze: 'Haze',
  fog: 'Fog',
  drizzle: 'Drizzle',
  rain: 'Rain',
  thunderstorm: 'Thunderstorms',
  snow: 'Snow',
  sleet: 'Sleet',
  hail: 'Hail',
  wind: 'Windy',
  unknown: 'Weather',
}
export const weatherLabel = (c: WeatherCondition) => LABELS[c]

/** Whether two weather edits say the same thing (null = no weather, `auto` = refetch on save). */
export function sameWeather(a: WeatherEdit | null, b: WeatherEdit | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if ('auto' in a || 'auto' in b) return 'auto' in a && 'auto' in b
  return a.condition === b.condition && a.tempC === b.tempC && a.isDay === b.isDay
}

/**
 * What an entry's weather becomes when its place or time changes. Weather nobody chose by hand
 * follows the move (it becomes `auto`, so the weather service's is fetched for the new place and time); weather
 * set by hand, or imported, stays. With no place left, followed weather is dropped.
 */
export function weatherAfterMove(
  prev: { location: Location | null; createdAt: number; weather: WeatherEdit | null },
  next: { location: Location | null; createdAt: number },
  baselineWeather: WeatherEdit | null,
  baselineSource: WeatherSource | null,
): WeatherEdit | null {
  const moved = !sameLocation(prev.location, next.location) || prev.createdAt !== next.createdAt
  if (!moved) return prev.weather
  const w = prev.weather
  const follows =
    w === null || 'auto' in w || (isAutoWeather(baselineSource) && sameWeather(w, baselineWeather))
  if (!follows) return w
  return next.location ? { auto: true } : null
}
