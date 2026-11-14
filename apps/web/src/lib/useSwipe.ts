import { useRef, type CSSProperties, type PointerEvent } from 'react'

/** How far a finger must travel sideways to count as a swipe. */
export const SWIPE_PX = 50
/** A quick flick counts from this far, if it is at least FLICK_SPEED fast (px per ms). */
export const FLICK_PX = 24
export const FLICK_SPEED = 0.4
/** The move must be this many times wider than tall, so a diagonal scroll isn't a swipe. */
const AXIS_RATIO = 1.5
/** Before this much sideways travel a touch is still a tap, and `onDrag` stays quiet. */
const DRAG_SLOP_PX = 10
/** A touch starting this close to the screen's side edge is left to the system (iOS back swipe). */
export const EDGE_PX = 24

/** Which way the finger went. A swipe `left` moves the content left, towards the next item. */
export type SwipeDirection = 'left' | 'right'

/**
 * The swipe a finger's total movement makes, or null when it was too short or too slanted. A move
 * of `elapsedMs` that is fast enough counts from a shorter distance (a flick).
 */
export function swipeOf(dx: number, dy: number, elapsedMs = Infinity): SwipeDirection | null {
  const far = Math.abs(dx)
  const flick = far >= FLICK_PX && far / Math.max(elapsedMs, 1) >= FLICK_SPEED
  if ((far < SWIPE_PX && !flick) || far < Math.abs(dy) * AXIS_RATIO) return null
  return dx < 0 ? 'left' : 'right'
}

export const startsAtEdge = (x: number, width: number): boolean =>
  x < EDGE_PX || x > width - EDGE_PX

/** Whether `el` scrolls sideways itself (a strip, a wide table), so a swipe on it is its own. */
function scrollsSideways(el: Element): boolean {
  if (el.scrollWidth <= el.clientWidth) return false
  const overflow = getComputedStyle(el).overflowX
  return overflow === 'auto' || overflow === 'scroll'
}

/** True when something between the touch and the swiping element wants the sideways movement. */
function claimedByInner(target: EventTarget, root: HTMLElement): boolean {
  for (
    let el = target instanceof Element ? target : null;
    el && el !== root;
    el = el.parentElement
  ) {
    if (el.hasAttribute('data-no-swipe') || scrollsSideways(el)) return true
  }
  return false
}

interface SwipeOptions {
  enabled?: boolean
  /**
   * Called as the finger moves sideways (after the first few pixels), with how far it is from where
   * it went down, so the content can follow it. Called with null when the touch ends without a
   * swipe (or is cancelled): put the content back. A touch that ends in a swipe calls `onSwipe`
   * instead and no null.
   */
  onDrag?: (dx: number | null) => void
}

/**
 * Horizontal swipes on touch screens. Spread the result on the element that should swipe; it only
 * acts on touch, so a mouse drag does nothing. It sets `touch-action: pan-y pinch-zoom`, so the
 * browser keeps vertical scrolling and zoom and hands the sideways movement to us (a finger that
 * starts a vertical scroll is cancelled by the browser and never counts).
 *
 * A swipe is ignored when it starts at the screen's side edge, inside something that scrolls
 * sideways itself, or inside an element marked `data-no-swipe` (a map, a text editor). The swipe is
 * judged on release (distance or speed); `onSwipe` runs once.
 */
export function useSwipe(
  onSwipe: (direction: SwipeDirection) => void,
  { enabled = true, onDrag }: SwipeOptions = {},
) {
  const start = useRef<{ x: number; y: number; t: number; dragging: boolean } | null>(null)
  if (!enabled) return {}
  const style: CSSProperties = { touchAction: 'pan-y pinch-zoom' }
  const stop = () => {
    if (start.current?.dragging) onDrag?.(null)
    start.current = null
  }
  return {
    style,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      start.current = null
      if (e.pointerType !== 'touch' || !e.isPrimary) return
      if (startsAtEdge(e.clientX, window.innerWidth)) return
      if (claimedByInner(e.target, e.currentTarget)) return
      start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, dragging: false }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const s = start.current
      if (!s) return
      const dx = e.clientX - s.x
      if (!s.dragging) {
        const dy = e.clientY - s.y
        if (Math.abs(dx) < DRAG_SLOP_PX || Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) return
        s.dragging = true
      }
      onDrag?.(dx)
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const s = start.current
      if (!s) return
      const direction = swipeOf(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t)
      if (!direction) return stop()
      start.current = null
      onSwipe(direction)
    },
    onPointerCancel: stop,
  }
}
