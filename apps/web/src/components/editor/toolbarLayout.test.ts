import { describe, expect, it } from 'vitest'
import { foldedGroups, type ToolGroup } from './toolbarLayout.ts'

const groups: { id: ToolGroup; count: number }[] = [
  { id: 'heading', count: 3 },
  { id: 'styling', count: 4 },
  { id: 'blocks', count: 5 },
  { id: 'attach', count: 2 },
]

describe('foldedGroups', () => {
  it('keeps everything open when it fits', () => {
    expect(foldedGroups(900, groups).size).toBe(0)
  })
  it('folds the headings first, then the lists, then attachments, then the marks', () => {
    const at = (w: number) => [...foldedGroups(w, groups)]
    expect(at(560)).toEqual(['heading'])
    expect(at(480)).toEqual(['heading', 'blocks'])
    expect(at(330)).toEqual(['heading', 'blocks', 'attach'])
    expect(at(100)).toEqual(['heading', 'blocks', 'attach', 'styling'])
  })
  it('folds as little as it can', () => {
    // 14 buttons, 3 dividers, 16 gaps: 504 + 27 + 32
    expect(foldedGroups(563, groups).size).toBe(0)
    expect(foldedGroups(562, groups).size).toBe(1)
  })
})
