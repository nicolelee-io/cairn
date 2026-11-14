import { describe, expect, it } from 'vitest'
import { mapDayOneWeather } from './weather.ts'

describe('mapDayOneWeather', () => {
  it.each([
    ['Clear', 'clear', null],
    ['clear', 'clear', null],
    ['MostlyClear', 'mostly-clear', null],
    ['PartlyCloudy', 'partly-cloudy', null],
    ['Thunderstorms', 'thunderstorm', null],
    ['Windy', 'wind', null],
    ['Haze', 'haze', null],
    ['partly-cloudy-night', 'partly-cloudy', false],
    ['clear-day', 'clear', true],
    ['fog', 'fog', null],
    ['SomethingNew', 'unknown', null],
  ])('%s -> %s', (code, condition, isDay) => {
    expect(mapDayOneWeather(code)).toEqual({ condition, isDay })
  })
})
