import { useLocation, useNavigate } from 'react-router'
import type { TimelineItem } from '@cairn/shared'
import { previewOf } from './entryPreview.ts'
import { canGoBack } from './navigation.ts'
import { useMediaQuery } from './useMediaQuery.ts'

/**
 * Desktop opens an entry from Insights in a popup instead of leaving the page. The popup lives in
 * the history as a state on the same URL (`popupEntry`), so Back (the browser's, Android's) closes
 * it and the page underneath never unmounts.
 */
export function useEntryPopup() {
  const location = useLocation()
  const navigate = useNavigate()
  const id = (location.state as { popupEntry?: string } | null)?.popupEntry ?? null
  return {
    id,
    /** `item` (a card's entry) lets the popup show the title and date while the entry loads. */
    open: (entryId: string, item?: TimelineItem) =>
      void navigate(location.pathname + location.search, {
        state: { popupEntry: entryId, ...(item && previewOf(item)) },
      }),
    close: () =>
      void (canGoBack()
        ? navigate(-1)
        : navigate(location.pathname + location.search, { replace: true })),
  }
}

/** Whether entries open in the popup: the widths that show the list and the reader side by side. */
export const usePopupWidth = () => useMediaQuery('(min-width: 840px)')
