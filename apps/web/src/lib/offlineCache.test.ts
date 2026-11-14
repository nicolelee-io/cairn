import { describe, expect, it } from 'vitest'
import { staleAssetPaths } from './offlineCache.ts'

describe('staleAssetPaths', () => {
  it('returns cached assets the current build lacks', () => {
    expect(
      staleAssetPaths(['/assets/a-1.js', '/assets/a-2.js', '/assets/font-9.woff2'], [
        '/assets/a-2.js',
        '/assets/font-9.woff2',
      ]),
    ).toEqual(['/assets/a-1.js'])
  })

  it('never touches anything outside /assets', () => {
    expect(staleAssetPaths(['/api/avatar', '/'], ['/assets/a.js'])).toEqual([])
  })
})
