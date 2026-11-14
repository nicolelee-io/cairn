import { describe, expect, it } from 'vitest'
import { cToUnit, unitToC } from './tempUnit.ts'

describe('temperature units', () => {
  it('converts both ways', () => {
    expect(cToUnit(0, 'F')).toBe(32)
    expect(cToUnit(100, 'F')).toBe(212)
    expect(cToUnit(21, 'C')).toBe(21)
    expect(unitToC(68, 'F')).toBeCloseTo(20)
    expect(unitToC(20, 'C')).toBe(20)
  })
})
