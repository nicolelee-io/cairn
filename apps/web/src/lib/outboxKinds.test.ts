import 'fake-indexeddb/auto'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadDraft } from './draft.ts'
import { deleteLocalDb, localDb } from './localDb.ts'
import {
  dismissOutboxFailures,
  enqueue,
  flushOutbox,
  loadOutbox,
  outboxKey,
  outboxState,
  sendOrQueueWrite,
  type OutboxItem,
} from './outbox.ts'

// Journal, settings and delete writes in the outbox (docs/design/offline-writes-proposal.md, phase 1).

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  dismissOutboxFailures()
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await deleteLocalDb('u1')
})

const draft = {
  newId: null,
  journalId: 'j1',
  bodyMd: 'my words',
  createdAt: 1,
  timezone: 'UTC',
  allDay: false,
  starred: false,
  pinned: false,
  mood: null,
  location: null,
  weather: null,
  baseRev: 3,
}
const row = (
  o: Partial<OutboxItem> & Pick<OutboxItem, 'entryId' | 'method' | 'path'>,
): OutboxItem => ({
  target: o.entryId,
  body: {},
  queuedAt: 1,
  draft: null,
  ...o,
})
const entryPatch = (id: string, body = {}): OutboxItem =>
  row({
    entryId: id,
    method: 'PATCH',
    path: `/entries/${id}`,
    body: { baseRev: 3, ...body },
    draft,
  })
const entryPost = (id: string, journalId = 'j1'): OutboxItem =>
  row({
    entryId: id,
    method: 'POST',
    path: '/entries',
    body: { id, journalId, bodyMd: 'x' },
    draft,
  })
const delEntry = (id: string): OutboxItem =>
  row({
    entryId: outboxKey('delete-entry', id),
    kind: 'delete-entry',
    method: 'DELETE',
    path: `/entries/${id}`,
  })
const jPost = (id: string, body = { name: 'New' }): OutboxItem =>
  row({
    entryId: outboxKey('journal', id),
    kind: 'journal',
    method: 'POST',
    path: '/journals',
    body: { id, ...body },
  })
const jPatch = (id: string, body: Record<string, unknown>): OutboxItem =>
  row({
    entryId: outboxKey('journal', id),
    kind: 'journal',
    method: 'PATCH',
    path: `/journals/${id}`,
    body,
  })
const delJournal = (id: string): OutboxItem =>
  row({
    entryId: outboxKey('delete-journal', id),
    kind: 'delete-journal',
    method: 'DELETE',
    path: `/journals/${id}`,
  })
const mePatch = (body: Record<string, unknown>): OutboxItem =>
  row({ entryId: outboxKey('me'), kind: 'me', method: 'PATCH', path: '/auth/me', body })
const order = (ids: string[]): OutboxItem =>
  row({
    entryId: outboxKey('journal-order'),
    kind: 'journal-order',
    method: 'PUT',
    path: '/journals/order',
    body: { ids },
  })

describe('outboxKey', () => {
  it('shares a key between a write and its delete', () => {
    expect(outboxKey('entry', 'e')).toBe(outboxKey('delete-entry', 'e'))
    expect(outboxKey('journal', 'j')).toBe(outboxKey('delete-journal', 'j'))
    expect(outboxKey('journal', 'j')).not.toBe('j')
    expect(outboxKey('me')).toBe('me')
  })
})

describe('merging journal, settings and order writes', () => {
  it('merges a journal PATCH over a journal PATCH, later wins', async () => {
    await enqueue('u1', jPatch('j9', { name: 'A', color: '#111111' }))
    await enqueue('u1', jPatch('j9', { name: 'B' }))
    const items = await loadOutbox('u1')
    expect(items).toHaveLength(1)
    expect(items[0]!.body).toEqual({ name: 'B', color: '#111111' })
  })

  it('folds create fields into a waiting journal create and keeps archive as a follow-up', async () => {
    await enqueue('u1', jPost('j9'))
    await enqueue('u1', jPatch('j9', { name: 'Renamed', archived: true }))
    const [item] = await loadOutbox('u1')
    expect(item!.method).toBe('POST')
    expect(item!.body).toEqual({ id: 'j9', name: 'Renamed' })
    expect(item!.after).toEqual({ archived: true })
  })

  it('merges me over me, and replaces journal-order keeping its place', async () => {
    await enqueue('u1', mePatch({ tempUnit: 'f' }))
    await enqueue('u1', order(['a', 'b']))
    await enqueue('u1', mePatch({ autoLocation: false, tempUnit: 'c' }))
    await enqueue('u1', order(['b', 'a']))
    const items = await loadOutbox('u1')
    expect(items.map((i) => i.entryId)).toEqual(['me', 'journal-order'])
    expect(items[0]!.body).toEqual({ tempUnit: 'c', autoLocation: false })
    expect(items[1]!.body).toEqual({ ids: ['b', 'a'] })
  })
})

