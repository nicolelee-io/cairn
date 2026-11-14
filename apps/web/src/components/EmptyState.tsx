import type { ReactNode } from 'react'
import { CairnMark } from './CairnMark.tsx'

/**
 * A list with nothing in it: the cairn over a short message, in a panel the size of a card. Used by
 * the entry list, Search, Media, Drafts and Insights' On this day.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-container-low p-8 text-center text-on-surface-variant">
      <CairnMark className="size-16" />
      <p>{children}</p>
    </div>
  )
}
