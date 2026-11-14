import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { Icon } from '../Icon.tsx'
import { Button } from './button.tsx'

const ARROWS = new Set(['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'])

/**
 * Arrow keys move focus between a dialog's buttons (Down/Right next, Up/Left previous, wrapping),
 * in the same order as Tab. Only from a button or the title: text fields, selects and anything
 * that handled the key itself keep their arrows.
 */
function arrowFocus(e: KeyboardEvent<HTMLDialogElement>) {
  if (!ARROWS.has(e.key) || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
  const from = e.target
  if (!(from instanceof HTMLElement)) return
  if (from.tagName !== 'BUTTON' && from.tagName !== 'H2') return
  if (from.closest('[role="radiogroup"], [role="tablist"], [role="menu"], [role="listbox"]')) return
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  if (buttons.length === 0) return
  const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight'
  const at = buttons.indexOf(from as HTMLButtonElement)
  const next =
    at < 0
      ? forward
        ? 0
        : buttons.length - 1
      : (at + (forward ? 1 : -1) + buttons.length) % buttons.length
  e.preventDefault()
  buttons[next]?.focus()
}

/** A modal on the native <dialog>: focus trap, Esc and the top layer come from the browser. */
export function Dialog({
  open,
  onClose,
  title,
  showClose = false,
  bare = false,
  className,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  /** An X beside the title, for dialogs with no button of their own that closes them. */
  showClose?: boolean
  /** No visible title or padding: the content brings its own header (the title is still read out). */
  bare?: boolean
  /** Merged over the dialog's own classes, e.g. a wider box. */
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      // A dialog can name the control focus starts on (otherwise it is the title).
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-label={title}
      // Fires for Esc and for our own d.close(); only the former (open still true) is the user. React
      // bubbles `close` up the component tree, so a dialog stacked inside this one must not count.
      onClose={(e) => e.target === ref.current && open && onClose()}
      onClick={(e) => e.target === ref.current && onClose()} // a click on the backdrop
      onKeyDown={arrowFocus}
      className={cn(
        'm-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-surface-container-high p-0 text-on-surface backdrop:bg-scrim/40 open:flex open:flex-col',
        className,
      )}
    >
      {open && bare && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <h2 tabIndex={-1} autoFocus className="sr-only">
            {title}
          </h2>
          {children}
        </div>
      )}
      {open && !bare && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-6 pb-0">
          {/* Focus starts on the title, not on whichever control comes first. */}
          <div className="flex shrink-0 items-start justify-between gap-2">
            <h2 tabIndex={-1} autoFocus className="text-2xl outline-none">
              {title}
            </h2>
            {showClose && (
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="state-layer -mt-1 -mr-2 grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-on-surface-variant"
              >
                <Icon name="close" />
              </button>
            )}
          </div>
          {/* Only the body scrolls, so the title and the X stay put. */}
          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 pb-6">
            {children}
          </div>
        </div>
      )}
    </dialog>
  )
}

/**
 * A dialog's buttons: a row on the right, the main action last (Material 3's dialog). `stacked`
 * is for when they don't fit side by side on a phone (three actions, or long labels): full width
 * and the main action on top there, back to the row from 600px. Put the main action first in the
 * children when stacked; it moves to the end of the row by itself.
 */
export function DialogActions({
  stacked = false,
  children,
}: {
  stacked?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        stacked
          ? 'flex flex-col gap-2 medium:flex-row medium:flex-wrap medium:justify-end medium:[&>:first-child]:order-last'
          : 'flex flex-wrap justify-end gap-2',
      )}
    >
      {children}
    </div>
  )
}

/**
 * "Are you sure?": what will happen, an error line if it failed, and Cancel beside the action.
 * Destructive by default (Delete, Clear, Sign out); pass `destructive={false}` for a plain confirm.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  confirmIcon,
  destructive = true,
  pending = false,
  error,
  cancelLabel = 'Cancel',
  onCancel = onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  /** What will happen. */
  children: ReactNode
  confirmLabel: string
  confirmIcon?: 'delete'
  destructive?: boolean
  /** The action is running: its button is disabled. */
  pending?: boolean
  /** Shown as an alert above the buttons when set. */
  error?: string | null
  /** "Back" when the dialog is a step of another one. */
  cancelLabel?: string
  onCancel?: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {children}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <DialogActions>
        <Button variant="text" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'filled'}
          disabled={pending}
          onClick={onConfirm}
        >
          {confirmIcon && <Icon name={confirmIcon} className="size-5" />}
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
