import { Hono } from 'hono'
import { z } from 'zod'
import type { SyncChanges, SyncEstimate } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import { fileSizes } from '../storage/files.ts'
import { toAttachment, toDetail } from './entries.ts'
import { badRequest, reposFor } from './util.ts'

const MAX_PAGE = 500

const Query = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(200),
  journalIds: z
    .string()
    .optional()
    .transform((s) => (s === undefined ? undefined : s.split(',').filter(Boolean))),
})

export function syncRoutes(db: Db, dataDir?: string) {
  const r = new Hono<AuthEnv>()

  r.get('/estimate', async (c) => {
    const { text, files } = reposFor(db, c).sync.estimate()
    const sizes = dataDir
      ? await fileSizes(
          dataDir,
          files.flatMap((f) => [f.displayPath, f.thumbPath]),
        )
      : new Map<string, number>()
    const size = (rel: string | null) => (rel ? (sizes.get(rel) ?? 0) : 0)
    const byJournal = new Map<string, { photos: number; photoBytes: number }>()
    for (const f of files) {
      const j = byJournal.get(f.journalId) ?? { photos: 0, photoBytes: 0 }
      j.photos += 1
      j.photoBytes += size(f.displayPath) + size(f.thumbPath)
      byJournal.set(f.journalId, j)
    }
    const ids = new Set([...text.map((t) => t.journalId), ...byJournal.keys()])
    return c.json<SyncEstimate>({
      journals: [...ids].map((journalId) => ({
        journalId,
        entries: text.find((t) => t.journalId === journalId)?.entries ?? 0,
        textBytes: text.find((t) => t.journalId === journalId)?.textBytes ?? 0,
        photos: byJournal.get(journalId)?.photos ?? 0,
        photoBytes: byJournal.get(journalId)?.photoBytes ?? 0,
      })),
    })
  })

  r.get('/changes', (c) => {
    const q = Query.safeParse(c.req.query())
    if (!q.success) return badRequest(c)
    const page = reposFor(db, c).sync.changes(q.data)
    return c.json<SyncChanges>({
      cursor: page.cursor,
      hasMore: page.hasMore,
      reset: page.reset,
      journals: page.journals.map((j) => ({
        id: j.id,
        name: j.name,
        color: j.color,
        icon: j.icon,
        description: j.description,
        archivedAt: j.archivedAt,
        sortOrder: j.sortOrder,
        createdAt: j.createdAt,
        rev: j.rev,
      })),
      deletedJournalIds: page.deletedJournalIds,
      entries: page.entries.map((d) => {
        const { entry, location, weather, tags } = toDetail({ ...d, photos: [], attachments: [] })
        return { entry, location, weather, tags }
      }),
      deletedEntryIds: page.deletedEntryIds,
      photos: page.photos.map((p) => ({
        id: p.id,
        entryId: p.entryId,
        position: p.position,
        width: p.width,
        height: p.height,
        takenAt: p.takenAt,
        latitude: p.latitude,
        longitude: p.longitude,
        rev: p.rev,
      })),
      deletedPhotoIds: page.deletedPhotoIds,
      attachments: page.attachments.map((a) => ({
        ...toAttachment(a),
        entryId: a.entryId,
        rev: a.rev,
      })),
      deletedAttachmentIds: page.deletedAttachmentIds,
    })
  })

  return r
}
