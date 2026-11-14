import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import type { TimelineItem } from '@cairn/shared'
import { neighbourIn, previewOf, readList, withList } from './entryPreview.ts'
import { neighbourOf } from './timeline.ts'
import { useBrowseParams } from './useBrowseParams.ts'

/**
 * Moving from the open entry to its older or newer neighbour in the list as it is shown (same
 * journal and tag filter), for the keyboard and for swiping. `open` replaces this entry in history,
 * so Back still goes to the list. `neighbour(1)` is the older entry, `neighbour(-1)` the newer;
 * null at either end. An entry opened from a fixed list ("On this day") flips within that list
 * instead (its items travel in the location state).
 */
export function useEntryFlip(id: string) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { base, journalId } = useBrowseParams()
  const tag = useSearchParams()[0].get('tag') || undefined
  const list = readList(useLocation().state)

  const neighbour = (dir: 1 | -1): Promise<TimelineItem | null> =>
    list
      ? Promise.resolve(neighbourIn(list, id, dir))
      : neighbourOf(qc, id, dir, journalId, tag).catch(() => null)
  const open = (next: TimelineItem) => {
    const qs = tag ? `?tag=${encodeURIComponent(tag)}` : ''
    void navigate(`${base}/entry/${next.id}${qs}`, {
      replace: true,
      state: list ? withList(next, list) : previewOf(next),
    })
  }
  const flip = async (dir: 1 | -1) => {
    const next = await neighbour(dir)
    if (next) open(next)
  }
  return { neighbour, open, flip }
}