describe('merging deletes', () => {
  it('replaces a waiting entry edit with the delete, keeping the edit draft', async () => {
    await enqueue('u1', entryPatch('e1', { bodyMd: 'edit' }))
    await enqueue('u1', delEntry('e1'))
    const items = await loadOutbox('u1')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'delete-entry', method: 'DELETE' })
    expect(items[0]!.draft).toMatchObject({ bodyMd: 'my words' })
  })

  it('queues nothing for an entry whose create is still waiting', async () => {
    await enqueue('u1', entryPost('e1'))
    await enqueue('u1', delEntry('e1'))
    expect(await loadOutbox('u1')).toEqual([])
    expect(outboxState().pending).toBe(0)
  })

  it('keeps the delete when an edit arrives after it', async () => {
    await enqueue('u1', delEntry('e1'))
    await enqueue('u1', entryPatch('e1', { bodyMd: 'late' }))
    const items = await loadOutbox('u1')
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('delete-entry')
  })

  it('cancels a journal create on delete, and the entries written into it', async () => {
    await enqueue('u1', jPost('j9'))
    await enqueue('u1', entryPost('n1', 'j9'))
    await enqueue('u1', entryPost('n2', 'j1'))
    await enqueue('u1', delJournal('j9'))
    expect((await loadOutbox('u1')).map((i) => i.entryId)).toEqual(['n2'])
  })

  it('replaces a waiting journal PATCH with the delete', async () => {
    await enqueue('u1', jPatch('j2', { name: 'x' }))
    await enqueue('u1', delJournal('j2'))
    const items = await loadOutbox('u1')
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('delete-journal')
  })
})

