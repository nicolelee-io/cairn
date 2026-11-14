import { isJournalIconName, type Journal } from '@cairn/shared'
import { cn } from '../lib/cn.ts'
import { journalWash } from '../lib/journalColors.ts'
import { Icon } from './Icon.tsx'
import { MetaChip } from './MetaChip.tsx'

const SIZES = {
  sm: { circle: 'size-7 text-base', glyph: 'size-[18px]' },
  md: { circle: 'size-10 text-xl', glyph: 'size-6' },
} as const

/**
 * A journal's mark: its Material icon or emoji (or a book when it has none) in a circle of its colour (the theme's
 * primary when it has none). Decorative: the name always sits beside it.
 */
export function JournalBadge({
  journal,
  size = 'sm',
  className,
}: {
  journal: Pick<Journal, 'color' | 'icon'>
  size?: keyof typeof SIZES
  className?: string
}) {
  const s = SIZES[size]
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-primary leading-none text-on-primary',
        s.circle,
        className,
      )}
      style={journal.color ? { background: journal.color, color: '#fff' } : undefined}
    >
      {!journal.icon ? (
        <Icon name="book" className={s.glyph} />
      ) : isJournalIconName(journal.icon) ? (
        <Icon name={journal.icon} className={s.glyph} />
      ) : (
        journal.icon
      )}
    </span>
  )
}

/**
 * A journal's colour as a small dot, for where a badge is too big: inline beside a name in a chip or
 * a picker option. No colour (null or '') falls back to the theme's primary.
 */
export function JournalDot({
  color,
  size = 'md',
}: {
  color: string | null | undefined
  size?: 'sm' | 'md'
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('shrink-0 rounded-full bg-primary', size === 'sm' ? 'size-2' : 'size-2.5')}
      style={color ? { background: color } : undefined}
    />
  )
}

/**
 * The journal's name on a wash of its colour, with its dot. `card` is the small one in an entry
 * card's meta line (only in lists that span journals); `footer` is a reader chip linking to the
 * journal, beside the date and place.
 */
export function JournalChip({
  journal,
  variant,
  archived = false,
}: {
  journal: Pick<Journal, 'id' | 'name' | 'color'>
  variant: 'card' | 'footer'
  /** Say "(archived)" after the name. */
  archived?: boolean
}) {
  if (variant === 'card')
    return (
      <span
        className="flex min-w-0 items-center gap-1.5 self-start rounded-full bg-surface-container-high py-0.5 pr-2.5 pl-2"
        style={{ background: journalWash(journal.color, 'surface-container-low', 25) }}
      >
        <JournalDot color={journal.color} size="sm" />
        <span className="truncate">{journal.name}</span>
      </span>
    )
  return (
    <MetaChip to={`/j/${journal.id}`} style={{ background: journalWash(journal.color) }}>
      <JournalDot color={journal.color} />
      <span className="truncate">{journal.name}</span>
      {archived && <span className="text-on-surface-variant">(archived)</span>}
    </MetaChip>
  )
}
