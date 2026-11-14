import Dexie, { type Table } from 'dexie'
import type { SyncAttachment, SyncEntry, SyncJournal, SyncPhoto } from '@cairn/shared'

// The device's own copy of the server's data (Phase 7.4, SPEC section 3). One IndexedDB database
// per user (`cairn-<userId>`), so accounts never share rows and signing out can drop one wholesale.
//
//   journals, entries, photos, attachments
//                              the synced copy, as the change feed sends it (lib/sync*.ts);
//                              attachments are records only, their files are never kept
//   outbox                     saves made while the server was unreachable (lib/outbox.ts); the one
//                              table that is NOT synced data, so it survives signing out
//   meta                       small facts: the sync cursor, which journals are kept offline

/** The feed's entry plus the columns lists query by. */
export interface LocalEntry extends SyncEntry {
  id: string
  journalId: string
  createdAt: number
}

/** What a waiting write is for. A row without one was queued before kinds existed: an entry save. */
export type OutboxKind =
  'entry' | 'journal' | 'journal-order' | 'me' | 'delete-entry' | 'delete-journal'

/** The subject key of a write (the `entryId` column): what a later write of the same thing folds into. */
export function outboxKey(kind: OutboxKind, id?: string): string {
  switch (kind) {
    case 'entry':
    case 'delete-entry':
      return id!
    case 'journal':
    case 'delete-journal':
      return `journal:${id!}`
    default:
      return kind // journal-order, me
  }
}

export interface OutboxRow {
  /** Replay order. */
  seq?: number
  /** The draft slot this save came from: an entry id, or 'new'. */
  target: string
  /**
   * The subject key, unique per row: an entry id, `journal:<id>`, `journal-order` or `me` (see
   * `outboxKey`). It kept its old name so the Dexie index needs no version bump or migration.
   */
  entryId: string
  kind?: OutboxKind
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body: Record<string, unknown>
  /** What to call it in the UI (a waiting delete's entry title or journal name). */
  label?: string
  /** On a delete: the waiting edit it replaced, which cancelling the delete puts back. */
  replaces?: OutboxRow
  /** A journal create that was also edited with fields a create can't take (archived, sortOrder): sent as a PATCH right after it. */
  after?: Record<string, unknown>
  queuedAt: number
  /**
   * Where the text goes back to if the server refuses the replay (a Draft without v/savedAt).
   * Null for a quick change (star, pin) that has no text to give back.
   */
  draft: Record<string, unknown> | null
}

export interface MetaRow {
  key: string
  value: unknown
}

export class LocalDb extends Dexie {
  journals!: Table<SyncJournal, string>
  entries!: Table<LocalEntry, string>
  photos!: Table<SyncPhoto, string>
  attachments!: Table<SyncAttachment, string>
  outbox!: Table<OutboxRow, number>
  meta!: Table<MetaRow, string>

  constructor(userId: string) {
    super(`cairn-${userId}`)
    this.version(1).stores({
      journals: 'id',
      entries: 'id, journalId, createdAt, [journalId+createdAt]',
      photos: 'id, entryId',
      outbox: '++seq, &entryId',
      meta: 'key',
    })
    this.version(2).stores({ attachments: 'id, entryId' })
  }

  /** The tables holding the synced copy (not the outbox or meta). */
  syncedTables() {
    return [this.journals, this.entries, this.photos, this.attachments]
  }
}

const open = new Map<string, LocalDb>()

/** The one connection for a user in this tab. */
export function localDb(userId: string): LocalDb {
  let db = open.get(userId)
  if (!db) {
    db = new LocalDb(userId)
    open.set(userId, db)
  }
  return db
}

/** Closes and deletes a user's whole database, the outbox included. */
export async function deleteLocalDb(userId: string) {
  open.get(userId)?.close()
  open.delete(userId)
  await Dexie.delete(`cairn-${userId}`)
}

/** Drops the synced copy but keeps saves still waiting to be sent. */
export async function clearLocalCopy(userId: string) {
  const db = localDb(userId)
  await db.transaction('rw', [...db.syncedTables(), db.meta], async () => {
    await Promise.all([...db.syncedTables(), db.meta].map((t) => t.clear()))
  })
}

// Who is signed in, for code that has no user in hand (the 401 handler, fetchEntry).
let activeUser: string | null = null
export const setActiveUser = (userId: string | null) => {
  activeUser = userId
}
export const getActiveUser = () => activeUser

/**
 * Asks the browser not to evict this origin's storage when the disk fills up. Chrome decides on
 * its own (usually yes for an installed app); this just records the answer.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    return (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch {
    return false
  }
}
