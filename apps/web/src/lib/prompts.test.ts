import { describe, expect, it } from 'vitest'
import type { Prompt, PromptCategory, SuggestedPrompt } from '@cairn/shared'
import { groupSuggested, promptHeading, savedSourceIds } from './prompts.ts'

const cat = (id: string, position: number): PromptCategory => ({
  id,
  name: id,
  icon: 'star',
  position,
})
const sug = (id: string, categoryId: string | null): SuggestedPrompt => ({
  id,
  text: id,
  categoryId,
})

describe('groupSuggested', () => {
  it('groups by category in the admin order, then the uncategorized', () => {
    const groups = groupSuggested(
      [sug('a1', 'a'), sug('loose', null), sug('b1', 'b'), sug('a2', 'a')],
      [cat('b', 1), cat('a', 0)],
    )
    expect(groups.map((g) => g.category?.id ?? null)).toEqual(['a', 'b', null])
    expect(groups[0]!.prompts.map((p) => p.id)).toEqual(['a1', 'a2'])
  })

  it('leaves empty categories out and keeps a deleted category’s prompts as uncategorized', () => {
    const groups = groupSuggested([sug('x', 'gone'), sug('y', null)], [cat('empty', 0)])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.category).toBeNull()
    expect(groups[0]!.prompts.map((p) => p.id)).toEqual(['x', 'y'])
  })

  it('is empty for nothing', () => {
    expect(groupSuggested([], [cat('a', 0)])).toEqual([])
  })
})

describe('savedSourceIds', () => {
  it('collects the suggested ids that have a copy', () => {
    const mine = [
      { id: '1', sourcePromptId: 's1' },
      { id: '2', sourcePromptId: null },
    ] as Prompt[]
    expect([...savedSourceIds(mine)]).toEqual(['s1'])
    expect(savedSourceIds(undefined).size).toBe(0)
  })
})

describe('promptHeading', () => {
  it('is the prompt as a heading, then a blank line for the body', () => {
    expect(promptHeading('What am I avoiding, and why?')).toBe('# What am I avoiding, and why?\n\n')
  })

  it('keeps a pasted link from putting line breaks or markup breaks in the title', () => {
    expect(promptHeading('  two\nlines\t here  ')).toBe('# two lines here\n\n')
  })

  it('is capped at the prompt length', () => {
    expect(promptHeading('x'.repeat(500))).toBe(`# ${'x'.repeat(200)}\n\n`)
  })
})
