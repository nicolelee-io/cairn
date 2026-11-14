import { describe, expect, it } from 'vitest'
import type { Journal } from '@cairn/shared'
import { quickJournals } from './menuActions.ts'

const j = (id: string, sortOrder: number, extra: Partial<Journal> = {}): Journal => ({
  id,
  name: id,
  color: null,
  icon: null,
  description: null,
  archivedAt: null,
  sortOrder,
  createdAt: 0,
  rev: 1,
  entryCount: 0,
  ...extra,
})

describe('quickJournals', () => {
  it('takes the first four active journals by sort order, then creation time', () => {
    const list = [
      j('e', 4),
      j('b', 1, { createdAt: 2 }),
      j('a', 1, { createdAt: 1 }),
      j('d', 3),
      j('c', 2),
    ]
    expect(quickJournals(list).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('skips archived journals', () => {
    const list = [j('a', 0, { archivedAt: 5 }), j('b', 1), j('c', 2)]
    expect(quickJournals(list).map((x) => x.id)).toEqual(['b', 'c'])
  })
  it('offers nothing when there is no choice', () => {
    expect(quickJournals([j('a', 0)])).toEqual([])
    expect(quickJournals([j('a', 0), j('b', 1, { archivedAt: 5 })])).toEqual([])
  })
})
