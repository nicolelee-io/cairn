import { describe, expect, it } from 'vitest'
import { builtLabel, shortSha, updateAvailable } from './appVersion.ts'

describe('updateAvailable', () => {
  it('is true only when two real builds differ', () => {
    expect(updateAvailable('aaa', 'bbb')).toBe(true)
    expect(updateAvailable('aaa', 'aaa')).toBe(false)
  })
  it('stays quiet for dev builds and an unknown server build', () => {
    expect(updateAvailable('dev', 'bbb')).toBe(false)
    expect(updateAvailable('aaa', 'dev')).toBe(false)
    expect(updateAvailable('aaa', undefined)).toBe(false)
  })
})

describe('labels', () => {
  it('shortens a sha and survives a missing or bad date', () => {
    expect(shortSha('7b739ec1234567')).toBe('7b739ec')
    expect(builtLabel(null)).toBe('unknown')
    expect(builtLabel('nope')).toBe('unknown')
    expect(builtLabel('2026-11-03T23:16:00Z')).toContain('2026')
  })
})
