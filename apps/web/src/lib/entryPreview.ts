import type { TimelineItem } from '@cairn/shared'

/** What a tapped card already knows, handed to the reader through the link's state so it can
 *  show the title and date while the full entry loads. */
export interface EntryPreview {
  title: string
  createdAt: number
  timezone: string
  allDay: boolean
}

export const previewOf = (item: TimelineItem): { preview: EntryPreview } => ({
  preview: {
    title: item.title,
    createdAt: item.createdAt,
    timezone: item.timezone,
    allDay: item.allDay,
  },
})

/** The preview in a location's state, if the link came from a card (state is untyped). */
export function readPreview(state: unknown): EntryPreview | null {
  const p = (state as { preview?: Partial<EntryPreview> } | null)?.preview
  return p && typeof p.createdAt === 'number' && typeof p.timezone === 'string'
    ? { title: p.title ?? '', createdAt: p.createdAt, timezone: p.timezone, allDay: !!p.allDay }
    : null
}

/**
 * A fixed list an entry was opened from (Insights' "On this day"), carried in the link's state so
 * the reader flips within it, newest first, instead of through the whole timeline.
 */
export const withList = (item: TimelineItem, list: TimelineItem[]) => ({
  ...previewOf(item),
  list: [...list].sort((a, b) => b.createdAt - a.createdAt),
})

/** The list in a location's state, if the entry was opened from one. */
export function readList(state: unknown): TimelineItem[] | null {
  const l = (state as { list?: unknown } | null)?.list
  return Array.isArray(l) && l.length > 0 ? (l as TimelineItem[]) : null
}

/** The entry after (`1`, older) or before (`-1`, newer) `id` in `list`; null at either end or when absent. */
export function neighbourIn(list: TimelineItem[], id: string, dir: 1 | -1): TimelineItem | null {
  const at = list.findIndex((i) => i.id === id)
  return (at >= 0 && list[at + dir]) || null
}
