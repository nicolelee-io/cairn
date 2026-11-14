import { beforeEach, describe, expect, it } from 'vitest'
import { attachmentMarkdown } from '@cairn/shared'
import { addUser, memoryDb } from '../test-helpers.ts'
import { createRepos } from './index.ts'

let repos: ReturnType<typeof createRepos>
let other: ReturnType<typeof createRepos>
let journal: string

const photoInput = (id: string) => ({
  id,
  originalPath: `p/${id}`,
  mime: 'image/jpeg',
  bytes: 1,
  sha256: id,
})
const fileInput = (id: string, kind: 'video' | 'audio' | 'pdf') => ({
  id,
  kind,
  path: `a/${id}`,
  mime: 'x/y',
  bytes: 1,
  sha256: id,
  filename: `${id}.bin`,
})

/** An entry at `iso` that carries the given photos and files. */
function entryWith(
  r: typeof repos,
  journalId: string,
  iso: string,
  media: { photos?: string[]; files?: [string, 'video' | 'audio' | 'pdf'][] },
) {
  for (const id of media.photos ?? []) r.photos.add(photoInput(id))
  for (const [id, kind] of media.files ?? []) r.attachments.add(fileInput(id, kind))
  const body = [
    ...(media.photos ?? []).map((id) => `![](photo:${id})`),
    ...(media.files ?? []).map(([id]) => attachmentMarkdown(id, `${id}.bin`)),
  ].join('\n')
  return r.entries.create({
    journalId,
    bodyMd: body,
    createdAt: Date.parse(iso),
    timezone: 'UTC',
  })
}

beforeEach(async () => {
  const { db } = memoryDb()
  const [a, b] = [await addUser(db, 'a'), await addUser(db, 'b')]
  repos = createRepos(db, a.id)
  other = createRepos(db, b.id)
  journal = repos.journals.create({ name: 'J' }).id
})

describe('gallery', () => {
  it('merges photos and files newest entry first, and pages without skipping', () => {
    entryWith(repos, journal, '2026-01-01T00:00:00Z', { photos: ['p1'] })
    entryWith(repos, journal, '2026-02-01T00:00:00Z', { files: [['f1', 'video']] })
    entryWith(repos, journal, '2026-03-01T00:00:00Z', { photos: ['p2'], files: [['f2', 'pdf']] })
    const all = repos.gallery.page()
    expect(all.items.map((i) => i.id).sort()).toEqual(['f1', 'f2', 'p1', 'p2'])
    expect(all.items.map((i) => i.createdAt)).toEqual(
      [...all.items.map((i) => i.createdAt)].sort((a, b) => b - a),
    )
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const p = repos.gallery.page({ limit: 1, cursor })
      seen.push(...p.items.map((i) => i.id))
      cursor = p.nextCursor ?? undefined
    } while (cursor)
    expect(seen.sort()).toEqual(['f1', 'f2', 'p1', 'p2'])
  })

  it('filters by kind and journal, and leaves out deleted entries and archived journals', () => {
    entryWith(repos, journal, '2026-01-01T00:00:00Z', { photos: ['p1'], files: [['f1', 'audio']] })
    const second = repos.journals.create({ name: 'K' }).id
    const gone = entryWith(repos, second, '2026-02-01T00:00:00Z', { photos: ['p2'] })
    expect(repos.gallery.page({ kinds: ['audio'] }).items.map((i) => i.id)).toEqual(['f1'])
    expect(
      repos.gallery
        .page({ kinds: ['photo', 'pdf'] })
        .items.map((i) => i.id)
        .sort(),
    ).toEqual(['p1', 'p2'])
    expect(repos.gallery.page({ journalId: second }).items.map((i) => i.id)).toEqual(['p2'])
    repos.entries.softDelete(gone.id)
    expect(
      repos.gallery
        .page()
        .items.map((i) => i.id)
        .sort(),
    ).toEqual(['f1', 'p1'])
    repos.journals.update(journal, { archived: true })
    expect(repos.gallery.page().items).toEqual([])
    expect(repos.gallery.page({ journalId: journal }).items).toHaveLength(2)
  })

  it('counts photos and files for the Details view, the same entries as the feed', () => {
    entryWith(repos, journal, '2026-01-01T00:00:00Z', { photos: ['p1'], files: [['f1', 'audio']] })
    const second = repos.journals.create({ name: 'K' }).id
    const gone = entryWith(repos, second, '2026-02-01T00:00:00Z', { photos: ['p2', 'p3'] })
    expect(repos.insights.details('2026-10-10').media).toBe(4)
    expect(repos.insights.details('2026-10-10', journal).media).toBe(2)
    repos.entries.softDelete(gone.id)
    expect(repos.insights.details('2026-10-10').media).toBe(2)
    expect(other.insights.details('2026-10-10', journal).media).toBe(0)
  })

  it("never shows another user's media", () => {
    entryWith(repos, journal, '2026-01-01T00:00:00Z', { photos: ['p1'] })
    expect(other.gallery.page().items).toEqual([])
    expect(other.gallery.page({ journalId: journal }).items).toEqual([])
  })

  it('rejects a malformed cursor', () => {
    expect(() => repos.gallery.page({ cursor: 'nope' })).toThrow()
  })
})
