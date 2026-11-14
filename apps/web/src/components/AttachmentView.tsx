import { useState } from 'react'
import type { Attachment, AttachmentKind } from '@cairn/shared'
import { formatBytes } from '../lib/bytes.ts'
import { Icon, type IconName } from './Icon.tsx'

const ICONS: Record<AttachmentKind, IconName> = {
  pdf: 'picture_as_pdf',
  video: 'video_file',
  audio: 'audio_file',
}

export const attachmentUrl = (id: string) => `/api/attachments/${id}`

/**
 * A video or audio player, or a card that opens a PDF in a new tab. Built from inline elements
 * only, since it sits inside the paragraph react-markdown makes for `![name](attachment:<id>)`.
 * Nothing is transcoded, so a format this browser can't play (or a file that can't be reached,
 * offline) falls back to the card, which still downloads it.
 *
 * `attachment` is missing when the entry's list doesn't have it (yet): the card shows the name
 * from the text.
 */
export function AttachmentView({
  id,
  name,
  attachment,
}: {
  id: string
  name: string
  attachment?: Attachment
}) {
  const [failed, setFailed] = useState(false)
  const kind = attachment?.kind
  const label = attachment?.filename ?? (name || 'Attachment')
  const url = attachmentUrl(id)

  if (kind === 'video' && !failed) {
    return (
      <span className="block">
        <video
          controls
          preload="metadata"
          playsInline
          src={url}
          onError={() => setFailed(true)}
          aria-label={label}
          className="max-h-[80dvh] w-auto max-w-full rounded-lg bg-surface-container-high"
        />
        <DownloadLink id={id} label={label} />
      </span>
    )
  }
  if (kind === 'audio' && !failed) {
    return (
      <span className="block rounded-xl bg-surface-container-low p-3">
        <span className="mb-2 flex items-center gap-2 text-sm">
          <Icon name="audio_file" className="size-5 text-on-surface-variant" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </span>
        <audio
          controls
          preload="metadata"
          src={url}
          onError={() => setFailed(true)}
          aria-label={label}
          className="w-full"
        />
      </span>
    )
  }
  return (
    <a
      href={kind === 'pdf' ? url : `${url}?download`}
      target="_blank"
      rel="noopener noreferrer"
      className="state-layer flex items-center gap-3 rounded-xl bg-surface-container-low p-3 text-on-surface no-underline"
    >
      <Icon name={kind ? ICONS[kind] : 'attach_file'} className="text-primary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-sans text-sm">{label}</span>
        <span className="font-sans text-xs text-on-surface-variant">
          {failed
            ? 'Can’t play this here. Tap to download.'
            : attachment
              ? `${kindLabel(attachment.kind)} · ${formatBytes(attachment.bytes)}`
              : 'Attachment'}
        </span>
      </span>
      <Icon
        name={kind === 'pdf' ? 'open_in_new' : 'download'}
        className="size-5 text-on-surface-variant"
      />
    </a>
  )
}

function DownloadLink({ id, label }: { id: string; label: string }) {
  return (
    <a
      href={`${attachmentUrl(id)}?download`}
      className="mt-1 flex items-center gap-1 font-sans text-xs text-on-surface-variant"
    >
      <Icon name="download" className="size-4" />
      <span className="truncate">{label}</span>
    </a>
  )
}

const kindLabel = (k: AttachmentKind) => ({ pdf: 'PDF', video: 'Video', audio: 'Audio' })[k]
