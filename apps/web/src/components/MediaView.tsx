import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { MediaItem, MediaKind, Photo } from '@cairn/shared'
import { cn } from '../lib/cn.ts'
import { useMenuTrigger, type MenuAction } from '../lib/contextMenu.ts'
import { downloadFile } from '../lib/menuActions.ts'
import { photoUrl } from '../lib/photos.ts'
import { useMedia } from '../lib/queries.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'
import { useLoadMore } from '../lib/useLoadMore.ts'
import { attachmentUrl } from './AttachmentView.tsx'
import { EmptyState } from './EmptyState.tsx'
import { Icon, type IconName } from './Icon.tsx'
import { Lightbox } from './Lightbox.tsx'
import { NeedsConnection } from './NeedsConnection.tsx'
import { LoadingState } from './Spinner.tsx'

const CHIPS: { kind: MediaKind; label: string; icon: IconName }[] = [
  { kind: 'photo', label: 'Photos', icon: 'image' },
  { kind: 'video', label: 'Video', icon: 'video_file' },
  { kind: 'audio', label: 'Audio', icon: 'audio_file' },
  { kind: 'pdf', label: 'PDF', icon: 'picture_as_pdf' },
]
const FILE_ICON: Record<Exclude<MediaKind, 'photo'>, IconName> = {
  video: 'video_file',
  audio: 'audio_file',
  pdf: 'picture_as_pdf',
}

/** The entry's own day: "17" over "November 2025", in the entry's zone. */
function tileDate(item: MediaItem) {
  const parts = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...opts, timeZone: item.timezone }).format(item.createdAt)
  return { day: parts({ day: '2-digit' }), month: parts({ month: 'long', year: 'numeric' }) }
}

/**
 * The Entries screen's Media view: every photo and file of the journal as a grid of tiles showing
 * their entry's date, newest first (Day One's Media). The chips narrow it by type (none chosen
 * means all); a tile opens its entry. Served by `/api/media`, so it needs a connection.
 */
export function MediaView() {
  const { journalId, entryId, base } = useBrowseParams()
  const down = useServerDown()
  const [chosen, setChosen] = useState<MediaKind[]>([])
  // The chips' order, whatever order they were tapped in, so the query key doesn't vary.
  const kinds = useMemo(() => CHIPS.map((c) => c.kind).filter((k) => chosen.includes(k)), [chosen])
  const media = useMedia(journalId, kinds)
  const sentinel = useLoadMore(media)
  const items = useMemo(() => media.data?.pages.flatMap((p) => p.items) ?? [], [media.data])
  // The grid's photos, in order, for the viewer's swiping. The Media endpoint has no sizes or GPS
  // for them, and the viewer doesn't need any.
  const [viewing, setViewing] = useState<string | null>(null)
  const photos = useMemo<Photo[]>(
    () =>
      items
        .filter((i) => i.kind === 'photo')
        .map((i, position) => ({
          id: i.id,
          position,
          width: null,
          height: null,
          takenAt: null,
          latitude: null,
          longitude: null,
        })),
    [items],
  )
  const toggle = (k: MediaKind) =>
    setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))

  return (
    <div className="flex flex-col gap-2">
      {down ? (
        <NeedsConnection onRetry={() => void media.refetch()} />
      ) : (
        <>
          <div
            role="group"
            aria-label="Media types"
            className="flex gap-1.5 overflow-x-auto pb-1 [&>:first-child]:ml-auto [&>:last-child]:mr-auto"
          >
            {CHIPS.map((c) => (
              <button
                key={c.kind}
                type="button"
                aria-pressed={chosen.includes(c.kind)}
                onClick={() => toggle(c.kind)}
                className={cn(
                  'state-layer inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-sm',
                  chosen.includes(c.kind)
                    ? 'border-transparent bg-secondary-container text-on-secondary-container'
                    : 'border-outline-variant text-on-surface-variant',
                )}
              >
                <Icon name={c.icon} className="size-4" />
                {c.label}
              </button>
            ))}
          </div>
          {media.isPending && <LoadingState />}
          {media.isError && <p role="alert">Couldn’t load the media.</p>}
          {media.isSuccess && items.length === 0 && (
            <EmptyState>
              {kinds.length ? 'Nothing of that type yet.' : 'No photos or files yet.'}
            </EmptyState>
          )}
          <ul className="grid grid-cols-2 gap-3 medium:grid-cols-3 expanded:grid-cols-2">
            {items.map((item) => (
              <li key={item.id}>
                <Tile
                  item={item}
                  to={`${base}/entry/${item.entryId}`}
                  replace={!!entryId}
                  onView={setViewing}
                />
              </li>
            ))}
          </ul>
          <div ref={sentinel} />
          <Lightbox
            photos={photos}
            openId={viewing}
            onClose={() => setViewing(null)}
            onChange={setViewing}
          />
        </>
      )}
    </div>
  )
}

/**
 * `replace`: an entry is already open beside the grid, so this one takes its place in history.
 * Right-click, a long press or the Menu key opens the tile's menu: a photo can be viewed full
 * screen (swiping on through the grid's photos) or downloaded, a file opened or downloaded, and
 * either opens its entry.
 */
function Tile({
  item,
  to,
  replace,
  onView,
}: {
  item: MediaItem
  to: string
  replace: boolean
  onView: (photoId: string) => void
}) {
  const { day, month } = tileDate(item)
  const navigate = useNavigate()
  const label = item.kind === 'photo' ? 'Photo' : (item.filename ?? item.kind)
  const trigger = useMenuTrigger((): MenuAction[] => {
    const openEntry: MenuAction = {
      id: 'entry',
      label: 'Open entry',
      icon: 'article',
      run: () => void navigate(to, { replace }),
    }
    if (item.kind === 'photo')
      return [
        { id: 'view', label: 'View photo', icon: 'fullscreen', run: () => onView(item.id) },
        openEntry,
        {
          id: 'download',
          label: 'Download original',
          icon: 'download',
          run: () => downloadFile(`${photoUrl(item.id, 'original')}?download`),
        },
      ]
    return [
      {
        id: 'open',
        label: 'Open file',
        icon: 'open_in_new',
        run: () => void window.open(attachmentUrl(item.id), '_blank', 'noopener'),
      },
      openEntry,
      {
        id: 'download',
        label: 'Download',
        icon: 'download',
        run: () => downloadFile(`${attachmentUrl(item.id)}?download`),
      },
    ]
  }, label)
  return (
    <Link
      to={to}
      replace={replace}
      {...trigger}
      aria-label={`${label}, ${day} ${month}`}
      className="state-layer relative block aspect-square overflow-hidden rounded-2xl bg-surface-container-high [-webkit-touch-callout:none]"
    >
      {item.kind === 'photo' ? (
        <img
          src={photoUrl(item.id, 'thumb')}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-on-surface-variant">
          <Icon name={FILE_ICON[item.kind]} className="size-10" />
          <span className="line-clamp-2 text-center text-xs break-all">{item.filename}</span>
        </div>
      )}
      {/* A scrim under the date so it reads on any photo. */}
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/60 to-transparent p-3 pt-8 text-white">
        <p className="text-3xl leading-none">{day}</p>
        <p className="text-sm">{month}</p>
      </div>
    </Link>
  )
}
