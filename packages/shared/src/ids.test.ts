import { describe, expect, it } from 'vitest'
import { uuidv7 } from './ids.ts'

describe('uuidv7', () => {
  it('has the v7 layout and embeds the timestamp', () => {
    const now = Date.UTC(2026, 9, 29, 12, 0, 0)
    const id = uuidv7(now)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(now)
  })

  it('sorts by time', () => {
    expect(uuidv7(1_000_000) < uuidv7(2_000_000)).toBe(true)
  })
})
