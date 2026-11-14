import { describe, expect, it } from 'vitest'
import {
  DISMISS_PX,
  ZOOM,
  DRAG_MAX_ZOOM,
  clampPan,
  dismissOf,
  dragZoomScale,
  isDoubleTap,
  panLimit,
  zoomScale,
  zoomTranslate,
} from './lightboxGestures.ts'

describe('dismissOf', () => {
  it('closes on a long pull either way', () => {
    expect(dismissOf(DISMISS_PX, 800)).toBe(true)
    expect(dismissOf(-DISMISS_PX - 1, 800)).toBe(true)
  })
  it('closes on a short quick flick, not a short slow pull', () => {
    expect(dismissOf(60, 80)).toBe(true)
    expect(dismissOf(60, 400)).toBe(false)
    expect(dismissOf(20, 10)).toBe(false) // too short even when fast
  })
})

describe('pan limits', () => {
  it('lets a zoomed photo move by half of what overhangs the stage', () => {
    expect(panLimit(400, 2.5, 400)).toBe(300) // 1000 wide on a 400 stage
    expect(clampPan(500, 400, 2.5, 400)).toBe(300)
    expect(clampPan(-500, 400, 2.5, 400)).toBe(-300)
    expect(clampPan(120, 400, 2.5, 400)).toBe(120)
  })
  it('keeps a photo that still fits (a wide stage, a short photo) centred', () => {
    expect(panLimit(300, 1.2, 800)).toBe(0)
    expect(clampPan(50, 300, 1.2, 800)).toBe(0)
  })
})

describe('zoomTranslate', () => {
  it('keeps the tapped point still: scale * p + t = p', () => {
    for (const p of [-150, 0, 80]) {
      expect(ZOOM * p + zoomTranslate(p, ZOOM)).toBeCloseTo(p)
    }
  })
})

describe('zoomScale', () => {
  it('is 2.5x when that already overhangs the screen', () => {
    // A 1200x900 photo on a 1400x900 desktop stage: fits as it is.
    expect(zoomScale({ width: 1200, height: 900 }, { width: 1400, height: 900 })).toBe(ZOOM)
    // A portrait photo filling a phone.
    expect(zoomScale({ width: 300, height: 800 }, { width: 412, height: 800 })).toBe(ZOOM)
  })
  it('zooms further so a landscape photo on a portrait phone can move up and down', () => {
    const photo = { width: 412, height: 309 } // 4:3, fitted to the phone's width
    const stage = { width: 412, height: 800 }
    const scale = zoomScale(photo, stage)
    expect(scale).toBeGreaterThan(ZOOM)
    expect(panLimit(photo.width, scale, stage.width)).toBeGreaterThan(0)
    expect(panLimit(photo.height, scale, stage.height)).toBeGreaterThan(0)
  })
  it('stops somewhere for a panorama', () => {
    expect(zoomScale({ width: 412, height: 100 }, { width: 412, height: 800 })).toBe(6)
  })
})

describe('isDoubleTap', () => {
  const a = { x: 100, y: 100, t: 1000 }
  it('needs two taps close in time and place', () => {
    expect(isDoubleTap(a, { x: 110, y: 105, t: 1200 })).toBe(true)
    expect(isDoubleTap(a, { x: 110, y: 105, t: 1400 })).toBe(false)
    expect(isDoubleTap(a, { x: 200, y: 100, t: 1100 })).toBe(false)
  })
})

describe('dragZoomScale', () => {
  it('zooms in as the finger goes down and out as it comes up, from where it started', () => {
    expect(dragZoomScale(1, 0)).toBe(1)
    expect(dragZoomScale(1, 100)).toBeGreaterThan(1)
    expect(dragZoomScale(3, -100)).toBeLessThan(3)
    expect(dragZoomScale(3, -100)).toBeGreaterThan(1)
  })
  it('stays between fit and the maximum', () => {
    expect(dragZoomScale(1, -500)).toBe(1)
    expect(dragZoomScale(4, 2000)).toBe(DRAG_MAX_ZOOM)
  })
})
