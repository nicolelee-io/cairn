import { useRef } from 'react'
import { flushSync } from 'react-dom'
import { tick } from './haptics.ts'
import { useSwipe, type SwipeDirection } from './useSwipe.ts'

/** How much of the way a finger drags the content when there is nowhere to go (a rubber band). */
const RESISTANCE = 0.25
const SLIDE_OUT_MS = 140
const SLIDE_IN_MS = 220
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A swipe that moves one block of content, for a view that changes in place (Insights' range and
 * month). Put `ref` on the block that moves and spread `swipe` on a container around it (the
 * header stays put). The block follows the finger (a rubber band when `canGo` says no); on a swipe
 * it slides out, `go` changes the content, and the new content slides in from the other side.
 * `go` runs synchronously (`flushSync`), so no frame shows the new content at rest. Touch only;
 * `prefers-reduced-motion` skips the slides. `EntriesPane` does the same for the Entries views.
 */
export function useSlideSwipe<T extends HTMLElement>(
  go: (direction: SwipeDirection) => void,
  canGo: (direction: SwipeDirection) => boolean,
) {
  const ref = useRef<T>(null)

  const follow = (dx: number) => {
    const el = ref.current
    if (!el) return
    const moved = canGo(dx < 0 ? 'left' : 'right') ? dx : dx * RESISTANCE
    el.style.transform = `translateX(${moved}px)`
    el.style.opacity = String(1 - Math.min(Math.abs(moved) / el.offsetWidth, 1) * 0.6)
  }

  // Back to rest from wherever the finger let go.
  const settle = () => {
    const el = ref.current
    if (!el) return
    const { transform, opacity } = el.style
    el.style.transform = ''
    el.style.opacity = ''
    if (!transform || reducedMotion()) return
    el.animate(
      [
        { transform, opacity: opacity || 1 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: SLIDE_IN_MS, easing: EASE },
    )
  }

  const swipe = useSwipe(
    (direction) => {
      const el = ref.current
      if (!el || !canGo(direction)) return settle()
      tick()
      if (reducedMotion()) {
        el.style.transform = ''
        el.style.opacity = ''
        return go(direction)
      }
      const sign = direction === 'left' ? -1 : 1
      const out = el.animate(
        [
          { transform: el.style.transform || 'none', opacity: el.style.opacity || 1 },
          { transform: `translateX(${sign * 100}%)`, opacity: 0 },
        ],
        { duration: SLIDE_OUT_MS, easing: 'ease-in', fill: 'forwards' },
      )
      out.onfinish = () => {
        flushSync(() => go(direction))
        out.cancel()
        el.style.transform = ''
        el.style.opacity = ''
        el.animate(
          [
            { transform: `translateX(${-sign * el.offsetWidth * 0.35}px)`, opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: SLIDE_IN_MS, easing: EASE },
        )
      }
    },
    { onDrag: (dx) => (dx === null ? settle() : follow(dx)) },
  )

  return { ref, swipe }
}
