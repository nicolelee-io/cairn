import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attachment, Photo } from '@cairn/shared'
import { isAttachmentFile, uploadAttachment, uploadPhoto, UploadError } from './upload.ts'

export type Uploaded = { photo: Photo } | { attachment: Attachment }

export interface Upload {
  key: number
  name: string
  /** 0..1 */
  progress: number
  error: string | null
}

/**
 * Uploads photos and attachments one at a time (a phone on a slow link does better than with several in flight)
 * and reports each as it lands, so the editor can drop its reference into the text. Failed ones
 * stay listed with their message until dismissed.
 */
export function useUploads(onUploaded: (item: Uploaded) => void) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const queue = useRef<{ key: number; file: File }[]>([])
  const running = useRef(false)
  const nextKey = useRef(0)
  const cb = useRef(onUploaded)
  const alive = useRef(true)
  useEffect(() => {
    cb.current = onUploaded
  })
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const patch = (key: number, p: Partial<Upload>) =>
    alive.current && setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)))

  const drain = useCallback(async () => {
    if (running.current) return
    running.current = true
    for (let job = queue.current.shift(); job; job = queue.current.shift()) {
      try {
        const progress = (f: number) => patch(job.key, { progress: f })
        const item: Uploaded = isAttachmentFile(job.file)
          ? { attachment: await uploadAttachment(job.file, progress) }
          : { photo: await uploadPhoto(job.file, progress) }
        if (alive.current) setUploads((u) => u.filter((x) => x.key !== job.key))
        cb.current(item)
      } catch (e) {
        patch(job.key, {
          error: e instanceof UploadError ? e.message : 'The upload failed. Try again.',
        })
      }
    }
    running.current = false
  }, [])

  const add = useCallback(
    (files: File[]) => {
      // Anything else (a .txt, a .zip) would only be refused; the server checks the bytes anyway.
      const wanted = files.filter(
        (f) => f.type.startsWith('image/') || f.type === '' || isAttachmentFile(f),
      )
      const added = wanted.map((file) => ({ key: nextKey.current++, file }))
      if (!added.length) return
      queue.current.push(...added)
      setUploads((u) => [
        ...u,
        ...added.map((a) => ({ key: a.key, name: a.file.name, progress: 0, error: null })),
      ])
      void drain()
    },
    [drain],
  )

  const dismiss = (key: number) => setUploads((u) => u.filter((x) => x.key !== key))
  return { uploads, add, dismiss, busy: uploads.some((u) => !u.error) }
}
