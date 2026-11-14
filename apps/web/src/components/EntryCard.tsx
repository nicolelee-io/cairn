import { Link } from 'react-router'
import { entryLabel, type Journal, type TimelineItem } from '@cairn/shared'
import { cn } from '../lib/cn.ts'
import { openMenuFrom, useMenuTrigger } from '../lib/contextMenu.ts'
import { useEntryMenu } from '../lib/menuActions.ts'
import { previewOf, withList } from '../lib/entryPreview.ts'
import { photoUrl } from '../lib/photos.ts'
import { shortDate, timeLabel } from '../lib/format.ts'
import { journalWash } from '../lib/journalColors.ts'
import { isIos } from '../lib/pointer.ts'
import { useJournal } from '../lib/queries.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'
import { Icon } from './Icon.tsx'
import { JournalChip } from './JournalBadge.tsx'
import { Marked } from './Marked.tsx'
import { MoodBadge } from './MoodBadge.tsx'

/**
 * One entry in the list: a bold title, a two-line excerpt and a meta line, with the first photo as
 * a thumbnail (Day One's rows with Pixel Journal's photo). The journal is named only when the list
 * spans several of them.
 */
export function EntryCard({
  item,
  to,
  selected = false,
  journal,
  snippet,
  snippetField = 'body',
  titleMarked,
  showDate = false,
  onOpen,
  openedFrom,
}: {
  item: TimelineItem
  to: string
  /** The entry open in the reader pane. */
  selected?: boolean
  /** Shown in the meta line; omit when the list is already one journal. */
  journal?: Journal
  /** A search hit's text around the match, shown instead of the excerpt. */
  snippet?: string
  /** Where the snippet is from; a match in the tags or the place says so, a body match doesn't. */
  snippetField?: 'body' | 'tags' | 'place'
  /** The title with the search's matched words marked; replaces the plain title. */
  titleMarked?: string
  /** Put the date in the meta line, for lists that aren't grouped by day. */
  showDate?: boolean
  /** Open the entry in a popup instead of navigating (desktop only; the caller gates it). A new-tab click still follows the link. */
  onOpen?: () => void
  /** A fixed list this card belongs to; the reader then flips within it (see `withList`). */
  openedFrom?: TimelineItem[]
}) {
  // The journal's colour tints every card, even in a single-journal list (`journal` is only for naming it).
  const tint = useJournal(item.journalId)?.color
  const thumb = item.photos[0]
  const more = item.photoCount - 1
  const hasFlags = item.mood !== null || item.pinned || item.starred || item.hasAttachments
  const empty = !item.title && !item.excerpt && !snippet
  // Another entry beside the one already open replaces it, so Back goes to the list (lib/navigation.ts).
  const { entryId } = useBrowseParams()

  // Right-click, long-press and the ⋮ button share one menu (lib/menuActions.ts).
  const label = entryLabel(item)
  const [path = to, query] = to.split('?')
  const build = useEntryMenu(
    { ...item, label },
    {
      editTo: `${path}/edit${query ? `?${query}` : ''}`,
    },
  )
  const trigger = useMenuTrigger(build, label)

  return (
    <div className="relative">
      <Link
        to={to}
        {...trigger}
        onClick={(e) => {
          if (!onOpen || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          e.preventDefault()
          onOpen()
        }}
        replace={!!entryId}
        state={openedFrom ? withList(item, openedFrom) : previewOf(item)}
        aria-current={selected ? 'page' : undefined}
        data-entry-card="" // the keyboard's j/k walk these (lib/cardFocus.ts)
        style={selected ? undefined : { background: journalWash(tint, 'surface-container-low', 8) }}
        className={cn(
          'state-layer flex scroll-mt-32 gap-3 rounded-xl p-4 [-webkit-touch-callout:none]',
          selected
            ? 'bg-secondary-container text-on-secondary-container'
            : 'bg-surface-container-low',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {item.title && (
            <p className="line-clamp-2 leading-snug font-medium">
              {titleMarked ? <Marked text={titleMarked} /> : item.title}
            </p>
          )}
          {snippet ? (
            <p className="line-clamp-3 font-entry text-sm leading-relaxed text-on-surface-variant">
              {snippetField !== 'body' && (
                <span className="font-sans text-xs tracking-wide uppercase">
                  {snippetField === 'tags' ? 'Tags' : 'Place'}{' '}
                </span>
              )}
              <Marked text={snippet} />
            </p>
          ) : (
            item.excerpt && (
              <p className="line-clamp-2 font-entry text-sm leading-relaxed text-on-surface-variant">
                {item.excerpt}
              </p>
            )
          )}
          {empty && (
            <p className="text-sm text-on-surface-variant italic">
              {item.photoCount > 0 ? 'Photo' : item.hasAttachments ? 'Attachment' : 'No text'}
            </p>
          )}

          {/* Two lines when the list spans journals: the journal on its own line so its name always
            shows, then time and place. In a single-journal list it is just the second line. */}
          <div
            className={cn(
              'mt-0.5 flex flex-col gap-0.5 text-xs text-on-surface-variant',
              isIos() && 'pr-8', // room for the ⋮ button
            )}
          >
            {journal && <JournalChip journal={journal} variant="card" />}
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0">
                {showDate && `${shortDate(item.createdAt, item.timezone)} · `}
                {item.allDay ? 'All day' : timeLabel(item.createdAt, item.timezone)}
              </span>
              {item.placeName && (
                <span className="inline-flex min-w-0 items-center gap-0.5">
                  <Icon name="location_on" className="size-3.5 shrink-0" />
                  <span className="truncate">{item.placeName}</span>
                </span>
              )}
            </span>
          </div>
        </div>

        {(thumb || hasFlags) && (
          // Flags (mood, attachments, pin, star) sit top-right above the thumbnail, so they line up
          // whether or not the entry has a photo.
          <div className="flex shrink-0 flex-col items-end gap-2 self-start">
            {hasFlags && (
              <span className="flex items-center gap-1.5">
                <MoodBadge mood={item.mood} className="text-sm leading-none" />
                {item.hasAttachments && (
                  <Icon name="attach_file" className="size-4 text-on-surface-variant" />
                )}
                {item.pinned && <Icon name="keep" filled className="size-4" />}
                {item.starred && <Icon name="star" filled className="size-4 text-tertiary" />}
              </span>
            )}
            {thumb && (
              <div className="relative">
                <img
                  src={photoUrl(thumb.id, 'thumb')}
                  alt=""
                  loading="lazy"
                  className="size-20 rounded-lg bg-surface-container-high object-cover"
                />
                {more > 0 && (
                  <span className="absolute right-1 bottom-1 rounded-sm bg-scrim/60 px-1.5 text-xs text-white">
                    +{more}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </Link>
      {/* Only on iOS, where a long press can't be relied on (lib/pointer.ts). Beside the link, not
        inside it (a button can't sit in an anchor); bottom right of the text column, clear of the
        thumbnail. */}
      {isIos() && (
        <button
          type="button"
          aria-label={`Actions for ${label}`}
          aria-haspopup="menu"
          onClick={(e) => openMenuFrom(e.currentTarget, build, label, true)}
          className={cn(
            'state-layer absolute bottom-2 grid size-8 cursor-pointer place-items-center rounded-full text-on-surface-variant',
            thumb ? 'right-[6.75rem]' : 'right-2',
          )}
        >
          <Icon name="more_vert" className="size-5" />
        </button>
      )}
    </div>
  )
}
