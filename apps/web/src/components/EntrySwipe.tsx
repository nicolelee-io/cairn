import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { TimelineItem } from '@cairn/shared'
import { useEntryFlip } from '../lib/useEntryFlip.ts'
import { useSwipe } from '../lib/useSwipe.ts'

/** How much of the way a finger drags the entry when there is no neighbour that way (a rubber band). */
const RESISTANCE = 0.25
const SLIDE_OUT_MS = 140
const SLIDE_IN_MS = 220
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The full-page reader, swipeable on a touch screen: the entry follows a sideways drag, and
 * letting go on a swipe slides it away and the older entry (finger moved left) or the newer one
 * (finger moved right) in, following the list as it is shown, like the keyboard's j/k. Not used
 * by the popup, which has no older/newer. The Lightbox inside is `data-no-swipe`, so its own drags
 * don't turn the page.
 */
export function EntrySwipe({ id, children }: { id: string; children: ReactNode }) {
  const { neighbour, open } = useEntryFlip(id)
  const el = useRef<HTMLDivElement>(null)
  const leaving = useRef<Animation | null>(null)
  const shown = useRef(id)
  // Which way the page went, so the next entry arrives from the other side; 0 = no slide (a key press).
  const went = useRef<-1 | 0 | 1>(0)
  // Looked up when a drag begins, so by the time the finger lifts the answer is usually there.
  const near = useRef<{ older: Promise<TimelineItem | null>; newer: Promise<TimelineItem | null> }>(
    null,
  )
  const has = useRef({ older: true, newer: true })

  // A different entry (after a swipe or a key): it arrives from the side the old one left towards.
  useLayoutEffect(() => {
    if (shown.current === id) return
    shown.current = id
    const dir = went.current
    went.current = 0
    leaving.current?.cancel()
    leaving.current = null
    const e = el.current
    if (!e) return
    e.style.transform = ''
    e.style.opacity = ''
    if (!dir || reducedMotion()) return
    e.animate(
      [
        { transform: `translateX(${-dir * e.offsetWidth * 0.35}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: SLIDE_IN_MS, easing: EASE },
    )
  }, [id])

  const lookUp = () => {
    if (near.current) return
    const older = neighbour(1)
    const newer = neighbour(-1)
    near.current = { older, newer }
    has.current = { older: true, newer: true }
    void older.then((n) => (has.current.older = !!n))
    void newer.then((n) => (has.current.newer = !!n))
  }

  const follow = (dx: number) => {
    const e = el.current
    if (!e) return
    lookUp()
    const there = dx < 0 ? has.current.older : has.current.newer
    const moved = there ? dx : dx * RESISTANCE
    e.style.transform = `translateX(${moved}px)`
    e.style.opacity = String(1 - Math.min(Math.abs(moved) / e.offsetWidth, 1) * 0.6)
  }

  /** Back to rest from wherever the finger let go. */
  const settle = () => {
    near.current = null
    const e = el.current
    if (!e) return
    const { transform, opacity } = e.style
    e.style.transform = ''
    e.style.opacity = ''
    if (!transform || reducedMotion()) return
    e.animate(
      [
        { transform, opacity: opacity || 1 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: SLIDE_IN_MS, easing: EASE },
    )
  }

  const swipe = useSwipe(
    async (direction) => {
      lookUp()
      const lookup = near.current
      near.current = null
      const next = await (direction === 'left' ? lookup?.older : lookup?.newer)
      const e = el.current
      if (!next || !e) return settle()
      if (reducedMotion()) return open(next)
      const dir = direction === 'left' ? -1 : 1
      went.current = dir
      // Slide this entry off from where the finger left it; the layout effect above takes over once
      // the next entry is in place, so there is no frame of the old one at rest in between.
      const out = e.animate(
        [
          { transform: e.style.transform || 'none', opacity: e.style.opacity || 1 },
          { transform: `translateX(${dir * 100}%)`, opacity: 0 },
        ],
        { duration: SLIDE_OUT_MS, easing: 'ease-in', fill: 'forwards' },
      )
      leaving.current = out
      out.onfinish = () => open(next)
    },
    { onDrag: (dx) => (dx === null ? settle() : follow(dx)) },
  )

  // min-h: a short entry still takes a swipe in the space under its text.
  return (
    <div ref={el} {...swipe} className="min-h-[60dvh]">
      {children}
    </div>
  )
}
