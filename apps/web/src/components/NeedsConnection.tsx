import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'
import { Icon } from './Icon.tsx'
import { Button } from './ui/button.tsx'

/**
 * A banner at the top of a page whose controls are partly disabled while the server is unreachable
 * (Settings): says what still works and what waits. Render it only while `useServerDown()`.
 */
export function OfflineBanner({
  title,
  centered,
  children,
}: {
  title?: string
  /** One centered line (an icon and the text), for a note that is the whole message. */
  centered?: boolean
  children: ReactNode
}) {
  if (centered)
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 rounded-lg bg-secondary-container px-4 py-3 text-center text-sm text-on-secondary-container"
      >
        <Icon name="cloud_off" className="size-5 shrink-0" />
        <p>{children}</p>
      </div>
    )
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg bg-secondary-container p-4 text-on-secondary-container"
    >
      <Icon name="cloud_off" className="mt-0.5 shrink-0" />
      <div className="flex flex-col gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        <p className="text-sm">{children}</p>
      </div>
    </div>
  )
}

/**
 * One quiet line beside controls that are disabled while the server is unreachable (the values
 * around it still show, only changing them waits). Render it only while `useServerDown()`.
 */
export function OfflineNote({
  children = 'Reconnect to change this.',
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  return (
    <p
      role="status"
      className={cn('flex items-center gap-2 text-sm text-on-surface-variant', className)}
    >
      <Icon name="cloud_off" className="size-4 shrink-0" />
      {children}
    </p>
  )
}

/** Shown in place of a page's content while the server is unreachable and the page can't work without it. */
export function NeedsConnection({
  children = 'Reconnect to see this.',
  onRetry,
}: {
  /** Only what is specific to the screen; the default says "Reconnect to see this." */
  children?: ReactNode
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg bg-surface-container-low p-4"
    >
      <div className="flex items-center gap-3">
        <Icon name="cloud_off" className="shrink-0 text-on-surface-variant" />
        <p className="text-lg">You’re offline</p>
      </div>
      <p className="text-sm text-on-surface-variant">{children}</p>
      <Button variant="tonal" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
