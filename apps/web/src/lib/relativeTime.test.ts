import { describe, expect, it } from 'vitest'
import { ago } from './relativeTime.ts'

const NOW = Date.UTC(2026, 9, 30, 12)
const MIN = 60 * 1000

describe('ago', () => {
  it('says how long ago, in the largest whole unit', () => {
    expect(ago(NOW - 10_000, NOW)).toBe('just now')
    expect(ago(NOW - 5 * MIN, NOW)).toBe('5 minutes ago')
    expect(ago(NOW - 90 * MIN, NOW)).toBe('1 hour ago')
    expect(ago(NOW - 3 * 60 * MIN, NOW)).toBe('3 hours ago')
    expect(ago(NOW - 24 * 60 * MIN, NOW)).toBe('yesterday')
    expect(ago(NOW - 5 * 24 * 60 * MIN, NOW)).toBe('5 days ago')
  })

  it('treats a time slightly in the future (clock skew) as just now', () => {
    expect(ago(NOW + MIN, NOW)).toBe('just now')
  })
})
