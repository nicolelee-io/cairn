import { describe, expect, it } from 'vitest'
import { describeImport, parseImport } from './promptImport.ts'

describe('describeImport', () => {
  it('lists what would change, leaving out zeros', () => {
    expect(
      describeImport({ newCategories: 2, newPrompts: 41, existingPrompts: 6, unknownIcons: 1 }),
    ).toBe(
      '2 new categories, 41 new prompts, 6 already there, 1 unknown icon (the default is used)',
    )
    expect(
      describeImport({ newCategories: 0, newPrompts: 1, existingPrompts: 0, unknownIcons: 0 }),
    ).toBe('1 new prompt')
  })

  it('says so when nothing is new', () => {
    expect(
      describeImport({ newCategories: 0, newPrompts: 0, existingPrompts: 5, unknownIcons: 0 }),
    ).toBe('Nothing new: it is all there already.')
  })
})

describe('parseImport', () => {
  it('accepts the documented shape', () => {
    const r = parseImport(
      JSON.stringify({
        categories: [{ name: ' Reflection ', icon: 'psychology', prompts: ['Hi'] }],
      }),
    )
    expect(r).toEqual({
      ok: true,
      file: { categories: [{ name: 'Reflection', icon: 'psychology', prompts: ['Hi'] }] },
    })
  })

  it('names the problem for bad JSON and for a wrong shape', () => {
    expect(parseImport('{nope')).toEqual({ ok: false, error: 'That isn’t valid JSON.' })
    const wrong = parseImport('{"categories":[{"name":"A","prompts":[""]}]}')
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.error).toContain('categories › 0 › prompts › 0')
    expect(parseImport('[]').ok).toBe(false)
  })

  it('rejects more prompts than an import may hold', () => {
    const prompts = Array.from({ length: 501 }, (_, i) => `p${i}`)
    expect(parseImport(JSON.stringify({ categories: [{ name: 'Big', prompts }] })).ok).toBe(false)
  })
})
