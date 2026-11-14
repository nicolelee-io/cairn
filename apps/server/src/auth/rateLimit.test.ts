import { describe, expect, it } from 'vitest'
import { FailureLimiter } from './rateLimit.ts'

describe('FailureLimiter', () => {
  it('limits after max failures until the window passes, and reset clears it', () => {
    let t = 0
    const l = new FailureLimiter(2, 60_000, () => t)
    l.fail('k')
    expect(l.retryAfter('k')).toBe(0)
    l.fail('k')
    expect(l.retryAfter('k')).toBe(60)
    t = 30_000
    expect(l.retryAfter('k')).toBe(30)
    t = 60_000
    expect(l.retryAfter('k')).toBe(0)

    l.fail('k')
    l.fail('k')
    l.reset('k')
    expect(l.retryAfter('k')).toBe(0)
  })
})
