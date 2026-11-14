import { lazy, Suspense, useLayoutEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { CalendarView } from '../components/CalendarView.tsx'
import { DetailsView } from '../components/DetailsView.tsx'
import { MediaView } from '../components/MediaView.tsx'
import { TimelineList } from '../components/TimelineList.tsx'
import { BROWSE_VIEWS, setBrowseView, useBrowseView, type BrowseView } from '../lib/browseView.ts'
import { LoadingState } from '../components/Spinner.tsx'
import { TopBar } from '../components/TopBar.tsx'
import { ViewSwitch } from '../components/ViewSwitch.tsx'
import { useJournal } from '../lib/queries.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'
import { ignoreScrollEvents } from '../lib/scrollChrome.ts'
import { tick } from '../lib/haptics.ts'
import { useSwipe } from '../lib/useSwipe.ts'

// The map and its libraries load only when the map view is opened.
const EntriesMap = lazy(() => import('../components/EntriesMap.tsx'))

/** How much of the way a finger drags the content when there is no view that way (a rubber band). */
const RESISTANCE = 0.25
const SLIDE_OUT_MS = 140
const SLIDE_IN_MS = 220
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The Entries screen: the header (title and view switch, mounted once) over the chosen view
 * (Details, List, Calendar, Media, Map). On a touch screen the view follows a sideways drag, and
 * letting go on a swipe slides it away and the next or previous view (in the tab row's order) in;
 * a tap on a tab slides the same way. Only the content moves, never the header. The map takes no
 * part in dragging (it would fight the map's pan): you can swipe into it, but not out.
 */
export function EntriesPane() {
  const view = useBrowseView()
  // The details, the map, the calendar and the media grid don't filter by tag, so a tag filter always shows the list.
  const tagged = useSearchParams()[0].has('tag')
  const { journalId } = useBrowseParams()
  const journal = useJournal(journalId)

  const content = useRef<HTMLDivElement>(null)
  const leaving = useRef<Animation | null>(null)
  const shown = useRef(view)
  const index = BROWSE_VIEWS.indexOf(view)

  // A view change, from a swipe or a tap on a tab: the new view slides in from its side.
  useLayoutEffect(() => {
    if (shown.current === view) return
    const dir = Math.sign(BROWSE_VIEWS.indexOf(view) - BROWSE_VIEWS.indexOf(shown.current))
    shown.current = view
    // The new view puts its own place back (and the calendar opens on this month): not the reader scrolling.
    ignoreScrollEvents(800)
    const el = content.current
    if (!el) return
    leaving.current?.cancel() // the slide-out that was holding the old view off screen
    leaving.current = null
    el.style.transform = ''
    el.style.opacity = ''
    if (reducedMotion()) return
    el.animate(
      [
        { transform: `translateX(${dir * el.offsetWidth * 0.35}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: SLIDE_IN_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    )
  }, [view])

  const follow = (dx: number) => {
    const el = content.current
    if (!el) return
    const there = BROWSE_VIEWS[index + (dx < 0 ? 1 : -1)]
    const moved = there ? dx : dx * RESISTANCE
    el.style.transform = `translateX(${moved}px)`
    el.style.opacity = String(1 - Math.min(Math.abs(moved) / el.offsetWidth, 1) * 0.6)
  }

  // Back to rest from wherever the finger let go.
  const settle = () => {
    const el = content.current
    if (!el) return
    const { transform, opacity } = el.style
    el.style.transform = ''
    el.style.opacity = ''
    if (!transform || reducedMotion()) return
    el.animate(
      [
        { transform, opacity: opacity || 1 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: SLIDE_IN_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    )
  }

  const swipe = useSwipe(
    (direction) => {
      const next = BROWSE_VIEWS[index + (direction === 'left' ? 1 : -1)]
      const el = content.current
      if (!next || !el) return settle()
      tick()
      if (reducedMotion()) return setBrowseView(next)
      // Slide the old view off from where the finger left it; the layout effect above takes over
      // once the new view is in place, so there is no frame of the old one at rest in between.
      const out = el.animate(
        [
          { transform: el.style.transform || 'none', opacity: el.style.opacity || 1 },
          { transform: `translateX(${direction === 'left' ? '-100%' : '100%'})`, opacity: 0 },
        ],
        { duration: SLIDE_OUT_MS, easing: 'ease-in', fill: 'forwards' },
      )
      leaving.current = out
      out.onfinish = () => setBrowseView(next)
    },
    { enabled: view !== 'map' && !tagged, onDrag: (dx) => (dx === null ? settle() : follow(dx)) },
  )

  return (
    // No gap between the bars: the view switch sticks at 56px (under the top bar), so it must rest
    // there too, or it jumps 8px when the page scrolls. The space under it is the content's padding.
    <div className="flex flex-col">
      <TopBar
        title={journal?.name ?? 'All Entries'}
        journal={journal}
        icon={journal ? undefined : 'book'}
        bleed="-mx-4 px-4 medium:-mx-6 medium:px-6"
      />
      <ViewSwitch />
      {/* min-h: a short or empty view still takes a swipe in the space under its content. */}
      {/* overflow-x-clip: the view slides and follows the finger sideways, and without it the page gets
          wider than the screen for a moment, so a phone widens its viewport and the fixed bottom bar
          jumps. Clip, not hidden (no scroll container); the bleed margins keep focus rings uncut. */}
      <div className="-mx-4 overflow-x-clip px-4 medium:-mx-6 medium:px-6">
        <div ref={content} {...swipe} className="min-h-[60dvh] pt-2">
          <ViewPane view={view} tagged={tagged} />
        </div>
      </div>
    </div>
  )
}

function ViewPane({ view, tagged }: { view: BrowseView; tagged: boolean }) {
  if (view === 'details' && !tagged) return <DetailsView />
  if (view === 'calendar' && !tagged) return <CalendarView />
  if (view === 'media' && !tagged) return <MediaView />
  if (view === 'map' && !tagged) {
    return (
      <Suspense fallback={<LoadingState />}>
        <EntriesMap />
      </Suspense>
    )
  }
  return <TimelineList />
}
