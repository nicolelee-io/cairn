import {
  infiniteQueryOptions,
  InfiniteQueryObserver,
  type QueryClient,
} from '@tanstack/react-query'
import { TimelinePageSchema, type TimelineItem } from '@cairn/shared'
import { api } from './api.ts'
import { keys } from './queries.ts'

const PAGE = 30

/** The entry list's query: shared by the list and by the reader's older/newer keys, so one cache. */
export const timelineOptions = (journalId?: string, tag?: string) =>
  infiniteQueryOptions({
    queryKey: keys.timeline(journalId, tag),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: String(PAGE) })
      if (journalId) qs.set('journalId', journalId)
      if (tag) qs.set('tag', tag)
      if (pageParam) qs.set('cursor', pageParam)
      return api(`/entries?${qs}`, { schema: TimelinePageSchema })
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

/** More pages than anyone steps through with a key; a stop against a runaway fetch. */
const MAX_PAGES = 40

/**
 * The entry after (`dir` 1, older) or before (-1, newer) `entryId` in the list as the screen shows
 * it, loading more pages when the entry is at the end of what is loaded. Null at either end, or
 * when the entry isn't in this list at all.
 */
export async function neighbourOf(
  qc: QueryClient,
  entryId: string,
  dir: 1 | -1,
  journalId?: string,
  tag?: string,
): Promise<TimelineItem | null> {
  const options = timelineOptions(journalId, tag)
  let data = qc.getQueryData(options.queryKey) ?? (await qc.fetchInfiniteQuery(options))
  for (let n = 0; n < MAX_PAGES; n++) {
    const items = data.pages.flatMap((p) => p.items)
    const at = items.findIndex((i) => i.id === entryId)
    if (at >= 0 && items[at + dir]) return items[at + dir]!
    if (at >= 0 && dir < 0) return null
    const last = data.pages.at(-1)
    if (!last?.nextCursor) return null
    const next = await new InfiniteQueryObserver(qc, options).fetchNextPage()
    if (!next.data) return null
    data = next.data
  }
  return null
}
