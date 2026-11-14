import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { useTip } from '../lib/useTip.tsx'
import { Icon } from './Icon.tsx'
import { Button } from './ui/button.tsx'

/**
 * The 56px bar at the top of the reader, its loading skeleton and the editor: it stays put while
 * the text scrolls, and runs to the pane's edges past the text column's padding. `surface` is its
 * background (the popup's is `bg-surface-container-high`).
 */
export function EntryPaneHeader({
  surface = 'bg-background',
  children,
}: {
  surface?: string
  children: ReactNode
}) {
  return (
    <header
      className={cn(
        'sticky top-0 z-20 -mx-4 flex h-14 items-center gap-1 px-2 medium:-mx-8 medium:px-6',
        surface,
      )}
    >
      {children}
    </header>
  )
}

/**
 * Pin or Star as a toggle button: a fixed name with `aria-pressed` saying whether it is on (the
 * icon fills and turns tertiary). Shared by the reader and the editor.
 */
export function FlagToggle({
  kind,
  on,
  disabled,
  title,
  shortcut,
  onToggle,
}: {
  kind: 'pin' | 'star'
  on: boolean
  disabled?: boolean
  /** Why it is disabled (an archived journal). A disabled button gets no pointer events, so this is the native `title`, not the hover tip. */
  title?: string
  /** The keys, appended to the hover tip. */
  shortcut?: string
  onToggle: () => void
}) {
  const action = kind === 'pin' ? (on ? 'Unpin' : 'Pin') : on ? 'Unstar' : 'Star'
  const tip = useTip(shortcut ? `${action} (${shortcut})` : action)
  return (
    <Button
      variant="text"
      size="icon"
      aria-label={kind === 'pin' ? 'Pin' : 'Star'}
      aria-pressed={on}
      disabled={disabled}
      title={disabled ? title : undefined}
      className="aria-pressed:text-tertiary"
      onClick={onToggle}
      {...tip.bind}
    >
      {tip.node}
      <Icon name={kind === 'pin' ? 'keep' : 'star'} filled={on} />
    </Button>
  )
}
