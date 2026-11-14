import { describe, expect, it } from 'vitest'
import { densestArea } from './mapFocus.ts'

const at = (latitude: number, longitude: number, name = '') => ({ latitude, longitude, name })

describe('densestArea', () => {
  it('picks the biggest neighbourhood, not the whole globe', () => {
    const denver = [at(39.76, -104.98, 'a'), at(39.77, -104.99, 'b'), at(39.7, -105.1, 'c')]
    const pts = [at(51.5, -0.12, 'london'), ...denver, at(35.68, 139.65, 'tokyo')]
    expect(densestArea(pts).map((p) => p.name)).toEqual(['a', 'b', 'c'])
  })
  it('prefers the earlier (newer) pin on a tie, and handles one or none', () => {
    const pts = [at(51.5, -0.12, 'london'), at(35.68, 139.65, 'tokyo')]
    expect(densestArea(pts).map((p) => p.name)).toEqual(['london'])
    expect(densestArea([])).toEqual([])
    expect(densestArea([at(1, 1)])).toHaveLength(1)
  })
  it('counts the radius in kilometres, across the date line too', () => {
    const near = [at(0, 179.9, 'a'), at(0, -179.9, 'b')] // ~22 km apart
    expect(densestArea([...near, at(0, 100, 'far')]).map((p) => p.name)).toEqual(['a', 'b'])
  })
})
