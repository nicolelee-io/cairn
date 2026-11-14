import { cn } from '../lib/cn.ts'

/** A quiet placeholder block for content whose shape is known (cards, the reader's text). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('rounded-sm bg-surface-container-highest motion-safe:animate-pulse', className)}
    />
  )
}

/** Same footprint as an `EntryCard`, so the list doesn't jump when the real rows arrive. */
export function EntryCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex gap-3 rounded-xl bg-surface-container-low p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="mt-1 h-3 w-1/4" />
      </div>
    </div>
  )
}

/** A few card placeholders for a list's first load; announces itself once for screen readers. */
export function EntryListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <span role="status" className="sr-only">
        Loading
      </span>
      {Array.from({ length: count }, (_, i) => (
        <EntryCardSkeleton key={i} />
      ))}
    </div>
  )
}
