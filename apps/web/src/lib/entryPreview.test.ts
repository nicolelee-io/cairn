import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '@cairn/shared'
import { neighbourIn, readList, withList } from './entryPreview.ts'

const item = (id: string, createdAt: number) =>
  ({ id, createdAt, timezone: 'UTC', allDay: false, title: id }) as TimelineItem

describe('an entry opened from a fixed list', () => {
  const a = item('a', 1000)
  const b = item('b', 3000)
  const c = item('c', 2000)

  it('carries the list newest first alongside the preview', () => {
    const state = withList(a, [a, b, c])
    expect(state.preview.title).toBe('a')
    expect(readList(state)?.map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('finds the older and newer neighbour, and stops at the ends', () => {
    const list = readList(withList(a, [a, b, c]))!
    expect(neighbourIn(list, 'c', 1)?.id).toBe('a')
    expect(neighbourIn(list, 'c', -1)?.id).toBe('b')
    expect(neighbourIn(list, 'a', 1)).toBeNull()
    expect(neighbourIn(list, 'b', -1)).toBeNull()
    expect(neighbourIn(list, 'missing', 1)).toBeNull()
  })

  it('reads no list from a plain card link or an empty one', () => {
    expect(readList(null)).toBeNull()
    expect(readList({ preview: {} })).toBeNull()
    expect(readList({ list: [] })).toBeNull()
  })
})
