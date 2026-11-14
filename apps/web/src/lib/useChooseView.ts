import { useSearchParams } from 'react-router'
import { setBrowseView, type BrowseView } from './browseView.ts'

/**
 * Choose an Entries view (the view switch, the 1-5 keys). A tag filter only ever shows the list,
 * so choosing any other view drops the filter first; otherwise the choice would highlight a tab
 * whose view isn't the one on screen.
 */
export function useChooseView() {
  const [params, setParams] = useSearchParams()
  return (v: BrowseView) => {
    if (v !== 'list' && params.has('tag')) {
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.delete('tag')
          return next
        },
        { replace: true },
      )
    }
    setBrowseView(v)
  }
}
