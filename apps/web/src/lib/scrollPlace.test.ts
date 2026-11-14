import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { placeScroll, type Scroller } from './scrollPlace.ts'

/** A scroller whose page is `height` tall (viewport 0), like a list still loading. */
function fake(height: number) {
  let y = 0
  const size = new Set<() => void>()
  const user = new Set<() => void>()
  const s: Scroller & { height: number; grow(h: number): void; touch(): void } = {
    height,
    get: () => y,
    set: (v) => void (y = Math.max(0, Math.min(v, s.height))),
    watchSize: (cb) => (size.add(cb), () => void size.delete(cb)),
    watchUser: (cb) => (user.add(cb), () => void user.delete(cb)),
    grow(h) {
      s.height = h
      size.forEach((cb) => cb())
    },
    touch: () => user.forEach((cb) => cb()),
  }
  return s
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('placeScroll', () => {
  it('is done at once when the page is already tall enough', () => {
    const s = fake(5000)
    const p = placeScroll(s, 1200)
    expect(s.get()).toBe(1200)
    expect(p.pending()).toBe(false)
  })

  it('keeps trying as the content grows, and stays pending until it gets there', () => {
    const s = fake(300)
    const p = placeScroll(s, 1200)
    expect(s.get()).toBe(300)
    expect(p.pending()).toBe(true)
    s.grow(800)
    expect(p.pending()).toBe(true)
    s.grow(2000)
    expect(s.get()).toBe(1200)
    expect(p.pending()).toBe(false)
  })

  it('stops trying once the user scrolls for themselves', () => {
    const s = fake(300)
    const p = placeScroll(s, 1200)
    s.touch()
    expect(p.pending()).toBe(false)
    s.grow(2000)
    expect(s.get()).toBe(300)
  })

  it('gives up after a while', () => {
    const s = fake(300)
    const p = placeScroll(s, 1200)
    vi.advanceTimersByTime(5001)
    expect(p.pending()).toBe(false)
    s.grow(2000)
    expect(s.get()).toBe(300)
  })

  it('can be cancelled', () => {
    const s = fake(300)
    const p = placeScroll(s, 1200)
    p.cancel()
    s.grow(2000)
    expect(s.get()).toBe(300)
  })
})
