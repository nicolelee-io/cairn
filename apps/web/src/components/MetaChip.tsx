import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '../lib/cn.ts'
import { fullDate, shortDate, timeLabel, timeWithZone } from '../lib/format.ts'
import { Icon, type IconName } from './Icon.tsx'

const CHIP =
  'inline-flex h-10 min-w-0 max-w-full items-center gap-2 rounded-full bg-surface-container-high px-3 text-sm'

/**
 * One of the round chips under an entry's text (date, place, weather, tags, journal), the same in
 * the reader and the editor. A `button` with `onClick` (the editor's, each opening its dialog), a
 * link with `to` (the reader's journal), else plain text. `icon` leads it; `active` fills it in the
 * tertiary colour (a place or tags that are set).
 */
export function MetaChip({
  icon,
  active = false,
  onClick,
  to,
  label,
  style,
  children,
}: {
  icon?: IconName
  active?: boolean
  onClick?: () => void
  to?: string
  /** An accessible name for a button or link chip, when its text alone doesn't say what it is. */
  label?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const content = (
    <>
      {icon && (
        <Icon
          name={icon}
          filled={active}
          className={cn('size-5 shrink-0', active ? 'text-tertiary' : 'text-on-surface-variant')}
        />
      )}
      {children}
    </>
  )
  if (onClick)
    return (
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        style={style}
        className={cn('state-layer cursor-pointer', CHIP)}
      >
        {content}
      </button>
    )
  if (to)
    return (
      <Link to={to} aria-label={label} style={style} className={cn('state-layer', CHIP)}>
        {content}
      </Link>
    )
  return (
    <span style={style} className={CHIP}>
      {content}
    </span>
  )
}

/** When an entry was written, in its own timezone: short on a phone, the full date and zone from 600px. */
export function EntryWhen({
  createdAt,
  timezone,
  allDay,
}: {
  createdAt: number
  timezone: string
  allDay: boolean
}) {
  return (
    <>
      <span className="truncate medium:hidden">
        {shortDate(createdAt, timezone)}
        {allDay ? ' · All day' : ` · ${timeLabel(createdAt, timezone)}`}
      </span>
      <span className="hidden truncate medium:inline">
        {fullDate(createdAt, timezone)}
        {' · '}
        {allDay ? 'All day' : timeWithZone(createdAt, timezone)}
      </span>
    </>
  )
}
