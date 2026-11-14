import {
  ATTACHMENT_MAX_MB,
  AttachmentSchema,
  ImportPreviewSchema,
  PhotoSchema,
  type Attachment,
  type ImportPreview,
  type Photo,
} from '@cairn/shared'
import type { z } from 'zod'
import { isGatewayDown } from './serverStatus.ts'

export class UploadError extends Error {}

const UNREACHABLE = 'Couldn’t reach the server. Check your connection.'

/** Photos over this are refused by the server; checking here saves the upload. */
export const MAX_PHOTO_BYTES = 50 * 1024 * 1024
/** Settings can lower the attachment limit; the server says so if it has. This is the ceiling. */
const MAX_ATTACHMENT_BYTES = ATTACHMENT_MAX_MB * 1024 * 1024

/** Day One's non-photo types; everything else is offered to the photo upload. */
const ATTACHMENT_FILE = /\.(pdf|mp4|mov|m4a)$/i
export const isAttachmentFile = (f: File) =>
  f.type === 'application/pdf' ||
  f.type.startsWith('video/') ||
  f.type.startsWith('audio/') ||
  (!f.type.startsWith('image/') && ATTACHMENT_FILE.test(f.name))

/**
 * What each picker offers. Photos stay `image/*` alone: that is what makes a phone open its photo
 * picker; adding other types turns it into a files-or-camera chooser.
 */
export const PHOTO_ACCEPT = 'image/*'
export const FILE_ACCEPT = 'application/pdf,video/mp4,video/quicktime,audio/mp4,.pdf,.mp4,.mov,.m4a'

/**
 * Uploads one photo (one file per request, SPEC 7) with progress. fetch can't report upload
 * progress, so this uses XHR. Rejects with an UploadError whose message is fit to show.
 */
export function uploadPhoto(file: File, onProgress?: (fraction: number) => void): Promise<Photo> {
  if (file.size > MAX_PHOTO_BYTES)
    return Promise.reject(new UploadError('That photo is over 50 MB.'))
  const form = new FormData()
  form.set('file', file)
  return send('POST', '/api/photos', form, PhotoSchema, 'photo', onProgress)
}

/** Uploads one attachment as the raw request body (the server streams it to disk). */
export function uploadAttachment(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES)
    return Promise.reject(new UploadError(`That file is over ${ATTACHMENT_MAX_MB} MB.`))
  const url = `/api/attachments?name=${encodeURIComponent(file.name)}`
  return send('PUT', url, file, AttachmentSchema, 'file', onProgress)
}

/**
 * Uploads an export zip to import (the raw body, like an attachment, under the same limit). The
 * server answers with a preview; nothing is imported until it is started.
 */
export function uploadImport(
  file: File,
  maxMb: number,
  onProgress?: (fraction: number) => void,
): Promise<ImportPreview> {
  if (file.size > maxMb * 1024 * 1024)
    return Promise.reject(
      new UploadError(
        `That file is over ${maxMb} MB. Larger exports can be imported from the command line.`,
      ),
    )
  const url = `/api/import?name=${encodeURIComponent(file.name)}`
  return send('PUT', url, file, ImportPreviewSchema, 'file', onProgress)
}

function send<T>(
  method: string,
  url: string,
  body: XMLHttpRequestBodyInit,
  schema: z.ZodType<T>,
  noun: string,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onerror = () => reject(new UploadError(UNREACHABLE))
    xhr.onload = () => {
      // The gateway answered because the app didn't (a tunnel with the app stopped): same as no network.
      if (isGatewayDown(xhr.status)) return reject(new UploadError(UNREACHABLE))
      let reply: unknown = null
      try {
        reply = JSON.parse(xhr.responseText)
      } catch {
        /* not JSON (e.g. a proxy error page) */
      }
      if (xhr.status === 201) {
        const parsed = schema.safeParse(reply)
        return parsed.success ? resolve(parsed.data) : reject(new UploadError('Unexpected reply.'))
      }
      const message = (reply as { message?: unknown } | null)?.message
      reject(
        new UploadError(
          typeof message === 'string'
            ? message
            : xhr.status === 413
              ? `That ${noun} is too large to upload.`
              : 'The upload failed. Try again.',
        ),
      )
    }
    xhr.send(body)
  })
}
