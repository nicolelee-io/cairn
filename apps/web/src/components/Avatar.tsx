import { useState } from 'react'
import { useMe } from '../auth/useAuth.ts'
import { cn } from '../lib/cn.ts'

/** Where the caller's own picture is served; `v` versions the URL so a replaced one isn't stale. */
export const avatarUrl = (updatedAt: number) => `/api/avatar?v=${updatedAt}`

/**
 * The account's avatar circle: the picture when one is set, else the user's initial (also when the
 * picture won't load, e.g. offline with it not cached yet). With `name` it is someone else's (Manage
 * users): just their initial, since only your own picture is served.
 */
export function Avatar({ name, className }: { name?: string; className?: string }) {
  const me = useMe().data
  const initial = ((name ?? (me?.displayName || me?.username)) || '?')
    .trim()
    .charAt(0)
    .toUpperCase()
  const src = name === undefined && me?.avatarUpdatedAt ? avatarUrl(me.avatarUpdatedAt) : null
  // The src that failed, so a new picture gets another try without resetting on every render.
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-primary-container text-sm font-medium text-on-primary-container',
        className,
      )}
    >
      {src && failed !== src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(src)}
          className="size-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  )
}
