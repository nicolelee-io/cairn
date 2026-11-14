import { useQuery } from '@tanstack/react-query'
import { useLayoutEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { SearchMatchesSchema, entryLabel, summarize } from '@cairn/shared'
import { Icon } from './Icon.tsx'
import { Lightbox } from './Lightbox.tsx'
import { AttachmentView } from './AttachmentView.tsx'
import { PlaceDetailDialog, WeatherDetailDialog } from './EntryDetailDialogs.tsx'
import { EntryPaneHeader, FlagToggle } from './EntryHeader.tsx'
import { JournalChip } from './JournalBadge.tsx'
import { Markdown, PhotoImage } from './Markdown.tsx'
import { EntryWhen, MetaChip } from './MetaChip.tsx'
import { Skeleton } from './Skeleton.tsx'
import { MoodBadge } from './MoodBadge.tsx'
import { WeatherChip } from './WeatherChip.tsx'
import { Button, buttonVariants } from './ui/button.tsx'
import { api, ApiError } from '../lib/api.ts'
import { fetchEntry } from '../lib/outbox.ts'
import { toggleTaskLine } from '../lib/taskToggle.ts'
import { keys, useJournal } from '../lib/queries.ts'
import { locationLabel } from '../lib/location.ts'
import { type EntryPreview } from '../lib/entryPreview.ts'
import { useGoBack } from '../lib/navigation.ts'
import { setImmersive, setReaderZen, useReaderZen } from '../lib/immersive.ts'
import { shortcutHint } from '../lib/shortcutCatalog.ts'
import { useShortcuts } from '../lib/shortcuts.ts'
import { usePopupWidth } from '../lib/entryPopup.ts'
import { useEntryFlip } from '../lib/useEntryFlip.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'
import { useEntryPatch } from '../lib/useEntryPatch.ts'
import { openMenuFrom } from '../lib/contextMenu.ts'
import { useEntryMenu } from '../lib/menuActions.ts'
import { useTip } from '../lib/useTip.tsx'

/**
 * The entry as read: the page at `/entry/:id` (EntryPage) and, on desktop, the popup Insights opens
 * (EntryPopup, via `onClose`). The popup has a Close button instead of Back and no older/newer.
 */
export function EntryReader({
  id,
  preview,
  onClose,
}: {
  id: string
  /** What the tapped card already knew, shown while the entry loads. */
  preview: EntryPreview | null
  /** Set in the popup, where a close button takes the place of Back. */
  onClose?: () => void
}) {
  const popup = !!onClose
  const back = useGoBack()
  const { base: browseBase } = useBrowseParams()
  const navigate = useNavigate()
  const [viewing, setViewing] = useState<string | null>(null)
  // The place or weather chip's details dialog.
  const [detail, setDetail] = useState<'place' | 'weather' | null>(null)

  // Opened from a search result (?q=...): ask which words matched so they can be highlighted.
  const [params] = useSearchParams()
  const q = params.get('q')?.trim() ?? ''
  const matches = useQuery({
    queryKey: keys.searchMatches(id, q),
    enabled: q !== '',
    queryFn: () =>
      api(`/search/matches?${new URLSearchParams({ q, entryId: id })}`, {
        schema: SearchMatchesSchema,
      }),
  })

  const entryKey = keys.entry(id)
  const query = useQuery({
    queryKey: entryKey,
    queryFn: () => fetchEntry(id),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    // Weather is fetched in the background after a save that set a place: look again a few times
    // so it appears without a reload. Only right after a save (nobody has weather for the future,
    // and an entry untouched for a while either has it or never will).
    refetchInterval: (q) => {
      const d = q.state.data
      if (!d?.location || d.weather || q.state.dataUpdateCount >= 6) return false
      const now = Date.now()
      const recentlySaved = now - d.entry.modifiedAt < 60_000
      const notFuture = d.entry.createdAt <= now + 30 * 60_000
      return recentlySaved && notFuture ? 2500 : false
    },
  })

  const star = useEntryPatch(id)

  // Each entry opens from the top, whether it came from a card or from the older/newer keys.
  useLayoutEffect(() => {
    const pane = document.querySelector<HTMLElement>('section[aria-label="Entry"]')
    if (popup) return
    if (pane && getComputedStyle(pane).overflowY === 'auto') pane.scrollTop = 0
    else window.scrollTo(0, 0)
  }, [id, popup])

  // Keyboard: older/newer follow the list as it is shown (same journal and tag filter), and replace
  // this entry in history so Back still goes to the list. (EntrySwipe does the same by touch.)
  const { flip } = useEntryFlip(id)
  const loaded = query.data
  // From the popup, Edit opens in the entry's own journal, so the list beside the editor is that journal's.
  const base = popup && loaded ? `/j/${loaded.entry.journalId}` : browseBase
  const journal = useJournal(loaded?.entry.journalId)
  const editable = !!loaded && !journal?.archivedAt
  // The ⋮ menu beside Edit (the same actions as a card's menu, minus Open).
  const label = entryLabel(summarize(loaded?.entry.bodyMd ?? ''))
  const editTip = useTip('Edit')
  const moreTip = useTip('More actions')
  // Zen mode, from 840px and not in the popup (which has no list to hide).
  const zen = useReaderZen()
  const zenAvailable = usePopupWidth() && !popup
  // Edit from zen mode opens the editor in zen mode too (the editor's own, remembered setting).
  const carryZen = () => {
    if (zenAvailable && zen) setImmersive(true)
  }
  const zenTip = useTip(
    `${zen ? 'Leave zen mode' : 'Zen mode'} (${shortcutHint('reader.immersive')})`,
  )
  const buildMenu = useEntryMenu(
    {
      id,
      journalId: loaded?.entry.journalId ?? '',
      pinned: loaded?.entry.pinned ?? false,
      starred: loaded?.entry.starred ?? false,
      label,
      bodyMd: loaded?.entry.bodyMd,
    },
    // Edit, Pin and Star are buttons beside the ⋮ already.
    { editTo: `${base}/entry/${id}/edit`, omit: ['edit', 'pin', 'star'] },
  )
  // The ⋮ menu's other actions are palette commands too, with no keys of their own (a stray bare
  // key must never delete). They come from the same builder, so what the menu offers (not in an
  // archived journal, not while offline) is what the palette runs.
  const menuActions = new Map(buildMenu().map((a) => [a.id, a]))
  const menuCommand = (action: string, label: string) => ({
    id: `reader.${action}`,
    group: 'Reader',
    label,
    when: () => !!loaded && !!menuActions.get(action) && !menuActions.get(action)?.disabled,
    run: () => menuActions.get(action)?.run(),
  })
  useShortcuts([
    menuCommand('copy', 'Copy entry as markdown'),
    menuCommand('move', 'Move this entry to a journal…'),
    menuCommand('export', 'Export this entry'),
    menuCommand('delete', 'Delete this entry'),
    { id: 'reader.immersive', when: () => zenAvailable, run: () => setReaderZen(!zen) },
    { id: 'reader.older', when: () => !popup, run: () => void flip(1) },
    { id: 'reader.newer', when: () => !popup, run: () => void flip(-1) },
    {
      id: 'reader.edit',
      when: () => editable,
      run: () => {
        carryZen()
        void navigate(`${base}/entry/${id}/edit`, { state: { fromReader: true } })
      },
    },
    {
      id: 'reader.pin',
      when: () => editable && !star.isPending,
      run: () => loaded && star.mutate({ pinned: !loaded.entry.pinned, baseRev: loaded.entry.rev }),
    },
    {
      id: 'reader.star',
      when: () => editable && !star.isPending,
      run: () =>
        loaded && star.mutate({ starred: !loaded.entry.starred, baseRev: loaded.entry.rev }),
    },
  ])

  if (query.isError) {
    const gone = query.error instanceof ApiError && query.error.status === 404
    return (
      <div className="mx-auto flex w-full max-w-(--content-w) flex-col items-start gap-4 px-4 pt-4 medium:px-8">
        <Button variant="text" className={popup ? 'hidden' : 'expanded:hidden'} onClick={back}>
          <Icon name="arrow_back" className="size-5" />
          Back
        </Button>
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-lg">
            {gone ? 'This entry doesn’t exist.' : 'Couldn’t load this entry.'}
          </p>
          <p className="text-on-surface-variant">
            {gone
              ? 'It may have been deleted, or the link is wrong.'
              : 'Check your connection and try again.'}
          </p>
        </div>
        {!gone && (
          <Button variant="tonal" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <Icon name="refresh" className="size-5" />
            Try again
          </Button>
        )}
      </div>
    )
  }
  if (!query.data) return <ReaderSkeleton preview={preview} onBack={back} onClose={onClose} />

  const { entry, location: place, weather, tags, photos, attachments } = query.data
  const readOnly = !!journal?.archivedAt
  // Photos the text doesn't mention (Day One allows that) still belong to the entry.
  const unplaced = photos.filter((p) => !entry.bodyMd.includes(`photo:${p.id}`))
  const unplacedFiles = attachments.filter((a) => !entry.bodyMd.includes(`attachment:${a.id}`))

  return (
    <article className="mx-auto flex w-full max-w-(--content-w) flex-col gap-5 px-4 pt-2 pb-12 medium:px-8 expanded:pb-40 large:pb-24">
      <EntryPaneHeader surface={popup ? 'bg-surface-container-high' : undefined}>
        {zenAvailable && zen ? (
          // Zen hides the list, so Back has nothing beside it: this just leaves zen mode.
          <Button
            variant="text"
            size="icon"
            aria-label="Leave zen mode"
            onClick={() => setReaderZen(false)}
          >
            <Icon name="close" />
          </Button>
        ) : (
          <LeadButton onBack={back} onClose={onClose} />
        )}
        <div className="ml-auto flex items-center gap-1">
          {entry.mood && (
            <span className="grid size-10 place-items-center">
              <MoodBadge mood={entry.mood} className="text-xl" />
            </span>
          )}
          <FlagToggle
            kind="pin"
            on={entry.pinned}
            disabled={readOnly || star.isPending}
            title={readOnly ? 'This journal is archived' : undefined}
            onToggle={() => star.mutate({ pinned: !entry.pinned, baseRev: entry.rev })}
          />
          <FlagToggle
            kind="star"
            on={entry.starred}
            disabled={readOnly || star.isPending}
            title={readOnly ? 'This journal is archived' : undefined}
            onToggle={() => star.mutate({ starred: !entry.starred, baseRev: entry.rev })}
          />
          {zenAvailable && (
            <Button
              variant={zen ? 'tonal' : 'text'}
              size="icon"
              aria-label="Zen mode"
              aria-pressed={zen}
              onClick={() => setReaderZen(!zen)}
              {...zenTip.bind}
            >
              {zenTip.node}
              <Icon name={zen ? 'fullscreen_exit' : 'fullscreen'} />
            </Button>
          )}
          {readOnly ? (
            <Button
              variant="text"
              size="icon"
              aria-label="Edit"
              disabled
              title="This journal is archived"
            >
              <Icon name="edit" />
            </Button>
          ) : (
            <Link
              to={`${base}/entry/${id}/edit`}
              state={{ fromReader: true }} // the editor steps back here instead of stacking a copy
              aria-label="Edit"
              onClick={carryZen}
              className={buttonVariants({ variant: 'text', size: 'icon' })}
              {...editTip.bind}
            >
              {editTip.node}
              <Icon name="edit" />
            </Link>
          )}
          <Button
            variant="text"
            size="icon"
            aria-label="More actions"
            aria-haspopup="menu"
            onClick={(e) => openMenuFrom(e.currentTarget, buildMenu, label)}
            {...moreTip.bind}
          >
            {moreTip.node}
            <Icon name="more_vert" />
          </Button>
        </div>
      </EntryPaneHeader>

      {entry.bodyMd.trim() ? (
        <Markdown
          body={entry.bodyMd}
          photos={photos}
          attachments={attachments}
          highlight={matches.data?.words}
          onOpenPhoto={setViewing}
          onToggleTask={
            editable && !star.isPending
              ? (line) => {
                  const bodyMd = toggleTaskLine(entry.bodyMd, line)
                  if (bodyMd !== null) star.mutate({ bodyMd, baseRev: entry.rev })
                }
              : undefined
          }
        />
      ) : (
        unplaced.length === 0 &&
        unplacedFiles.length === 0 && <p className="text-on-surface-variant italic">No text.</p>
      )}

      {unplaced.length > 0 && (
        <div className="flex flex-col gap-3">
          {unplaced.map((p) => (
            <PhotoImage key={p.id} id={p.id} alt="" photo={p} onOpen={setViewing} />
          ))}
        </div>
      )}

      {unplacedFiles.length > 0 && (
        <div className="flex flex-col gap-3">
          {unplacedFiles.map((a) => (
            <AttachmentView key={a.id} id={a.id} name={a.filename} attachment={a} />
          ))}
        </div>
      )}

      {/* The first line is the title, so when, where and the weather sit under the text, as the
          same chips the editor's footer has (the mood is up top with pin and star). */}
      <footer className="flex flex-col gap-3 border-t border-outline-variant pt-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {journal && <JournalChip journal={journal} variant="footer" archived={readOnly} />}
          <MetaChip icon="calendar_month">
            <EntryWhen {...entry} />
          </MetaChip>
          {place && (
            <MetaChip
              icon="location_on"
              active
              label={`Place details: ${locationLabel(place)}`}
              onClick={() => setDetail('place')}
            >
              <span className="truncate">{locationLabel(place)}</span>
            </MetaChip>
          )}
          {weather && (
            <MetaChip label="Weather details" onClick={() => setDetail('weather')}>
              <WeatherChip
                condition={weather.condition}
                isDay={weather.isDay}
                tempC={weather.tempC}
                plain
              />
            </MetaChip>
          )}
        </div>
        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Tags">
            {tags.map((t) => (
              <li key={t}>
                <Link
                  to={`/?tag=${encodeURIComponent(t)}`}
                  className="state-layer block rounded-sm bg-secondary-container px-2.5 py-1 text-sm text-on-secondary-container"
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </footer>

      <Lightbox
        photos={photos}
        openId={viewing}
        onClose={() => setViewing(null)}
        onChange={setViewing}
      />
      {place && (
        <PlaceDetailDialog
          place={place}
          open={detail === 'place'}
          onClose={() => setDetail(null)}
        />
      )}
      {weather && (
        <WeatherDetailDialog
          weather={weather}
          open={detail === 'weather'}
          onClose={() => setDetail(null)}
        />
      )}
    </article>
  )
}

/** The reader's first button: Back on a phone (the pane has none beside it), Close in the popup. */
function LeadButton({ onBack, onClose }: { onBack: () => void; onClose?: () => void }) {
  return onClose ? (
    <Button variant="text" size="icon" aria-label="Close" onClick={onClose}>
      <Icon name="close" />
    </Button>
  ) : (
    <Button
      variant="text"
      size="icon"
      aria-label="Back"
      className="expanded:hidden"
      onClick={onBack}
    >
      <Icon name="arrow_back" />
    </Button>
  )
}

/** The reader while the entry loads: the title and date from the tapped card when there is one,
 *  then lines where the text will be, so the page doesn't jump when it arrives. */
function ReaderSkeleton({
  preview,
  onBack,
  onClose,
}: {
  preview: EntryPreview | null
  onBack: () => void
  onClose?: () => void
}) {
  return (
    <article
      aria-busy="true"
      className="mx-auto flex w-full max-w-(--content-w) flex-col gap-5 px-4 pt-2 pb-12 medium:px-8"
    >
      <EntryPaneHeader surface={onClose ? 'bg-surface-container-high' : undefined}>
        <LeadButton onBack={onBack} onClose={onClose} />
      </EntryPaneHeader>
      <span role="status" className="sr-only">
        Loading
      </span>
      {preview?.title ? (
        <p className="text-2xl font-semibold">{preview.title}</p>
      ) : (
        <Skeleton className="h-7 w-3/5" />
      )}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="border-t border-outline-variant pt-4 text-sm">
        {preview ? (
          <MetaChip icon="calendar_month">
            <EntryWhen {...preview} />
          </MetaChip>
        ) : (
          <Skeleton className="h-10 w-48 rounded-full" />
        )}
      </div>
    </article>
  )
}
