import { useEffect, useLayoutEffect, useRef } from 'react'
import { Outlet } from 'react-router'
import { CairnMark } from '../components/CairnMark.tsx'
import { BROWSE_VIEWS, saveScroll, savedScroll, useBrowseView } from '../lib/browseView.ts'
import { useChooseView } from '../lib/useChooseView.ts'
import { moveCard } from '../lib/cardFocus.ts'
import { useTopNavigate } from '../lib/navigation.ts'
import { elementScroller, placeScroll, windowScroller } from '../lib/scrollPlace.ts'
import { useShortcuts } from '../lib/shortcuts.ts'
import { EntriesPane } from './EntriesPane.tsx'
import { cn } from '../lib/cn.ts'
import { setReaderZen, useZenActive } from '../lib/immersive.ts'
import { useJournal, useJournals } from '../lib/queries.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'

/**
 * Master-detail (SPEC 6a, adaptive): the entry list beside a reader/editor pane. The URL is the
 * same at every width; only what is visible changes.
 *   under 840px  one pane: the list at `/`, the reader once an entry (or /new, /j/:id/new) is open
 *   840px and up both side by side, each scrolling on its own
 * The list stays mounted (just hidden) while an entry is open on a phone, so its loaded pages and
 * scroll position survive going back.
 */
export function BrowseLayout() {
  const { entryId, editing, journalId } = useBrowseParams()
  const detailOpen = !!entryId || editing
  const view = useBrowseView()
  const mapView = view === 'map'
  const immersive = useZenActive()
  // The reader's zen mode lasts for the entry on screen: the list, a new entry or the editor end it.
  const reading = !!entryId && !editing
  useEffect(() => {
    if (!reading) setReaderZen(false)
  }, [reading])
  const top = useTopNavigate()
  const choose = useChooseView()
  const journals = useJournals().data

  // What scrolls: the window on a phone, the Entries pane itself from 840px. Remember where each
  // view was (List, Calendar, ... each have their own place, and the pane element is shared by
  // all of them), show the reader from the top on a phone, and put the view back where it was.
  const pane = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = pane.current
    const own = !!el && getComputedStyle(el).overflowY === 'auto'
    if (detailOpen) {
      if (!own) window.scrollTo(0, 0)
      return
    }
    // The view may still be loading, so it is put back as its content grows (lib/scrollPlace.ts),
    // and nothing is saved until it has been: a clamped position is not where the user was.
    const scroller = own ? elementScroller(el) : windowScroller()
    const placing = placeScroll(scroller, savedScroll(view, journalId) ?? 0)
    // Layout effect so the listener is gone before the hidden list can clamp the scroll position.
    const target = own ? el : window
    const onScroll = () => {
      if (!placing.pending()) saveScroll(view, journalId, scroller.get())
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      placing.cancel()
      target.removeEventListener('scroll', onScroll)
    }
  }, [detailOpen, view, journalId])

  // Keyboard: the view switch, the journal before and after, and j/k through the cards.
  const active = (journals ?? []).filter((j) => !j.archivedAt)
  const stepJournal = (dir: 1 | -1) => {
    const i = active.findIndex((j) => j.id === journalId)
    const next = i < 0 ? (dir > 0 ? 0 : active.length - 1) : i + dir
    const target = active[next]
    if (target) top(`/j/${target.id}`)
    else if (i >= 0) top('/') // stepping off either end lands on All Entries
  }
  const walkCards = (dir: 1 | -1) => moveCard(pane.current, dir)
  useShortcuts([
    ...BROWSE_VIEWS.map((v) => ({
      id: `view.${v}` as const,
      when: () => !editing,
      run: () => choose(v),
    })),
    { id: 'journal.prev', when: () => !editing, run: () => stepJournal(-1) },
    { id: 'journal.next', when: () => !editing, run: () => stepJournal(1) },
    { id: 'list.next', when: () => !editing, run: () => walkCards(1) },
    { id: 'list.prev', when: () => !editing, run: () => walkCards(-1) },
  ])

  return (
    <div className="expanded:flex expanded:h-dvh">
      <section
        ref={pane}
        aria-label="Entries"
        className={cn(
          'mx-auto w-full px-4 pt-0 medium:px-6',
          'expanded:mx-0 expanded:max-w-none expanded:shrink-0 expanded:overflow-y-auto expanded:border-x expanded:border-outline-variant',
          // The list is a column that grows with the window within a modest range; the map wants room, so it takes nearly half the screen.
          mapView
            ? 'pb-24 expanded:w-[45%] expanded:min-w-[26rem] expanded:pb-0'
            : 'max-w-3xl pb-40 expanded:w-[clamp(22rem,36vw,26rem)] large:w-[clamp(26rem,34vw,32rem)] large:pb-24',
          detailOpen && (immersive ? 'hidden' : 'hidden expanded:block'),
        )}
      >
        <EntriesPane />
      </section>
      <section
        aria-label="Entry"
        className={cn(
          'min-w-0 flex-1 expanded:overflow-y-auto',
          !detailOpen && 'hidden expanded:block',
        )}
      >
        <Outlet />
      </section>
    </div>
  )
}

/** The reader pane when nothing is open. Only seen on windows wide enough for two panes. */
export function ReaderEmpty() {
  const { journalId } = useBrowseParams()
  const journal = useJournal(journalId)
  return (
    <div className="grid h-full min-h-64 place-content-center justify-items-center gap-1 p-8 text-center text-on-surface-variant">
      <CairnMark className="-mb-6 size-36" color={journal?.color} />
      {journal && <p className="text-xl text-on-surface">{journal.name}</p>}
      {journal && (
        <p>
          {journal.entryCount} {journal.entryCount === 1 ? 'entry' : 'entries'}
        </p>
      )}
      {journal?.description && (
        <>
          <p className="max-w-prose whitespace-pre-line">{journal.description}</p>
          <hr className="my-3 w-24 border-outline-variant" />
        </>
      )}
      <p>Select an entry to read it.</p>
    </div>
  )
}
