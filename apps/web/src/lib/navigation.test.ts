import { describe, expect, it } from 'vitest'
import { ancestorsOf, parentOf } from './navigation.ts'

describe('ancestorsOf', () => {
  it.each([
    ['/', []],
    ['/j/a', ['/']],
    ['/insights', ['/']],
    ['/search', ['/']],
    ['/settings', ['/']],
    ['/entry/e', ['/']],
    ['/new', ['/']],
    ['/j/a/entry/e', ['/', '/j/a']],
    ['/j/a/new', ['/', '/j/a']],
    ['/entry/e/edit', ['/', '/entry/e']],
    ['/j/a/entry/e/edit', ['/', '/j/a', '/j/a/entry/e']],
    ['/journals', ['/', '/settings']],
    ['/sync', ['/', '/settings']],
    ['/trash', ['/', '/settings']],
    ['/trash/e', ['/', '/settings', '/trash']],
    ['/prompts', ['/']],
    ['/prompts/all', ['/', '/prompts']],
    ['/prompts/suggested', ['/', '/prompts']],
    ['/settings/prompts', ['/', '/settings']],
    ['/settings/appearance', ['/', '/settings']],
    ['/settings/appearance/entry-text', ['/', '/settings', '/settings/appearance']],
    ['/storage/server', ['/', '/settings', '/storage']],
    ['/nowhere', ['/']],
  ])('%s', (path, chain) => {
    expect(ancestorsOf(path)).toEqual(chain)
  })

  it('parentOf is the nearest ancestor, and / for the root', () => {
    expect(parentOf('/j/a/entry/e/edit')).toBe('/j/a/entry/e')
    expect(parentOf('/tags')).toBe('/settings')
    expect(parentOf('/templates')).toBe('/settings')
    expect(parentOf('/')).toBe('/')
  })
})
