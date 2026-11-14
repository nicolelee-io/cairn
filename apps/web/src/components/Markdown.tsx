import { createContext, useContext } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Attachment, Photo } from '@cairn/shared'
import { rehypeHighlight } from '../lib/highlightWords.ts'
import { externalHref } from '../lib/externalHref.ts'
import { photoUrl } from '../lib/photos.ts'
import { AttachmentView } from './AttachmentView.tsx'

/**
 * An item with a box and no text (`- [ ]`, what the editor's Checklist button leaves on a fresh line)
 * isn't a task to remark-gfm, which wants content after the marker, so the box showed as brackets.
 * A no-break space gives it content; the text itself is untouched.
 */
export const keepEmptyTasks = (body: string) =>
  body.replace(/^(\s*[-*+] \[[ xX]\])[ \t]*$/gm, '$1 \u00a0')

/** The source line of the list item being drawn, so its checkbox knows which line to flip. */
const ItemLine = createContext<number | null>(null)

const PHOTO_SRC = /^photo:[A-Za-z0-9-]+$/
const ATTACHMENT_SRC = /^attachment:[A-Za-z0-9-]+$/

/**
 * Renders entry text. Safe by construction: react-markdown never renders raw HTML (no rehype-raw)
 * and strips unknown URL schemes, which covers imported Day One content too (SPEC 9).
 *
 * `![](photo:<id>)` (written by the importer) resolves to our authenticated photo route, and
 * `![name](attachment:<id>)` to a player or file card (`AttachmentView`). Any other
 * image is shown as a link instead of being fetched, so an entry can't make the browser load
 * remote content.
 */
export function Markdown({
  body,
  photos,
  attachments = [],
  highlight = [],
  onOpenPhoto,
  onToggleTask,
}: {
  body: string
  photos: Photo[]
  attachments?: Attachment[]
  /** Words to mark in the rendered text (the matches of a search the reader came from). */
  highlight?: string[]
  /** Opens a photo in the viewer; without it a photo links to its original. */
  onOpenPhoto?: (id: string) => void
  /**
   * Makes the checklist boxes tickable: called with the 1-based line of the item in `body`. Without
   * it (the trash, a pending save) the boxes stay read-only.
   */
  onToggleTask?: (line: number) => void
}) {
  const plugins: NonNullable<Options['rehypePlugins']> = highlight.length
    ? [[rehypeHighlight, { words: highlight }]]
    : []
  const byId = new Map(photos.map((p) => [p.id, p]))
  const filesById = new Map(attachments.map((a) => [a.id, a]))
  return (
    <div className="entry-body">
      <ReactMarkdown
        // GFM: ~~strikethrough~~, tables, task lists, bare links and footnotes. Still no raw HTML.
        remarkPlugins={[remarkGfm]}
        rehypePlugins={plugins}
        urlTransform={(url) =>
          PHOTO_SRC.test(url) || ATTACHMENT_SRC.test(url) ? url : defaultUrlTransform(url)
        }
        components={{
          // A wide table scrolls on its own instead of stretching the page.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          li: ({ node, children, className }) => (
            <li className={className}>
              <ItemLine.Provider value={node?.position?.start.line ?? null}>
                {children}
              </ItemLine.Provider>
            </li>
          ),
          input: ({ type, checked }) =>
            type === 'checkbox' ? (
              <TaskCheckbox checked={!!checked} onToggle={onToggleTask} />
            ) : null,
          a: ({ href, children }) =>
            // A footnote's number and its back arrow jump within the entry, not to a new tab.
            href?.startsWith('#') ? (
              <a href={href}>{children}</a>
            ) : (
              <a href={externalHref(href)} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          img: ({ src, alt }) => {
            // Same id shape as photoRefs, so nothing odd is ever put into a /api/photos path.
            if (typeof src === 'string' && PHOTO_SRC.test(src)) {
              const id = src.slice('photo:'.length)
              return (
                <PhotoImage id={id} alt={alt ?? ''} photo={byId.get(id)} onOpen={onOpenPhoto} />
              )
            }
            if (typeof src === 'string' && ATTACHMENT_SRC.test(src)) {
              const id = src.slice('attachment:'.length)
              return <AttachmentView id={id} name={alt ?? ''} attachment={filesById.get(id)} />
            }
            return src ? (
              <a href={src} target="_blank" rel="noopener noreferrer">
                {alt || src}
              </a>
            ) : null
          },
        }}
      >
        {keepEmptyTasks(body)}
      </ReactMarkdown>
    </div>
  )
}

function TaskCheckbox({
  checked,
  onToggle,
}: {
  checked: boolean
  onToggle?: (line: number) => void
}) {
  const line = useContext(ItemLine)
  const live = !!onToggle && line !== null
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={!live}
      readOnly={!live}
      aria-label={live ? (checked ? 'Done, tap to undo' : 'Not done, tap to tick') : undefined}
      onChange={live ? () => onToggle(line) : undefined}
    />
  )
}

/**
 * Display-size image; width/height reserve space so nothing jumps. Opens the viewer when given
 * `onOpen`, else the original in a new tab.
 */
export function PhotoImage({
  id,
  alt,
  photo,
  onOpen,
}: {
  id: string
  alt: string
  photo?: Pick<Photo, 'width' | 'height'>
  onOpen?: (id: string) => void
}) {
  return (
    <a
      href={photoUrl(id, 'original')}
      target="_blank"
      rel="noopener noreferrer"
      className="flex justify-center"
      onClick={
        onOpen
          ? (e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey) return // let "open in new tab" work
              e.preventDefault()
              onOpen(id)
            }
          : undefined
      }
    >
      <img
        src={photoUrl(id, 'display')}
        alt={alt}
        width={photo?.width ?? undefined}
        height={photo?.height ?? undefined}
        loading="lazy"
        className="h-auto max-h-[80dvh] w-auto max-w-full rounded-lg bg-surface-container-high"
      />
    </a>
  )
}
