import { describe, expect, it } from 'vitest'
import { bareLocation } from './location.ts'
import { sameWeather, weatherAfterMove } from './weather.ts'

describe('sameWeather', () => {
  const w = { condition: 'rain' as const, tempC: 12, isDay: null }
  it('compares by value, with null and auto distinct', () => {
    expect(sameWeather(w, { ...w })).toBe(true)
    expect(sameWeather(w, { ...w, tempC: 13 })).toBe(false)
    expect(sameWeather(w, null)).toBe(false)
    expect(sameWeather(null, null)).toBe(true)
    expect(sameWeather({ auto: true }, { auto: true })).toBe(true)
    expect(sameWeather({ auto: true }, w)).toBe(false)
    expect(sameWeather({ auto: true }, null)).toBe(false)
  })
})

describe('weatherAfterMove', () => {
  const place = bareLocation(1, 2)
  const manual = { condition: 'rain' as const, tempC: 12, isDay: null }
  const prev = { location: null, createdAt: 1000, weather: null }

  it('makes unchosen weather automatic when a place is added or the time moves', () => {
    expect(weatherAfterMove(prev, { location: place, createdAt: 1000 }, null, null)).toEqual({
      auto: true,
    })
    const withPlace = { location: place, createdAt: 1000, weather: { auto: true as const } }
    expect(weatherAfterMove(withPlace, { location: place, createdAt: 2000 }, null, null)).toEqual({
      auto: true,
    })
  })
  it('leaves things alone when nothing moved, and drops followed weather with the place', () => {
    expect(weatherAfterMove(prev, { location: null, createdAt: 1000 }, null, null)).toBeNull()
    const auto = { location: place, createdAt: 1000, weather: { auto: true as const } }
    expect(weatherAfterMove(auto, { location: place, createdAt: 1000 }, null, null)).toEqual({
      auto: true,
    })
    expect(weatherAfterMove(auto, { location: null, createdAt: 1000 }, null, null)).toBeNull()
  })
  it('keeps hand-entered and imported weather, but follows Google weather', () => {
    const entered = { location: place, createdAt: 1000, weather: manual }
    expect(
      weatherAfterMove(entered, { location: bareLocation(3, 4), createdAt: 1000 }, null, null),
    ).toBe(manual)
    expect(
      weatherAfterMove(
        entered,
        { location: bareLocation(3, 4), createdAt: 1000 },
        manual,
        'dayone',
      ),
    ).toBe(manual)
    expect(
      weatherAfterMove(
        entered,
        { location: bareLocation(3, 4), createdAt: 1000 },
        manual,
        'google',
      ),
    ).toEqual({ auto: true })
  })
})
