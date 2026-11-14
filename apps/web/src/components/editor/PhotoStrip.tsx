import { Icon } from '../Icon.tsx'
import { Button } from '../ui/button.tsx'
import type { Attachment } from '@cairn/shared'
import type { Upload } from '../../lib/useUploads.ts'
import { photoUrl } from '../../lib/photos.ts'

/**
 * The photos the text refers to, in the order they appear, photos and files the entry has but the
 * text doesn't mention, plus uploads in flight. The text is the
 * source of truth: removing or moving a photo here edits the markdown, and Save makes the server
 * follow (it attaches new photos, deletes removed ones and re-orders the rest).
 */
export function PhotoStrip({
  ids,
  looseIds,
  onAddLoose,
  looseFiles,
  onAddLooseFile,
  onRemoveLoose,
  uploads,
  onRemove,
  onMove,
  onDismiss,
}: {
  ids: string[]
  /** Photos the entry has but the text doesn't mention. */
  looseIds: string[]
  onAddLoose: (id: string) => void
  /** Attachments the entry has but the text doesn't mention. */
  looseFiles: Attachment[]
  onAddLooseFile: (a: Attachment) => void
  /** Removes a loose photo or attachment (with the next save). */
  onRemoveLoose: (id: string) => void
  uploads: Upload[]
  onRemove: (id: string) => void
  /** Swap this photo with its neighbour (-1 earlier, +1 later). */
  onMove: (id: string, dir: -1 | 1) => void
  onDismiss: (key: number) => void
}) {
  if (!ids.length && !looseIds.length && !looseFiles.length && !uploads.length) return null
  return (
    <div className="flex flex-col gap-2 border-t border-outline-variant py-3">
      {(ids.length > 0 || looseIds.length > 0) && (
        <ul className="flex gap-3 overflow-x-auto pb-1">
          {ids.map((id, i) => (
            <li key={id} className="relative shrink-0">
              <img
                src={photoUrl(id, 'thumb')}
                alt={`Photo ${i + 1}`}
                className="size-24 rounded-lg bg-surface-container-high object-cover"
              />
              <Button
                variant="tonal"
                size="icon"
                aria-label={`Remove photo ${i + 1}`}
                className="absolute top-1 right-1 size-7"
                onClick={() => onRemove(id)}
              >
                <Icon name="close" className="size-4" />
              </Button>
              {ids.length > 1 && (
                <div className="absolute inset-x-1 bottom-1 flex justify-between">
                  <Button
                    variant="tonal"
                    size="icon"
                    aria-label={`Move photo ${i + 1} earlier`}
                    className="size-7"
                    disabled={i === 0}
                    onClick={() => onMove(id, -1)}
                  >
                    <Icon name="chevron_left" className="size-4" />
                  </Button>
                  <Button
                    variant="tonal"
                    size="icon"
                    aria-label={`Move photo ${i + 1} later`}
                    className="size-7"
                    disabled={i === ids.length - 1}
                    onClick={() => onMove(id, 1)}
                  >
                    <Icon name="chevron_right" className="size-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
          {looseIds.map((id) => (
            <li key={id} className="relative shrink-0">
              <img
                src={photoUrl(id, 'thumb')}
                alt="Photo not in the text"
                className="size-24 rounded-lg bg-surface-container-high object-cover opacity-80"
              />
              <Button
                variant="tonal"
                size="icon"
                aria-label="Remove photo not in the text"
                className="absolute top-1 right-1 size-7"
                onClick={() => onRemoveLoose(id)}
              >
                <Icon name="close" className="size-4" />
              </Button>
              <Button
                variant="tonal"
                size="sm"
                title="This photo shows after the text. Add it to the text to place it."
                className="absolute inset-x-1 bottom-1 h-7 px-2 text-xs"
                onClick={() => onAddLoose(id)}
              >
                Add to text
              </Button>
            </li>
          ))}
        </ul>
      )}
      {looseFiles.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-sm">
          <Icon name="attach_file" className="size-5 text-on-surface-variant" />
          <span className="min-w-0 flex-1 truncate">{a.filename}</span>
          <Button
            variant="text"
            size="sm"
            title="This file shows after the text. Add it to the text to place it."
            onClick={() => onAddLooseFile(a)}
          >
            Add to text
          </Button>
          <Button
            variant="text"
            size="icon"
            aria-label={`Remove ${a.filename}`}
            onClick={() => onRemoveLoose(a.id)}
          >
            <Icon name="close" className="size-5" />
          </Button>
        </div>
      ))}
      {uploads.map((u) => (
        <div
          key={u.key}
          role={u.error ? 'alert' : 'status'}
          className="flex items-center gap-2 text-sm"
        >
          <span className="min-w-0 flex-1 truncate">
            {u.name}
            {u.error ? (
              <span className="text-error"> · {u.error}</span>
            ) : (
              <span className="text-on-surface-variant"> · {Math.round(u.progress * 100)}%</span>
            )}
          </span>
          {u.error ? (
            <Button variant="text" size="sm" onClick={() => onDismiss(u.key)}>
              Dismiss
            </Button>
          ) : (
            <progress value={u.progress} className="h-1 w-24 accent-primary" />
          )}
        </div>
      ))}
    </div>
  )
}
