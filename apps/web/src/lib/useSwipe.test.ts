import { describe, expect, it } from 'vitest'
import { EDGE_PX, FLICK_PX, SWIPE_PX, startsAtEdge, swipeOf } from './useSwipe.ts'

describe('swipeOf', () => {
  it('names the direction of a clear sideways move', () => {
    expect(swipeOf(-120, 10)).toBe('left')
    expect(swipeOf(120, -10)).toBe('right')
  })

  it('ignores a slow move that is too short', () => {
    expect(swipeOf(SWIPE_PX - 1, 0)).toBeNull()
    expect(swipeOf(-(SWIPE_PX - 1), 0, 600)).toBeNull()
  })

  it('counts a short move that is a quick flick', () => {
    expect(swipeOf(-FLICK_PX, 0, 40)).toBe('left')
    expect(swipeOf(FLICK_PX + 10, 0, 60)).toBe('right')
    expect(swipeOf(FLICK_PX - 1, 0, 10)).toBeNull() // too short even when fast
    expect(swipeOf(30, 0, 400)).toBeNull() // long enough for a flick, but slow
  })

  it('ignores a move that is mostly vertical or diagonal', () => {
    expect(swipeOf(60, 100)).toBeNull()
    expect(swipeOf(60, 50)).toBeNull() // 60 < 50 * 1.5
    expect(swipeOf(80, 50)).toBe('right')
  })
})

describe('startsAtEdge', () => {
  it('is true only within the edge strip on either side', () => {
    expect(startsAtEdge(EDGE_PX - 1, 400)).toBe(true)
    expect(startsAtEdge(400 - EDGE_PX + 1, 400)).toBe(true)
    expect(startsAtEdge(EDGE_PX, 400)).toBe(false)
    expect(startsAtEdge(200, 400)).toBe(false)
  })
})
