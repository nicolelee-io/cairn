import { JournalSchema, uuidv7, type Journal } from '@cairn/shared'
import { z } from 'zod'
import { api } from './api.ts'
import { sendOrQueueWrite } from './outbox.ts'

// Journal writes that wait in the outbox when the server can't be reached (docs/design/offline-writes-proposal.md
// phase 3). Each resolves once the change is made or queued; the caller then refreshes the journal
// list, where `withPendingJournals` (outbox.ts) lays the waiting changes over whatever it reads.

type Fields = { name: string; color: string | null; icon: string | null; description: string }

/** Creates a journal under a fresh client id (a replayed create with the same id is harmless). */
export async function createJournal(userId: string | undefined, fields: Fields): Promise<void> {
  const id = uuidv7()
  const body = { id, ...fields }
  if (!userId) return void (await api('/journals', { method: 'POST', body, schema: JournalSchema }))
  await sendOrQueueWrite(userId, { kind: 'journal', id, method: 'POST', path: '/journals', body })
}

/** Changes a journal: its fields, or archived on and off. */
export async function updateJournal(
  userId: string | undefined,
  id: string,
  body: Partial<Fields> & { archived?: boolean },
): Promise<void> {
  if (!userId)
    return void (await api(`/journals/${id}`, { method: 'PATCH', body, schema: JournalSchema }))
  await sendOrQueueWrite(userId, {
    kind: 'journal',
    id,
    method: 'PATCH',
    path: `/journals/${id}`,
    body,
  })
}

/** Saves the active journals' new order; resolves to the server's list, or null when queued. */
export async function reorderJournals(
  userId: string | undefined,
  ids: string[],
): Promise<Journal[] | null> {
  if (!userId)
    return api('/journals/order', { method: 'PUT', body: { ids }, schema: z.array(JournalSchema) })
  const sent = await sendOrQueueWrite(userId, {
    kind: 'journal-order',
    method: 'PUT',
    path: '/journals/order',
    body: { ids },
  })
  return sent.queued ? null : (sent.data as Journal[])
}
