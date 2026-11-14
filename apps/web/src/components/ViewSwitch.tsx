import { useLayoutEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { BROWSE_VIEWS, useBrowseView, type BrowseView } from '../lib/browseView.ts'
import { cn } from '../lib/cn.ts'
import { radioKeys } from '../lib/moveFocus.ts'
import { useChooseView } from '../lib/useChooseView.ts'
import { Icon } from './Icon.tsx'

const LABELS: Record<BrowseView, string> = {
  details: 'Details',
  list: 'List',
  calendar: 'Calendar',
  media: 'Media',
  map: 'Map',
}

/**
 * The Entries screen's view selector: a pill-shaped segmented control in its own row under the top
 * bar, so it has room for more views (Details is an icon, as in Day One) and a long journal name can't run into it. The row sticks
 * below the top bar; the pill scrolls sideways if the views ever outgrow a narrow screen. The
 * highlight is one element that slides to the chosen view (it is measured, so the views can be any
 * width); it is placed without a transition the first time, so it doesn't fly in from the corner.
 */
export function ViewSwitch() {
  // A tag filter always shows the list, so that is the tab that reads as chosen; picking another
  // one drops the filter (`useChooseView`).
  const tagged = useSearchParams()[0].has('tag')
  const stored = useBrowseView()
  const view = tagged ? 'list' : stored
  const choose = useChooseView()
  const group = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  const placed = useRef(false)

  // Set on the element itself (it is only geometry, no need to render for it).
  useLayoutEffect(() => {
    const g = group.current
    const p = pill.current
    const on = g?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!g || !p || !on) return
    const place = (animate: boolean) => {
      p.style.transition = animate ? '' : 'none'
      p.style.left = `${on.offsetLeft}px`
      p.style.width = `${on.offsetWidth}px`
      void p.offsetWidth // commit the jump before the transition is switched back on
      p.style.transition = ''
    }
    place(placed.current) // the first time it is put in place, not slid in from the corner
    placed.current = true
    on.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    // A rotated phone, a shown-again pane. An observer reports once when it starts: skip that
    // one, or it would snap the highlight into place and cancel the slide.
    let first = true
    const ro = new ResizeObserver(() => (first ? (first = false) : place(false)))
    ro.observe(g)
    return () => ro.disconnect()
  }, [view])

  return (
    <div className="sticky top-14 z-20 -mx-4 flex h-11 items-center overflow-x-auto bg-background px-4 medium:-mx-6 medium:px-6">
      <div
        ref={group}
        role="radiogroup"
        aria-label="View"
        // The arrows are the switch's own; the calendar's ←/→ shortcuts must leave them alone.
        data-owns-keys=""
        onKeyDown={radioKeys}
        className="relative mx-auto flex shrink-0 rounded-full bg-surface-container-high p-0.5"
      >
        <span
          ref={pill}
          aria-hidden="true"
          className="absolute inset-y-0.5 rounded-full bg-secondary-container transition-[left,width] duration-250 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
        />
        {BROWSE_VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={view === v}
            tabIndex={view === v ? 0 : -1}
            aria-label={v === 'details' ? LABELS[v] : undefined}
            onClick={() => choose(v)}
            className={cn(
              'state-layer relative h-9 cursor-pointer rounded-full text-sm',
              v === 'details' ? 'grid w-10 place-items-center' : 'px-4',
              view === v ? 'text-on-secondary-container' : 'text-on-surface-variant',
            )}
          >
            {v === 'details' ? (
              <Icon name="info" filled={view === v} className="size-5" />
            ) : (
              LABELS[v]
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
