import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, type RefObject } from 'react'
import type { TimelineItem } from '@cairn/shared'
import { fetchEntry } from './outbox.ts'
import { keys } from './queries.ts'

/** Room the list's sticky bars take at the top of its pane. */
const TOP_CLEARANCE = 112

/**
 * Scrolls the entry list to the open entry's card when it is off screen: after a deep link, a
 * reload, Edit from Insights' popup, or the older/newer keys. Only where the list sits beside the
 * reader (840px and up); on a phone it is hidden. A card already in view is left alone, so
 * tapping one never jumps. When the card isn't loaded yet, more pages are fetched until it is, or
 * until the list has passed the entry's date (it isn't in this list, e.g. another tag).
 */
export function useRevealEntry(
  root: RefObject<HTMLElement | null>,
  entryId: string | undefined,
  list: {
    ready: boolean
    items: TimelineItem[]
    hasNextPage: boolean
    isFetchingNextPage: boolean
    fetchNextPage: () => unknown
  },
) {
  // The reader loads this entry anyway; this only reads its date from the same cache entry.
  const createdAt = useQuery({
    queryKey: keys.entry(entryId ?? ''),
    queryFn: () => fetchEntry(entryId ?? ''),
    enabled: false,
  }).data?.entry.createdAt
  const revealed = useRef<string | null>(null)
  const { ready, items, hasNextPage, isFetchingNextPage, fetchNextPage } = list

  useEffect(() => {
    if (!entryId || !ready || revealed.current === entryId) return
    if (!window.matchMedia('(min-width: 840px)').matches) return
    const card = root.current?.querySelector<HTMLElement>('a[data-entry-card][aria-current="page"]')
    if (card) {
      revealed.current = entryId
      // The scrolling pane, not the card's month section (the nearest `section` is that one).
      const pane = card.closest('section[aria-label="Entries"]')?.getBoundingClientRect()
      const at = card.getBoundingClientRect()
      if (pane && (at.top < pane.top + TOP_CLEARANCE || at.bottom > pane.bottom)) {
        card.scrollIntoView({ block: 'center' })
      }
      return
    }
    // Not loaded: go on only while the list is still newer than the entry (pinned ones come first
    // and are out of date order, so they don't count).
    if (createdAt === undefined) return
    const oldest = items.findLast((i) => !i.pinned)
    const behind = !oldest || oldest.createdAt >= createdAt
    if (hasNextPage && behind) {
      if (!isFetchingNextPage) void fetchNextPage()
    } else {
      revealed.current = entryId
    }
  }, [entryId, ready, createdAt, items, hasNextPage, isFetchingNextPage, fetchNextPage, root])
}
