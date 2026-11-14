import { describe, expect, it } from 'vitest'
import { bareLocation, locationLabel, sameLocation } from './location.ts'

describe('location helpers', () => {
  it('compares by value, with null as no place', () => {
    const a = bareLocation(1, 2)
    expect(sameLocation(a, { ...a })).toBe(true)
    expect(sameLocation(a, { ...a, placeName: 'x' })).toBe(false)
    expect(sameLocation(a, null)).toBe(false)
    expect(sameLocation(null, null)).toBe(true)
  })
  it('labels by name, falling back to coordinates', () => {
    expect(locationLabel({ ...bareLocation(1, 2), placeName: 'Park', locality: 'Town' })).toBe(
      'Park, Town',
    )
    expect(locationLabel(bareLocation(1.23456, -2))).toBe('1.235, -2.000')
  })
})
