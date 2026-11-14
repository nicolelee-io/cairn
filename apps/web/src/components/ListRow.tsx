import type { HTMLAttributes, MouseEvent, ReactNode } from 'react'
import { Link, type To } from 'react-router'
import { cn } from '../lib/cn.ts'

type Target =
  | {
      as: 'button'
      onClick: (e: MouseEvent<HTMLButtonElement>) => void
      disabled?: boolean
      /** The button opens a menu (adds `aria-haspopup`). */
      popup?: boolean
      /** The button is a toggle, and this is its state (`aria-pressed`). */
      pressed?: boolean
    }
  | {
      as: 'link'
      to: To
      /** Replace the current history entry instead of pushing (Settings' list beside its pane). */
      replace?: boolean
      /** This row is the page on screen (`aria-current="page"`). */
      current?: boolean
    }
  | { as?: 'static' }

type Props = Target & {
  /** The icon, badge, avatar or thumbnail at the start of the row. */
  lead?: ReactNode
  title: ReactNode
  /** Muted lines under the title, one per entry. */
  lines?: ReactNode[]
  /** Inside the tappable area, after the text: a count, chips, a chevron. */
  end?: ReactNode
  /** Beside the tappable area, with their own controls: buttons, a link. */
  trailing?: ReactNode
  /** The accessible name of the tappable area, when the text alone isn't it. */
  label?: string
  /** On the `li`: the surface (`rounded-lg bg-surface-container-low`). */
  className?: string
  /** On the tappable area: padding and height overrides. */
  targetClassName?: string
  /** Spread on the `li`, e.g. `useMenuTrigger`'s result. */
  liProps?: HTMLAttributes<HTMLElement>
}

/**
 * One row of a list: a lead, a title with muted lines, then trailing controls. The whole text area is
 * a button or a link (or plain text with `as="static"`); `trailing` sits beside it, never inside, so
 * a button never ends up in a link. Used by Trash, Manage users, Manage tags, the Move picker and the
 * Account card. Manage journals (drag grip) and Storage (byte bars) keep their own markup.
 */
export function ListRow(props: Props) {
  const { lead, title, lines, end, trailing, label, className, targetClassName, liProps } = props
  const interactive = props.as === 'button' || props.as === 'link'
  const cls = cn(
    'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-3 text-left',
    interactive && 'state-layer cursor-pointer disabled:pointer-events-none disabled:opacity-50',
    targetClassName,
  )
  const body = (
    <>
      {lead}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        {lines?.map((l, i) => (
          <span key={i} className="block truncate text-sm text-on-surface-variant">
            {l}
          </span>
        ))}
      </span>
      {end}
    </>
  )
  return (
    <li {...liProps} className={cn('flex items-center gap-1', trailing && 'pr-1', className)}>
      {props.as === 'button' ? (
        <button
          type="button"
          aria-label={label}
          aria-haspopup={props.popup ? 'menu' : undefined}
          aria-pressed={props.pressed}
          disabled={props.disabled}
          onClick={props.onClick}
          className={cls}
        >
          {body}
        </button>
      ) : props.as === 'link' ? (
        <Link
          to={props.to}
          replace={props.replace}
          aria-current={props.current ? 'page' : undefined}
          aria-label={label}
          className={cls}
        >
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
      {trailing}
    </li>
  )
}
