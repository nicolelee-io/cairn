import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A hover help bubble for an element that already has its own accessible name (the bubble is
 * `aria-hidden`, so a screen reader never hears it twice). Spread `bind` on the element and render
 * `node` inside it. Mouse only (touch has no hover, and a stray bubble after a tap is worse than
 * none), plus keyboard focus. It is a `popover`, so it sits in the top layer above a modal dialog and
 * is never clipped by a card's overflow.
 */
export function useTip(text: string | null | undefined): {
  bind: {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void
    onPointerLeave: () => void
    onPointerDown: () => void
  }
  node: ReactNode
} {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const bubble = useRef<HTMLDivElement>(null)
  const hide = () => {
    clearTimeout(timer.current)
    setRect(null)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  // Above the element, centred, kept inside the window; below it when there is no room above.
  useLayoutEffect(() => {
    const el = bubble.current
    if (!el || !rect) return
    el.showPopover()
    const { width, height } = el.getBoundingClientRect()
    const edge = 8
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, edge),
      innerWidth - width - edge,
    )
    const above = rect.top - height - 6
    el.style.left = `${left}px`
    el.style.top = `${above >= edge ? above : rect.bottom + 6}px`
    el.style.visibility = 'visible'
  }, [rect])

  if (!text)
    return { bind: { onPointerEnter() {}, onPointerLeave() {}, onPointerDown() {} }, node: null }
  return {
    bind: {
      onPointerEnter: (e) => {
        if (e.pointerType !== 'mouse') return
        const target = e.currentTarget
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setRect(target.getBoundingClientRect()), 350)
      },
      onPointerLeave: hide,
      onPointerDown: hide,
    },
    node: rect && (
      <div
        ref={bubble}
        popover="manual"
        aria-hidden="true"
        style={{ visibility: 'hidden' }}
        className="pointer-events-none fixed inset-auto m-0 w-max max-w-64 rounded-md bg-inverse-surface px-2.5 py-1.5 text-sm font-normal text-inverse-on-surface shadow-md"
      >
        {text}
      </div>
    ),
  }
}
