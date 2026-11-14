import { useBottomBar } from './bottomBar.ts'
import { useBrowseParams } from './useBrowseParams.ts'
import { useMediaQuery } from './useMediaQuery.ts'

/**
 * Whether the Entries/Insights bottom bar is on screen right now: the setting is on, the window is
 * under 1200px (the sidebar takes over), it isn't a utility page or the editor, and on a phone no
 * entry is open. The New entry button and the toast position themselves from this.
 */
export function useBarVisible(): boolean {
  const on = useBottomBar()
  const { entryId, editing, quiet } = useBrowseParams()
  const expanded = useMediaQuery('(min-width: 840px)')
  const large = useMediaQuery('(min-width: 1200px)')
  if (!on || quiet || large || editing) return false
  return entryId ? expanded : true
}