describe('flushOutbox per kind', () => {
  const journal = {
    id: 'j9',
    name: 'New',
    color: null,
    icon: null,
    description: null,
    sortOrder: 0,
    archivedAt: null,
    createdAt: 1,
    rev: 1,
    entryCount: 0,
  }

  it('replays an old row with no kind as an entry', async () => {
    await localDb('u1').outbox.add({
      target: 'e1',
      entryId: 'e1',
      method: 'PATCH',
      path: '/entries/e1',
      body: { baseRev: 3 },
      queuedAt: 1,
      draft: null,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"nope"}', { status: 409 })),
    )
    await flushOutbox('u1', new QueryClient())
    expect(outboxState().review).toBe('/entry/e1')
    expect(outboxState().message).toBeNull()
  })

  it('sends a journal create then its follow-up PATCH, then clears it', async () => {
    await enqueue('u1', jPost('j9'))
    await enqueue('u1', jPatch('j9', { archived: true }))
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url}`)
        return new Response(JSON.stringify(journal), { status: 200 })
      }),
    )
    await flushOutbox('u1', new QueryClient())
    expect(calls).toEqual(['POST /api/journals', 'PATCH /api/journals/j9'])
    expect(await loadOutbox('u1')).toEqual([])
  })

  it('counts a 404 on a delete as done, with no banner', async () => {
    await enqueue('u1', delEntry('e1'))
    await enqueue('u1', delJournal('j1'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })),
    )
    await flushOutbox('u1', new QueryClient())
    expect(await loadOutbox('u1')).toEqual([])
    expect(outboxState().failed).toBe(0)
  })

  it('sends a delete with no body and clears it on 204', async () => {
    await enqueue('u1', delEntry('e1'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    await flushOutbox('u1', new QueryClient())
    const [url, init] = vi.mocked(fetch).mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('/api/entries/e1')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
    expect(await loadOutbox('u1')).toEqual([])
  })

  it('refused journal write: Review goes to /journals with its message', async () => {
    await enqueue('u1', jPatch('j2', { name: 'x' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"bad"}', { status: 400 })),
    )
    await flushOutbox('u1', new QueryClient())
    expect(outboxState()).toMatchObject({
      failed: 1,
      review: '/journals',
      message: "Couldn't save a journal change.",
    })
  })

  it('refused settings write: Review goes to /settings', async () => {
    await enqueue('u1', mePatch({ tempUnit: 'f' }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"bad"}', { status: 400 })),
    )
    await flushOutbox('u1', new QueryClient())
    expect(outboxState()).toMatchObject({
      review: '/settings',
      message: "A settings change couldn't be saved.",
    })
  })

  it('refused entry delete: restores the kept draft, Review opens the entry', async () => {
    await enqueue('u1', entryPatch('e1', { bodyMd: 'edit' }))
    await enqueue('u1', delEntry('e1'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"bad"}', { status: 403 })),
    )
    await flushOutbox('u1', new QueryClient())
    expect(outboxState()).toMatchObject({
      review: '/entry/e1',
      message: "A delete couldn't be sent. The entry is back.",
    })
    expect(loadDraft('u1', 'e1')?.bodyMd).toBe('my words')
  })

  it('says how many changes were lost when several are refused', async () => {
    await enqueue('u1', jPost('j9'))
    await enqueue('u1', entryPost('n1', 'j9'))
    await enqueue('u1', entryPost('n2', 'j9'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"bad"}', { status: 400 })),
    )
    await flushOutbox('u1', new QueryClient())
    expect(outboxState()).toMatchObject({ failed: 3, message: "3 changes couldn't be saved." })
  })
})

describe('sendOrQueueWrite', () => {
  it('queues when unreachable and returns the answer when not', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const r = await sendOrQueueWrite('u1', {
      kind: 'me',
      method: 'PATCH',
      path: '/auth/me',
      body: { tempUnit: 'f' },
    })
    expect(r).toEqual({ queued: true })
    expect((await loadOutbox('u1'))[0]).toMatchObject({ entryId: 'me', kind: 'me' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    const d = await sendOrQueueWrite('u1', {
      kind: 'delete-entry',
      id: 'e1',
      method: 'DELETE',
      path: '/entries/e1',
    })
    expect(d).toEqual({ queued: false, data: null })
  })
})

describe('withPendingMe', () => {
  const me = {
    id: 'u1',
    username: 'a',
    displayName: 'A',
    role: 'user' as const,
    tempUnit: 'F' as const,
    autoLocation: true,
    showArchivedInMenu: true,
    defaultTimezone: 'UTC',
    defaultJournalId: null,
  }

  it('lays waiting settings over a live read, and leaves it alone with nothing waiting', async () => {
    const { withPendingMe } = await import('./outbox.ts')
    expect(await withPendingMe(me as never)).toBe(me)
    await enqueue('u1', mePatch({ tempUnit: 'C', displayName: 'ignored' }))
    expect(await withPendingMe(me as never)).toMatchObject({
      tempUnit: 'C',
      autoLocation: true,
      displayName: 'A',
    })
    expect(await withPendingMe(null)).toBeNull()
  })

  it('queues behind a waiting write instead of sending past it', async () => {
    await enqueue('u1', mePatch({ tempUnit: 'C' }))
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const r = await sendOrQueueWrite('u1', {
      kind: 'me',
      method: 'PATCH',
      path: '/auth/me',
      body: { autoLocation: false },
    })
    expect(r).toEqual({ queued: true })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await loadOutbox('u1'))[0]!.body).toEqual({ tempUnit: 'C', autoLocation: false })
  })
})

describe('withPendingJournals', () => {
  const j = (id: string, sortOrder: number, extra = {}) => ({
    id,
    name: id,
    color: null,
    icon: null,
    description: null,
    archivedAt: null,
    sortOrder,
    createdAt: sortOrder,
    rev: 3,
    entryCount: 2,
    ...extra,
  })

  it('adds a waiting create (rev 0, after-fields applied), edits others and applies the order', async () => {
    const { withPendingJournals } = await import('./outbox.ts')
    const server = [j('a', 0), j('b', 1)]
    expect(await withPendingJournals('u1', server)).toBe(server)

    await enqueue('u1', jPost('n', { name: 'Fresh' }))
    await enqueue('u1', jPatch('n', { archived: true }))
    await enqueue('u1', jPatch('a', { name: 'Renamed', color: '#123456' }))
    await enqueue('u1', jPatch('b', { archived: true }))
    await enqueue('u1', entryPost('e9', 'a'))
    const out = (await withPendingJournals('u1', server)) as ReturnType<typeof j>[]
    const by = Object.fromEntries(out.map((x) => [x.id, x]))
    expect(by.n).toMatchObject({ name: 'Fresh', rev: 0, entryCount: 0 })
    expect(by.n!.archivedAt).not.toBeNull()
    expect(by.a).toMatchObject({ name: 'Renamed', color: '#123456', entryCount: 3 })
    expect(by.b!.archivedAt).not.toBeNull()

    await enqueue('u1', order(['n', 'b', 'a']))
    const ordered = (await withPendingJournals('u1', server)) as ReturnType<typeof j>[]
    expect(ordered.map((x) => x.id)).toEqual(['n', 'b', 'a'])
  })
})

describe('entries written into a journal that is still waiting', () => {
  it('are queued behind the journal create even when the server answers', async () => {
    const { sendOrQueue } = await import('./outbox.ts')
    await enqueue('u1', jPost('j9'))
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const r = await sendOrQueue('u1', {
      method: 'POST',
      path: '/entries',
      body: { id: 'n1', journalId: 'j9', bodyMd: 'x' },
      entryId: 'n1',
      target: 'n1',
      draft: null,
    })
    expect(r).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await loadOutbox('u1')).map((i) => i.entryId)).toEqual(['journal:j9', 'n1'])
  })

  it('read as an empty local timeline for the overlay to fill', async () => {
    const { localRead } = await import('./localRead.ts')
    expect(await localRead('u1', '/entries?journalId=j9', false)).toBeUndefined()
    await enqueue('u1', jPost('j9'))
    expect(await localRead('u1', '/entries?journalId=j9', false)).toEqual({
      items: [],
      nextCursor: null,
    })
  })
})

describe('deleting offline', () => {
  const card = (id: string, journalId = 'j1') => ({
    id,
    journalId,
    createdAt: 1_000,
    timezone: 'UTC',
    starred: false,
    pinned: false,
    allDay: false,
    mood: null,
    title: id,
    excerpt: '',
    photoCount: 0,
    photos: [],
    hasAttachments: false,
    placeName: null,
    weather: null,
  })
  const offline = () =>
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

  it('hides waiting deletes from the lists, the journals and the reader', async () => {
    const { withPendingCards, withPendingJournals, fetchEntry } = await import('./outbox.ts')
    const { setActiveUser } = await import('./localDb.ts')
    await enqueue('u1', delEntry('e1'))
    await enqueue('u1', delJournal('j2'))
    const page = { items: [card('e1'), card('e2'), card('e3', 'j2')], nextCursor: null }
    const out = (await withPendingCards('u1', '/entries', page)) as { items: { id: string }[] }
    expect(out.items.map((i) => i.id)).toEqual(['e2'])
    const journals = [
      { id: 'j1', sortOrder: 0, createdAt: 0, entryCount: 1 },
      { id: 'j2', sortOrder: 1, createdAt: 0, entryCount: 1 },
    ]
    const left = (await withPendingJournals('u1', journals)) as { id: string }[]
    expect(left.map((j) => j.id)).toEqual(['j1'])

    setActiveUser('u1')
    offline()
    await expect(fetchEntry('e1')).rejects.toMatchObject({ status: 404 })
  })

  it('queues an entry delete when unreachable, and Undo takes it back out', async () => {
    const { deleteEntryOrQueue } = await import('./outbox.ts')
    offline()
    const r = await deleteEntryOrQueue('u1', 'e1', 'Title')
    expect(r.queued).toBe(true)
    expect((await loadOutbox('u1')).map((i) => i.kind)).toEqual(['delete-entry'])
    if (r.queued) expect(await r.undo()).toBe(true)
    expect(await loadOutbox('u1')).toEqual([])
  })

  it('Undo puts back the edit the delete replaced, and the create it cancelled', async () => {
    const { deleteEntryOrQueue } = await import('./outbox.ts')
    offline()
    await enqueue('u1', entryPatch('e1', { bodyMd: 'edit' }))
    const a = await deleteEntryOrQueue('u1', 'e1', 'Title')
    expect((await loadOutbox('u1')).map((i) => i.kind)).toEqual(['delete-entry'])
    if (a.queued) await a.undo()
    expect(await loadOutbox('u1')).toMatchObject([{ entryId: 'e1', method: 'PATCH' }])

    await enqueue('u1', entryPost('n1'))
    const b = await deleteEntryOrQueue('u1', 'n1', 'Title')
    expect((await loadOutbox('u1')).map((i) => i.entryId)).toEqual(['e1'])
    if (b.queued) expect(await b.undo()).toBe(true)
    expect((await loadOutbox('u1')).map((i) => i.entryId)).toEqual(['e1', 'n1'])
  })

  it('Undo says no once the delete has been sent', async () => {
    const { deleteEntryOrQueue } = await import('./outbox.ts')
    offline()
    const r = await deleteEntryOrQueue('u1', 'e1', 'Title')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    await flushOutbox('u1', new QueryClient())
    if (r.queued) expect(await r.undo()).toBe(false)
    expect(await loadOutbox('u1')).toEqual([])
  })
})

describe('waiting deletes', () => {
  it('lists them with their label, and cancelling puts back the edit a delete replaced', async () => {
    const { cancelQueuedDelete, waitingDeletes } = await import('./outbox.ts')
    await enqueue('u1', entryPatch('e1', { bodyMd: 'edit' }))
    await enqueue('u1', { ...delEntry('e1'), label: 'My entry' })
    await enqueue('u1', { ...delJournal('j2'), label: 'My journal' })
    await enqueue('u1', mePatch({ tempUnit: 'C' }))
    expect((await waitingDeletes('u1')).map((r) => r.label)).toEqual(['My entry', 'My journal'])

    expect(await cancelQueuedDelete('u1', 'e1')).toBe(true)
    expect(await cancelQueuedDelete('u1', 'journal:j2')).toBe(true)
    expect(await cancelQueuedDelete('u1', 'e1')).toBe(false)
    expect(await waitingDeletes('u1')).toEqual([])
    const left = await loadOutbox('u1')
    expect(left.map((r) => r.entryId).sort()).toEqual(['e1', 'me'])
    expect(left.find((r) => r.entryId === 'e1')).toMatchObject({ method: 'PATCH' })
  })

  it('does not cancel something that is not a delete', async () => {
    const { cancelQueuedDelete } = await import('./outbox.ts')
    await enqueue('u1', entryPatch('e1'))
    expect(await cancelQueuedDelete('u1', 'e1')).toBe(false)
    expect(await loadOutbox('u1')).toHaveLength(1)
  })
})

describe('refreshMe while a settings change is being replayed', () => {
  it('keeps the new values when the replay lands during the request', async () => {
    const { refreshMe } = await import('../auth/useAuth.ts')
    const me = {
      id: 'u1',
      username: 'a',
      displayName: 'A',
      role: 'user',
      tempUnit: 'F',
      autoLocation: true,
      showArchivedInMenu: true,
      defaultTimezone: 'UTC',
      defaultJournalId: null,
      avatarUpdatedAt: null,
      trashRetentionDays: 60,
    }
    const qc = new QueryClient()
    qc.setQueryData(['me'], me)
    await enqueue('u1', mePatch({ showArchivedInMenu: false }))
    // The answer predates the change, and the replay has removed its row by the time it arrives.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await localDb('u1').outbox.clear()
        return new Response(JSON.stringify(me), { status: 200 })
      }),
    )
    await refreshMe(qc)
    expect(qc.getQueryData<typeof me>(['me'])!.showArchivedInMenu).toBe(false)
  })
})
