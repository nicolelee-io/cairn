import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'

/** Moves the item at `from` to `to`; out-of-range targets leave the list as it is. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = list.slice()
  next.splice(to, 0, next.splice(from, 1)[0]!)
  return next
}

interface Drag {
  id: string
  from: number
  to: number
  dy: number
}

/**
 * Reordering by mouse, touch or keyboard. The caller renders `order`, puts `rowRef(id)` and
 * `style(id)` on each row and `handleProps(id)` on a button inside it (the handle needs
 * `touch-none`, or the page scrolls instead of the row moving).
 *
 * A pointer drag never reorders the DOM (moving the captured button would drop the pointer): the
 * dragged row follows the pointer and the rows it passes slide aside with a transform; the list
 * is reordered once, on release. Arrow keys on the focused handle move the row at once and commit
 * after a short pause.
 */
export function useReorder(ids: string[], commit: (order: string[]) => void) {
  const [keys, setKeys] = useState<string[] | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const rows = useRef(new Map<string, HTMLElement>())
  const start = useRef<{ y: number; tops: number[]; mids: number[]; shift: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const keysRef = useRef<string[] | null>(null)
  const refocus = useRef<string | null>(null)

  const order = keys ?? ids
  const setKeyOrder = (next: string[] | null) => {
    keysRef.current = next
    setKeys(next)
  }

  // Moving a row's node in the DOM drops its focus; put it back on the grip after a key move.
  useLayoutEffect(() => {
    if (refocus.current)
      rows.current.get(refocus.current)?.querySelector<HTMLElement>('[data-grip]')?.focus()
  }, [keys])

  function flushKeys() {
    clearTimeout(timer.current)
    const done = keysRef.current
    refocus.current = null
    setKeyOrder(null)
    if (done && done.join() !== ids.join()) commit(done)
  }

  function onPointerDown(e: PointerEvent<HTMLElement>, id: string) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rects = order.map((o) => rows.current.get(o)?.getBoundingClientRect())
    if (rects.some((r) => !r)) return
    const r = rects as DOMRect[]
    const from = order.indexOf(id)
    // One row's height plus the gap between rows: how far a passed row slides.
    const gap = r.length > 1 ? Math.max(0, r[1]!.top - r[0]!.bottom) : 0
    start.current = {
      y: e.clientY,
      tops: r.map((x) => x.top),
      mids: r.map((x) => x.top + x.height / 2),
      shift: r[from]!.height + gap,
    }
    setDrag({ id, from, to: from, dy: 0 })
  }

  function onPointerMove(e: PointerEvent, id: string) {
    const s = start.current
    if (!s || drag?.id !== id) return
    const dy = e.clientY - s.y
    // Where the dragged row's middle now sits among the others' original middles.
    const centre = s.mids[drag.from]! + dy
    const to = s.mids.filter((m, i) => i !== drag.from && m < centre).length
    setDrag({ ...drag, to, dy })
  }

  function onPointerUp(id: string) {
    if (!drag || drag.id !== id) return
    const { from, to } = drag
    start.current = null
    setDrag(null)
    if (from !== to) commit(move(order, from, to))
  }

  return {
    order,
    draggingId: drag?.id ?? null,
    rowRef: (id: string) => (el: HTMLElement | null) => {
      if (el) rows.current.set(id, el)
      else rows.current.delete(id)
    },
    /** The transform that shows a drag in progress (undefined when there is none). */
    style(id: string): CSSProperties | undefined {
      const s = start.current
      if (!drag || !s) return undefined
      const i = order.indexOf(id)
      if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, zIndex: 1 }
      const slide =
        i > drag.from && i <= drag.to ? -s.shift : i < drag.from && i >= drag.to ? s.shift : 0
      return { transform: `translateY(${slide}px)`, transition: 'transform 150ms' }
    },
    handleProps: (id: string) => ({
      'data-grip': '',
      onPointerDown: (e: PointerEvent<HTMLElement>) => onPointerDown(e, id),
      onPointerMove: (e: PointerEvent) => onPointerMove(e, id),
      onPointerUp: () => onPointerUp(id),
      onPointerCancel() {
        start.current = null
        setDrag(null)
      },
      onKeyDown(e: KeyboardEvent) {
        const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
        if (!step) return
        e.preventDefault()
        const current = keysRef.current ?? ids
        refocus.current = id
        setKeyOrder(move(current, current.indexOf(id), current.indexOf(id) + step))
        clearTimeout(timer.current)
        timer.current = setTimeout(flushKeys, 600)
      },
    }),
  }
}
