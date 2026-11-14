import { describe, expect, it } from 'vitest'
import { formatBytes } from './bytes.ts'

describe('formatBytes', () => {
  it('uses decimal units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1500)).toBe('1.5 KB')
    expect(formatBytes(48_000_000)).toBe('48 MB')
    expect(formatBytes(3_200_000_000)).toBe('3.2 GB')
  })
})
