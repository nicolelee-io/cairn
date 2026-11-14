// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api.ts'
import { fieldsOf } from './useEntryDraft.ts'
import { detail } from './testFixtures.ts'
import { useSaveEntry } from './useSaveEntry.ts'

// A plain stub, not vi.fn: a spy tracks the settled result of a rejected promise, which Vitest then
// reports as an unhandled rejection.
const outbox = vi.hoisted(() => ({
  calls: [] as { method: string; path: string; body: Record<string, unknown> }[],
  reply: (() => Promise.resolve(null)) as () => Promise<unknown>,
}))
vi.mock('../../lib/outbox.ts', () => ({
  sendOrQueue: (_userId: string, req: (typeof outbox.calls)[number]) => {
    outbox.calls.push(req)
    return outbox.reply()
  },
  withPendingEdits: async (_userId: string, d: unknown) => d,
}))
const replyWith = (value: unknown) => (outbox.reply = () => Promise.resolve(value))
const failWith = (e: Error) => (outbox.reply = () => Promise.reject(e))

const baseline = fieldsOf(detail())
// One client for the whole run: a wrapper that built its own would be replaced on every re-render.
const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)

function setup(over: Partial<Parameters<typeof useSaveEntry>[0]> = {}) {
  const props = {
    userId: 'u1',
    isNew: false,
    entryId: 'e1',
    newId: 'new-id',
    target: 'e1',
    fields: { ...baseline, bodyMd: 'changed', starred: true },
    baseline,
    baseRev: 3,
    removedLoose: [] as string[],
    settle: vi.fn(),
    setBaseRev: vi.fn(),
    onSaved: vi.fn(),
    onStayed: vi.fn(),
    ...over,
  }
  const hook = renderHook(() => useSaveEntry(props), { wrapper })
  return { ...hook, props }
}

beforeEach(() => {
  outbox.calls.length = 0
})

describe('useSaveEntry', () => {
  it('PATCHes only the changed fields with the base revision', async () => {
    replyWith(detail({ bodyMd: 'changed', starred: true, rev: 4 }))
    const { result, props } = setup()
    act(() => result.current.save.mutate({ close: true, sent: props.fields }))
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith('e1'))
    const req = outbox.calls[0]!
    expect(req).toMatchObject({ method: 'PATCH', path: '/entries/e1' })
    expect(req.body).toEqual({ bodyMd: 'changed', starred: true, baseRev: 3 })
    expect(props.settle).toHaveBeenCalled()
  })

  it('POSTs a whole new entry under its client id', async () => {
    replyWith(detail({ id: 'new-id' }))
    const { result, props } = setup({ isNew: true, entryId: null, baseRev: null, target: 'new-id' })
    act(() => result.current.save.mutate({ close: true, sent: props.fields }))
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
    const req = outbox.calls[0]!
    expect(req).toMatchObject({ method: 'POST', path: '/entries' })
    expect(req.body).toMatchObject({ id: 'new-id', bodyMd: 'changed', journalId: 'j1' })
  })

  it('keeps the editor open when asked, handing back the server copy', async () => {
    const saved = detail({ bodyMd: 'changed', rev: 4 })
    replyWith(saved)
    const { result, props } = setup()
    act(() => result.current.save.mutate({ close: false, sent: props.fields }))
    await waitFor(() => expect(props.onStayed).toHaveBeenCalledWith(saved, props.fields))
    expect(props.onSaved).not.toHaveBeenCalled()
    expect(props.settle).not.toHaveBeenCalled()
  })

  it('closes onto the entry when the save was parked in the outbox', async () => {
    replyWith(null)
    const { result, props } = setup()
    act(() => result.current.save.mutate({ close: false, sent: props.fields }))
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith('e1'))
    expect(props.settle).toHaveBeenCalled()
  })

  it('maps a 409 conflict to `conflict` and rebases', async () => {
    const theirs = detail({ bodyMd: 'theirs', rev: 9 })
    failWith(new ApiError(409, { error: 'conflict', current: theirs }))
    const { result, props } = setup()
    act(() => result.current.save.mutate({ close: true, sent: props.fields }))
    await waitFor(() => expect(result.current.conflict?.entry.rev).toBe(9))
    expect(props.setBaseRev).toHaveBeenCalledWith(9)
    expect(result.current.error).toBeNull()
    expect(props.onSaved).not.toHaveBeenCalled()
  })

  it.each([
    ['journal_archived', /archived/],
    ['journal_not_found', /no longer exists/],
  ])('explains %s', async (code, message) => {
    failWith(new ApiError(409, { error: code }))
    const { result, props } = setup()
    act(() => result.current.save.mutate({ close: true, sent: props.fields }))
    await waitFor(() => expect(result.current.error).toMatch(message))
    expect(result.current.conflict).toBeNull()
  })

  it('falls back to a generic message for other failures', async () => {
    failWith(new ApiError(500, null))
    const { result, props } = setup()
    act(() => result.current.save.mutate({ close: true, sent: props.fields }))
    await waitFor(() => expect(result.current.error).toMatch(/Couldn’t save/))
  })
})
