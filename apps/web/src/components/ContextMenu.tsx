import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { closeContextMenu, releaseGuarded, useContextMenu } from '../lib/contextMenu.ts'
import { cn } from '../lib/cn.ts'
import { moveFocus } from '../lib/moveFocus.ts'
import { Icon } from './Icon.tsx'

const EDGE_PX = 8
/** Pulled down this far (px) the sheet closes, or from PULL_FLICK_PX if it was a quick flick. */
const PULL_CLOSE_PX = 80
const PULL_FLICK_PX = 30
/** Space between the FAB and its pills. */
const PILL_GAP_PX = 12

/**
 * The one context menu (lib/contextMenu.ts), rendered once in AppShell. A native modal <dialog>, so
 * Esc and Android's Back close it and focus is trapped, like every other overlay. A mouse or the
 * keyboard gets a popover at the pointer (kept inside the window); a touch gets a bottom sheet that
 * slides up over a fading backdrop and plays that back before closing (`.menu-sheet` in index.css,
 * the same `closing` class approach as the nav drawer).
 */
export function ContextMenu() {
  const current = useContextMenu()
  const ref = useRef<HTMLDialogElement>(null)
  // The last menu stays on screen while a sheet slides away, so it doesn't empty as it leaves.
  const [shown, setShown] = useState(current)
  if (current && current !== shown) setShown(current)
  const menu = current ?? shown
  const sheet = menu?.source === 'touch'
  const pills = menu?.source === 'anchor'

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (current) {
      d.classList.remove('closing')
      d.style.transform = '' // left over from a sheet that was pulled shut
      if (!d.open) d.showModal()
      return
    }
    if (!d.open) return
    const finish = () => {
      d.classList.remove('closing')
      d.close()
      setShown(null)
    }
    if (!sheet || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish()
    d.classList.add('closing')
    const done = (e: AnimationEvent) => e.target === d && finish()
    d.addEventListener('animationend', done)
    // If the animation never reports back (a background tab), the sheet must still go away.
    const fallback = window.setTimeout(finish, 400)
    return () => {
      d.removeEventListener('animationend', done)
      window.clearTimeout(fallback)
    }
    // `sheet` is read from the menu being closed, which `current` no longer holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  // Place the popover once it has a size; before this it is invisible so it never jumps.
  useLayoutEffect(() => {
    const d = ref.current
    if (!d || !menu) return
    if (pills) {
      // Pinned by its bottom-right corner (see `style` below), so there is nothing to measure.
      d.style.left = d.style.top = d.style.visibility = ''
      return
    }
    if (sheet) {
      // A popover's inline position would pin the sheet away from the bottom edge.
      d.style.left = d.style.top = d.style.visibility = ''
      return
    }
    // A closed dialog is display: none and measures 0 wide, which would skip the clamp below; the
    // effect above would only open it after this one has run.
    if (!d.open) d.showModal()
    const { width, height } = d.getBoundingClientRect()
    // From a ⋮ button the menu hangs from the button's right edge, opening leftwards.
    const x = menu.align === 'end' ? menu.x - width : menu.x
    const left = Math.max(
      EDGE_PX,
      Math.min(x, document.documentElement.clientWidth - width - EDGE_PX),
    )
    const top = Math.max(EDGE_PX, Math.min(menu.y, window.innerHeight - height - EDGE_PX))
    d.style.left = `${left}px`
    d.style.top = `${top}px`
    d.style.visibility = 'visible'
  }, [menu, sheet, pills])

  // The sheet follows a finger pulling its handle down; let go far enough (or fast enough) and it
  // closes, playing the usual slide-out on from where it was (the closing keyframes only name where
  // it ends), else it eases back up.
  const pull = useRef<{ pointer: number; y: number; t: number } | null>(null)
  const drag = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') return
      pull.current = { pointer: e.pointerId, y: e.clientY, t: e.timeStamp }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const p = pull.current
      if (!p || p.pointer !== e.pointerId || !ref.current) return
      ref.current.style.transform = `translateY(${Math.max(0, e.clientY - p.y)}px)`
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const p = pull.current
      const d = ref.current
      pull.current = null
      if (!p || !d) return
      const dy = e.clientY - p.y
      if (dy > PULL_CLOSE_PX || (dy > PULL_FLICK_PX && dy / Math.max(e.timeStamp - p.t, 1) > 0.5))
        return closeContextMenu()
      const from = d.style.transform
      d.style.transform = ''
      if (from && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        d.animate([{ transform: from }, { transform: 'none' }], {
          duration: 200,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        })
    },
    onPointerCancel: () => {
      pull.current = null
      if (ref.current) ref.current.style.transform = ''
    },
  }

  // Focus the first usable row (Tab is trapped in the dialog, the arrows move between rows).
  // (Opened with a mouse press, focus stays on the menu itself and the arrows enter it: otherwise
  // the first row wears a focus ring nobody asked for.)
  useEffect(() => {
    if (!menu) return
    if (menu.focusFirst === false) ref.current?.focus()
    else ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [menu])

  return (
    <dialog
      ref={ref}
      aria-label={menu?.title || 'Actions'}
      tabIndex={-1}
      onKeyDown={(e) => {
        // Focus on the menu itself (see above): an arrow steps into the rows.
        const d = ref.current
        if (!d || e.target !== d || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
        const rows = d.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
        e.preventDefault()
        rows[e.key === 'ArrowUp' || e.key === 'End' ? rows.length - 1 : 0]?.focus()
      }}
      onCancel={(e) => {
        e.preventDefault() // Esc, Android Back: go through the closing animation
        closeContextMenu()
      }}
      // A stale `close` (from the d.close() that ended the last menu's slide-out) must not shut a
      // menu opened since: that one has the dialog open again.
      onClose={(e) => !e.currentTarget.open && closeContextMenu()}
      // The backdrop. Not while the press that opened the menu is still being lifted.
      onClick={(e) => e.target === ref.current && !releaseGuarded() && closeContextMenu()}
      onContextMenu={(e) => {
        // A right-click outside the menu dismisses it instead of showing the browser's.
        e.preventDefault()
        if (e.target === ref.current && !releaseGuarded()) closeContextMenu()
      }}
      style={
        pills && menu?.anchor
          ? {
              right: `${document.documentElement.clientWidth - menu.anchor.right}px`,
              bottom: `${window.innerHeight - menu.anchor.top + PILL_GAP_PX}px`,
            }
          : menu && !sheet
            ? { visibility: 'hidden' }
            : undefined
      }
      className={cn(
        'fixed m-0 p-0 text-on-surface outline-none',
        pills
          ? 'inset-auto overflow-visible bg-transparent backdrop:bg-transparent'
          : 'bg-surface-container-high backdrop:bg-scrim/40',
        sheet
          ? 'menu-sheet inset-x-0 top-auto bottom-0 max-h-[80dvh] w-full max-w-none rounded-t-2xl rounded-b-none pb-[env(safe-area-inset-bottom)]'
          : !pills &&
              'inset-auto min-w-52 max-w-[min(20rem,calc(100vw-1rem))] rounded-xl shadow-lg',
      )}
    >
      {menu && (
        <div
          role="menu"
          aria-label={menu.title || 'Actions'}
          onKeyDown={(e) => moveFocus(e, '[role="menuitem"]')}
          className={cn(
            'flex max-h-[inherit] flex-col',
            pills ? 'items-end gap-2' : 'overflow-y-auto py-2',
          )}
        >
          {sheet && (
            // The handle and the title: pull them down to let the sheet go (the rows still scroll).
            <div
              {...drag}
              className={cn(
                'mb-1 touch-none pt-2',
                menu.title && 'border-b border-outline-variant',
              )}
            >
              <span
                aria-hidden="true"
                className="mx-auto block h-1 w-8 rounded-full bg-outline-variant"
              />
              {menu.title ? (
                <p className="truncate px-6 pt-2 pb-3 text-lg font-medium text-on-surface">
                  {menu.title}
                </p>
              ) : (
                <div className="h-3" />
              )}
            </div>
          )}
          {menu.actions.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              disabled={!!a.disabled}
              onClick={() => {
                closeContextMenu()
                // After the menu has closed, so a dialog it opens takes focus cleanly.
                setTimeout(a.run, 0)
              }}
              style={pills && a.dot ? { borderColor: a.dot } : undefined}
              className={cn(
                'state-layer flex cursor-pointer items-center gap-3 px-4 text-left outline-none disabled:cursor-default disabled:opacity-50',
                pills &&
                  'min-h-11 rounded-full border-2 border-outline-variant bg-surface-container-high pr-5 text-sm font-medium shadow-md',
                !pills && (sheet ? 'min-h-12 px-6' : 'min-h-10 text-sm'),
                a.destructive && 'text-error',
              )}
            >
              {a.dot !== undefined ? (
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full bg-outline-variant"
                  style={a.dot ? { background: a.dot } : undefined}
                />
              ) : (
                <Icon name={a.icon} className="size-5" />
              )}
              <span className="min-w-0 flex-1">
                {a.label}
                {a.disabled && (
                  <span className="block text-xs text-on-surface-variant">{a.disabled}</span>
                )}
              </span>
              {a.checked && (
                <>
                  <Icon name="check" className="size-5" />
                  <span className="sr-only">Selected</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </dialog>
  )
}
