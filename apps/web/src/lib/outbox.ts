import type { QueryClient } from '@tanstack/react-query'
import {
  ConflictSchema,
  EntryDetailSchema,
  JournalSchema,
  MeSchema,
  summarize,
  tagKey,
  type EntryDetail,
  type Journal,
  type Me,
  type Location,
  type TimelineItem,
  readMood,
  isAutoWeather,
} from '@cairn/shared'
import { z } from 'zod'
import { ApiError, api, setOverlayHook } from './api.ts'
import { invalidateAfterSave, invalidateMe, keys } from './queries.ts'
import { DraftSchema, loadDraft, saveDraft } from './draft.ts'
import { getActiveUser, localDb, outboxKey, type OutboxKind, type OutboxRow } from './localDb.ts'
import { isGatewayDown } from './serverStatus.ts'
import { withTempUnit } from './tempUnit.ts'
import { invalidateAfterTrash } from './trash.ts'

// Saves made while the server can't be reached (Phase 7.2). The editor's Save normally goes straight
// to the API; when the network is down it parks the exact request here instead, and `flushOutbox`
// sends it once the server answers. Ids and `baseRev` travel with it, so a replay is idempotent for a
// create and goes through the normal conflict check for an edit (SPEC 4d). The queue is a table in
// the user's IndexedDB (lib/localDb.ts), shared by every tab; replay takes a lock so two tabs never
// send the same save. Uploads, tag changes and the rest of the server-only controls still
// need the server (7.4e). Rows have a `kind` (entry, journal, journal-order, me, delete-entry,
// delete-journal); `outboxKey` gives each its unique subject key, and `mergeInto` the rules for a
// second write of the same subject.

export type OutboxItem = OutboxRow

/** What `draft` must hold to be restorable. */
const RestorableDraft = DraftSchema.omit({ v: true, savedAt: true })

/** The network is down or the gateway is: the request never reached the app. */
export function isUnreachable(e: unknown): boolean {
  return (
    e instanceof TypeError ||
    (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) ||
    (e instanceof ApiError && isGatewayDown(e.status))
  )
}

export const loadOutbox = (userId: string): Promise<OutboxItem[]> =>
  localDb(userId).outbox.orderBy('seq').toArray()

const channel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('cairn-outbox')
channel?.addEventListener('message', (e: MessageEvent<string>) => void refreshOutbox(e.data))
const announce = (userId: string) => channel?.postMessage(userId)

export { outboxKey }
export const kindOf = (row: OutboxRow): OutboxKind => row.kind ?? 'entry'
const journalIdOf = (row: OutboxRow) => row.entryId.slice('journal:'.length)

/** The fields a journal create takes; anything else folded into one rides in `after`. */
const CREATE_JOURNAL_FIELDS = ['name', 'color', 'icon', 'description'] as const

/** Merges an entry PATCH into a waiting entry PATCH: first `baseRev`, later values, union of removed media. */
function mergeEntryPatch(prev: OutboxItem, item: OutboxItem): OutboxItem {
  // removePhotoIds: the field's old name, in items queued before the rename.
  const ids = (b: Record<string, unknown>, k: string) => (b[k] as string[] | undefined) ?? []
  const removed = new Set(
    [prev.body, item.body].flatMap((b) => [
      ...ids(b, 'removeMediaIds'),
      ...ids(b, 'removePhotoIds'),
    ]),
  )
  return {
    ...item,
    seq: prev.seq,
    body: {
      ...prev.body,
      ...item.body,
      baseRev: prev.body.baseRev,
      removePhotoIds: undefined,
      removeMediaIds: removed.size ? [...removed] : undefined,
    },
    draft: item.draft ? { ...item.draft, baseRev: prev.draft?.baseRev ?? null } : prev.draft,
    queuedAt: prev.queuedAt,
  }
}

/** Folds an entry edit into the entry create still waiting: the edit becomes part of it. */
function mergeIntoCreate(prev: OutboxItem, item: OutboxItem): OutboxItem {
  const fields = { ...item.body }
  delete fields.baseRev
  delete fields.removeMediaIds
  delete fields.removePhotoIds
  // `auto` weather means "look it up", which a create with a place does anyway.
  const w = fields.weather as { auto?: boolean } | null | undefined
  if (w && typeof w === 'object' && 'auto' in w) delete fields.weather
  return {
    ...prev,
    body: { ...prev.body, ...fields },
    draft: item.draft ? { ...item.draft, newId: prev.entryId, baseRev: null } : prev.draft,
  }
}

/**
 * What the outbox becomes when `item` arrives and `prev` (same subject key) is waiting: the row
 * to store (its `seq` is `prev`'s unless it is new), or null to leave nothing for the subject.
 * `dropEntryCreatesIn` names a journal whose waiting entry creates must go too.
 */
function mergeInto(
  prev: OutboxItem,
  item: OutboxItem,
): { row: OutboxItem | null; dropEntryCreatesIn?: string } {
  const pk = kindOf(prev)
  const ik = kindOf(item)
  const keep = (row: OutboxItem) => ({ row: { ...row, seq: prev.seq } })

  if (ik === 'delete-entry') {
    if (pk === 'delete-entry') return { row: prev }
    // The entry never reached the server: nothing to delete there.
    if (prev.method === 'POST') return { row: null }
    // The waiting edit is moot, but its draft stays so a refused delete can give the text back.
    return keep({ ...item, draft: prev.draft, replaces: prev })
  }
  // The UI hides an entry whose delete waits; if an edit arrives anyway the delete wins.
  if (pk === 'delete-entry') return { row: prev }

  if (ik === 'delete-journal') {
    if (pk === 'delete-journal') return { row: prev }
    if (prev.method === 'POST') return { row: null, dropEntryCreatesIn: journalIdOf(prev) }
    return keep({ ...item, replaces: prev })
  }
  if (pk === 'delete-journal') return { row: prev }

  if (ik === 'entry') {
    if (prev.method === 'PATCH' && item.method === 'PATCH')
      return { row: mergeEntryPatch(prev, item) }
    if (prev.method === 'POST' && item.method === 'PATCH')
      return { row: mergeIntoCreate(prev, item) }
    return keep(item)
  }

  if (ik === 'journal') {
    if (prev.method === 'PATCH' && item.method === 'PATCH')
      return keep({ ...item, body: { ...prev.body, ...item.body }, queuedAt: prev.queuedAt })
    if (prev.method === 'POST' && item.method === 'PATCH') {
      // A create takes name, colour, icon and description; archive and order follow as a PATCH.
      const create: Record<string, unknown> = {}
      const rest: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(item.body))
        ((CREATE_JOURNAL_FIELDS as readonly string[]).includes(k) ? create : rest)[k] = v
      const after = { ...prev.after, ...rest }
      return {
        row: {
          ...prev,
          body: { ...prev.body, ...create },
          after: Object.keys(after).length ? after : undefined,
        },
      }
    }
    return keep(item)
  }

  if (ik === 'me')
    return keep({ ...item, body: { ...prev.body, ...item.body }, queuedAt: prev.queuedAt })
  return keep({ ...item, queuedAt: prev.queuedAt }) // journal-order: the latest order replaces it
}

/**
 * Queues a write. A second write of a subject that is still waiting is folded into the first (see
 * `mergeInto`; for an entry the first `baseRev` is the one the server knows), so the replay sends
 * one request with the latest values. Returns false if it couldn't be stored; the caller then
 * reports the original error.
 */
export async function enqueue(userId: string, item: OutboxItem): Promise<boolean> {
  try {
    const db = localDb(userId)
    await db.transaction('rw', db.outbox, async () => {
      const prev = await db.outbox.where('entryId').equals(item.entryId).first()
      if (!prev) return void (await db.outbox.add({ ...item, seq: undefined }))
      const { row, dropEntryCreatesIn } = mergeInto(prev, item)
      if (row) await db.outbox.put(row)
      else await db.outbox.delete(prev.seq!)
      if (dropEntryCreatesIn) {
        // The user deleted a journal that only existed here: entries written into it go with it.
        const doomed = (await db.outbox.toArray()).filter(
          (r) =>
            kindOf(r) === 'entry' && r.method === 'POST' && r.body.journalId === dropEntryCreatesIn,
        )
        await db.outbox.bulkDelete(doomed.map((r) => r.seq!))
      }
    })
  } catch {
    return false
  }
  await refreshOutbox(userId)
  announce(userId)
  return true
}

const SIMPLE_FIELDS = [
  'journalId',
  'bodyMd',
  'createdAt',
  'timezone',
  'allDay',
  'starred',
  'pinned',
  'mood',
] as const

/** The entry as the user left it: the server's copy with any save still waiting laid over it. */
export async function withPendingEdits(
  userId: string | null,
  detail: EntryDetail,
): Promise<EntryDetail> {
  if (!userId) return detail
  const item = await localDb(userId)
    .outbox.where('entryId')
    .equals(detail.entry.id)
    .first()
    .catch(() => undefined)
  if (!item || kindOf(item) !== 'entry') return detail // a waiting create has the same field names, so it overlays the same way
  const entry: Record<string, unknown> = { ...detail.entry }
  for (const k of SIMPLE_FIELDS) if (k in item.body) entry[k] = item.body[k]
  const tags = Array.isArray(item.body.tags) ? (item.body.tags as string[]) : detail.tags
  const location =
    'location' in item.body ? ((item.body.location as Location | null) ?? null) : detail.location
  const weather = 'weather' in item.body ? queuedWeather(item.body.weather) : detail.weather
  return { ...detail, entry: entry as EntryDetail['entry'], tags, location, weather }
}

/**
 * The weather a queued save will leave on the entry: set by hand, removed, or (`auto`) dropped
 * until Google fills it in again after the save.
 */
function queuedWeather(w: unknown): EntryDetail['weather'] {
  const m = w as {
    condition?: NonNullable<EntryDetail['weather']>['condition']
    tempC?: number | null
    isDay?: boolean | null
  } | null
  if (!m || typeof m.condition !== 'string') return null
  return {
    condition: m.condition,
    tempC: m.tempC ?? null,
    isDay: m.isDay ?? null,
    description: null,
    pressureMb: null,
    humidityPct: null,
    windKph: null,
    source: 'manual',
  }
}

const IGNORED_FOR_MATCH = new Set(['baseRev', 'removeMediaIds', 'removePhotoIds'])

/**
 * Whether the server's copy already holds everything a queued edit sets. A replayed edit whose
 * first send reached the server but whose answer was lost comes back as a conflict (the rev moved
 * on, by our own hand); when it matches, the save went through and is not a conflict.
 */
export function matchesQueued(body: Body, current: EntryDetail): boolean {
  for (const [k, v] of Object.entries(body)) {
    if (IGNORED_FOR_MATCH.has(k) || v === undefined) continue
    if ((SIMPLE_FIELDS as readonly string[]).includes(k)) {
      if ((current.entry as Record<string, unknown>)[k] !== v) return false
    } else if (k === 'tags') {
      const want = new Set((v as string[]).map(tagKey))
      const have = new Set(current.tags.map(tagKey))
      if (want.size !== have.size || [...want].some((t) => !have.has(t))) return false
    } else if (k === 'location') {
      const want = v as Location | null
      if (!want) {
        if (current.location) return false
      } else if (
        !current.location ||
        Object.entries(want).some(([f, x]) => current.location![f as keyof Location] !== x)
      )
        return false
    } else if (k === 'weather') {
      const want = v as { auto?: boolean; condition?: string; tempC?: number | null } | null
      const have = current.weather
      if (want === null) {
        if (have) return false
      } else if (want.auto) {
        // Dropped for the weather service to fill in again: nothing, or its by now.
        if (have && !isAutoWeather(have.source)) return false
      } else if (
        !have ||
        have.source !== 'manual' ||
        have.condition !== want.condition ||
        (have.tempC ?? null) !== (want.tempC ?? null)
      )
        return false
    } else return false // a field this check doesn't know: don't guess
  }
  const removed = [
    ...((body.removeMediaIds as string[] | undefined) ?? []),
    ...((body.removePhotoIds as string[] | undefined) ?? []),
  ]
  const held = new Set([...current.photos, ...current.attachments].map((m) => m.id))
  return removed.every((id) => !held.has(id))
}

/**
 * Sends a save; if the server can't be reached it is parked in the outbox instead and this
 * resolves to null. Anything the server answers is still an error for the caller to show.
 */
export async function sendOrQueue(
  userId: string,
  req: {
    method: 'POST' | 'PATCH'
    path: string
    body: Record<string, unknown>
    entryId: string
    /** The draft slot it came from: the entry's id, or 'new' for a resumed old-style draft. */
    target: string
    draft: OutboxItem['draft']
  },
): Promise<EntryDetail | null> {
  try {
    // An entry for a journal that is itself still waiting can't go first: the server doesn't know
    // the journal yet. Queue it behind the journal's create.
    const journalId = typeof req.body.journalId === 'string' ? req.body.journalId : null
    if (
      journalId &&
      (await localDb(userId)
        .outbox.where('entryId')
        .equals(outboxKey('journal', journalId))
        .first()
        .catch(() => undefined))
    )
      throw new TypeError('queued behind the journal it is written in')
    return await api(req.path, { method: req.method, body: req.body, schema: EntryDetailSchema })
  } catch (e) {
    if (!isUnreachable(e)) throw e
    const queued = await enqueue(userId, {
      target: req.target,
      entryId: req.entryId,
      method: req.method,
      path: req.path,
      body: JSON.parse(JSON.stringify(req.body)) as Record<string, unknown>,
      queuedAt: Date.now(),
      draft: req.draft,
    })
    if (!queued) throw e
    return null
  }
}

/** What a queued write of each kind is answered with (a delete has no body). */
const ANSWERS: Record<OutboxKind, z.ZodType | undefined> = {
  entry: EntryDetailSchema,
  journal: JournalSchema,
  'journal-order': z.array(JournalSchema),
  me: MeSchema,
  'delete-entry': undefined,
  'delete-journal': undefined,
}

/**
 * Sends a journal, settings or delete write; if the server can't be reached it is parked in the
 * outbox instead and this resolves to `queued`. A refusal is still an error for the caller.
 */
export async function sendOrQueueWrite(
  userId: string,
  req: {
    kind: Exclude<OutboxKind, 'entry'>
    /** The id the key is made of (a journal or entry id); none for `journal-order` and `me`. */
    id?: string
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
    path: string
    body?: Record<string, unknown>
    /** What to call it in the UI while it waits (a delete's entry or journal). */
    label?: string
  },
): Promise<{ queued: false; data: unknown } | { queued: true }> {
  const body = req.body ?? {}
  const key = outboxKey(req.kind, req.id)
  try {
    // Something for the same subject is already waiting: queue behind it (merged) rather than send
    // past it, or the replay would later overwrite this newer write with the older one.
    if (
      await localDb(userId)
        .outbox.where('entryId')
        .equals(key)
        .first()
        .catch(() => undefined)
    )
      throw new TypeError('queued behind an earlier write')
    const data = await api(req.path, {
      method: req.method,
      body: req.body,
      schema: ANSWERS[req.kind],
    })
    return { queued: false, data }
  } catch (e) {
    if (!isUnreachable(e)) throw e
    const queued = await enqueue(userId, {
      target: req.kind,
      entryId: key,
      kind: req.kind,
      label: req.label,
      method: req.method,
      path: req.path,
      body: JSON.parse(JSON.stringify(body)) as Record<string, unknown>,
      queuedAt: Date.now(),
      draft: null,
    })
    if (!queued) throw e
    return { queued: true }
  }
}

/** The account settings a queued `me` write can carry (the name stays online-only). */
const ME_FIELDS = [
  'tempUnit',
  'autoLocation',
  'showArchivedInMenu',
  'showStreak',
  'showBestStreak',
  'defaultTimezone',
  'defaultJournalId',
] as const

/**
 * The account as the user left it: whatever it was read as, with a waiting settings change laid
 * over it. Applied to live reads too (unlike the other overlays), or the 5-minute refresh would
 * flip a switch back until the replay lands.
 */
export async function withPendingMe<T extends Me | null>(
  me: T,
  /** What `readPendingMe` found before `me` was read, if the caller took that step first. */
  pending?: Body | null,
): Promise<T> {
  if (!me) return me
  const body = pending === undefined ? await readPendingMe(me.id) : pending
  if (!body) return me
  const next: Record<string, unknown> = { ...me }
  for (const k of ME_FIELDS) if (k in body) next[k] = body[k]
  return next as unknown as T
}

/**
 * The settings change waiting for this user, if any. A caller that reads `me` from the server
 * takes this first: if the replay lands while the request is out, the row is gone by the time the
 * answer (which predates the change) arrives, and only this snapshot can still lay it over.
 */
export async function readPendingMe(userId: string): Promise<Body | null> {
  const item = await localDb(userId)
    .outbox.where('entryId')
    .equals(outboxKey('me'))
    .first()
    .catch(() => undefined)
  return item?.body ?? null
}

/**
 * The journal list with waiting journal writes laid over it: creates appear (rev 0, so the UI can
 * tell they haven't reached the server), edits and archiving show, and a waiting order applies.
 * Entries waiting to be created count towards a journal's entry count.
 */
export async function withPendingJournals(userId: string | null, data: unknown): Promise<unknown> {
  if (!userId || !Array.isArray(data)) return data
  const waiting = await loadOutbox(userId).catch(() => [])
  if (waiting.length === 0) return data
  const byId = new Map((data as Journal[]).map((j) => [j.id, { ...j }]))
  const apply = (j: Journal, body: Body, at: number): Journal => {
    const next = { ...j }
    for (const k of ['name', 'color', 'icon', 'description'] as const)
      if (k in body) (next as Record<string, unknown>)[k] = body[k] ?? null
    if (typeof body.archived === 'boolean') next.archivedAt = body.archived ? at : null
    if (typeof body.sortOrder === 'number') next.sortOrder = body.sortOrder
    return next
  }
  for (const w of waiting) {
    const kind = kindOf(w)
    if (kind === 'journal') {
      const id = journalIdOf(w)
      if (w.method === 'POST' && !byId.has(id)) {
        const top = Math.max(-1, ...[...byId.values()].map((j) => j.sortOrder))
        const made: Journal = {
          id,
          name: str(w.body.name, ''),
          color: null,
          icon: null,
          description: null,
          archivedAt: null,
          sortOrder: top + 1,
          createdAt: w.queuedAt,
          rev: 0,
          entryCount: 0,
        }
        byId.set(id, apply(apply(made, w.body, w.queuedAt), w.after ?? {}, w.queuedAt))
      } else if (w.method === 'PATCH' && byId.has(id))
        byId.set(id, apply(byId.get(id)!, w.body, w.queuedAt))
    } else if (kind === 'journal-order') {
      const ids = (w.body.ids as string[] | undefined) ?? []
      ids.forEach((id, i) => {
        const j = byId.get(id)
        if (j) j.sortOrder = i
      })
    } else if (kind === 'entry' && w.method === 'POST') {
      const j = byId.get(str(w.body.journalId, ''))
      if (j) j.entryCount += 1
    }
  }
  for (const w of waiting) if (kindOf(w) === 'delete-journal') byId.delete(journalIdOf(w))
  return [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
}

/**
 * Deletes an entry (to the trash); if the server can't be reached the delete waits in the outbox.
 * `undo` takes a waiting delete back out, putting back the edit or create it replaced, and
 * resolves false once the delete has been sent (then the trash is the way back).
 */
export async function deleteEntryOrQueue(
  userId: string,
  entryId: string,
  label: string,
): Promise<{ queued: false } | { queued: true; undo: () => Promise<boolean> }> {
  const db = localDb(userId)
  const key = outboxKey('delete-entry', entryId)
  const prev = await db.outbox
    .where('entryId')
    .equals(key)
    .first()
    .catch(() => undefined)
  const sent = await sendOrQueueWrite(userId, {
    kind: 'delete-entry',
    id: entryId,
    method: 'DELETE',
    path: `/entries/${entryId}`,
    label,
  })
  if (!sent.queued) return { queued: false }
  return {
    queued: true,
    undo: async () => {
      if (await cancelQueuedDelete(userId, key)) return true
      // The delete cancelled a create that never left the device: Undo writes it back.
      const cur = await db.outbox.where('entryId').equals(key).first()
      if (cur || !(prev && kindOf(prev) === 'entry' && prev.method === 'POST')) return false
      await db.outbox.add({ ...prev, seq: undefined })
      await refreshOutbox(userId)
      announce(userId)
      return true
    },
  }
}

/** The waiting deletes (entries and journals), oldest first. */
export const waitingDeletes = async (userId: string) =>
  (await loadOutbox(userId)).filter((r) => ['delete-entry', 'delete-journal'].includes(kindOf(r)))

/**
 * Takes a delete that hasn't been sent out of the queue, putting back the edit it replaced.
 * False when there is no waiting delete for the key (it was sent already).
 */
export async function cancelQueuedDelete(userId: string, key: string): Promise<boolean> {
  const db = localDb(userId)
  let cancelled = false
  await db.transaction('rw', db.outbox, async () => {
    const row = await db.outbox.where('entryId').equals(key).first()
    if (!row || !kindOf(row).startsWith('delete-')) return
    await db.outbox.delete(row.seq!)
    if (row.replaces) await db.outbox.add({ ...row.replaces, seq: undefined })
    cancelled = true
  })
  if (cancelled) {
    await refreshOutbox(userId)
    announce(userId)
  }
  return cancelled
}

type Body = Record<string, unknown>
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
const flag = (v: unknown) => v === true

/** An entry that only exists in the outbox, as the reader shows it. */
export function pendingCreateDetail(item: OutboxItem): EntryDetail {
  const b = item.body
  return {
    entry: {
      id: item.entryId,
      journalId: str(b.journalId, ''),
      bodyMd: str(b.bodyMd, ''),
      createdAt: typeof b.createdAt === 'number' ? b.createdAt : item.queuedAt,
      modifiedAt: item.queuedAt,
      timezone: str(b.timezone, 'UTC'),
      starred: flag(b.starred),
      pinned: flag(b.pinned),
      allDay: flag(b.allDay),
      mood: readMood(b.mood),
      moodSuggested: null,
      creationDevice: null,
      source: 'native',
      rev: 0,
    },
    location: (b.location as Location | null | undefined) ?? null,
    weather: queuedWeather(b.weather),
    tags: Array.isArray(b.tags) ? (b.tags as string[]) : [],
    photos: [],
    attachments: [],
  }
}

function cardFromCreate(item: OutboxItem): TimelineItem {
  const d = pendingCreateDetail(item)
  return {
    id: d.entry.id,
    journalId: d.entry.journalId,
    createdAt: d.entry.createdAt,
    timezone: d.entry.timezone,
    starred: d.entry.starred,
    pinned: d.entry.pinned,
    allDay: d.entry.allDay,
    mood: readMood(d.entry.mood),
    ...summarize(d.entry.bodyMd),
    photoCount: 0,
    photos: [],
    // A file uploaded before going offline is in the text; the card catches up after the save.
    hasAttachments: false,
    placeName: d.location?.placeName ?? null,
    weather: d.weather ? { condition: d.weather.condition, tempC: d.weather.tempC } : null,
  }
}

/** A card with a waiting edit laid over it (text, flags, place, weather). Its date and sort order stay. */
function patchCard(card: TimelineItem, body: Body): TimelineItem {
  const next = { ...card }
  if (typeof body.bodyMd === 'string') Object.assign(next, summarize(body.bodyMd))
  for (const k of ['starred', 'pinned', 'allDay'] as const)
    if (typeof body[k] === 'boolean') next[k] = body[k]
  if ('mood' in body) next.mood = readMood(body.mood)
  if (typeof body.timezone === 'string') next.timezone = body.timezone
  if ('location' in body) next.placeName = (body.location as Location | null)?.placeName ?? null
  if ('weather' in body) {
    const w = queuedWeather(body.weather)
    next.weather = w ? { condition: w.condition, tempC: w.tempC } : null
  }
  return next
}

/**
 * A timeline page with the saves still waiting laid over it: edits show on their cards, and
 * entries written offline join the first page. Used wherever the list came from somewhere other
 * than a live server answer.
 */
export async function withPendingCards(
  userId: string | null,
  path: string,
  data: unknown,
): Promise<unknown> {
  if (!userId || new URL(path, 'http://x').pathname !== '/entries') return data
  const page = data as { items?: TimelineItem[]; nextCursor?: string | null } | null
  if (!page || !Array.isArray(page.items)) return data
  const waiting = await loadOutbox(userId).catch(() => [])
  if (waiting.length === 0) return data

  // Entries (and journals) waiting to go to the trash are already gone from the screen.
  const deletedEntries = new Set(
    waiting.filter((w) => kindOf(w) === 'delete-entry').map((w) => w.entryId),
  )
  const deletedJournals = new Set(
    waiting.filter((w) => kindOf(w) === 'delete-journal').map(journalIdOf),
  )
  const gone = (c: TimelineItem) => deletedEntries.has(c.id) || deletedJournals.has(c.journalId)
  const entries = waiting.filter((w) => kindOf(w) === 'entry')
  const edits = new Map(entries.filter((w) => w.method === 'PATCH').map((w) => [w.entryId, w.body]))
  let items = page.items
    .filter((c) => !gone(c))
    .map((c) => (edits.has(c.id) ? patchCard(c, edits.get(c.id)!) : c))

  const q = new URL(path, 'http://x').searchParams
  if (!q.get('cursor')) {
    const journalId = q.get('journalId')
    const have = new Set(items.map((i) => i.id))
    const oldest = items.at(-1)?.createdAt
    const created = entries
      .filter((w) => w.method === 'POST' && !have.has(w.entryId))
      .map(cardFromCreate)
      .filter((c) => !gone(c))
      .filter((c) => !journalId || c.journalId === journalId)
      // Past the first page there are older entries the new one would sort among: leave it out
      // of this page rather than placing it wrongly.
      .filter((c) => page.nextCursor == null || oldest === undefined || c.createdAt >= oldest)
    items = [...items, ...created].sort(
      (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
    )
  }
  return { ...page, items }
}

/** Lays waiting writes over a read that didn't come live from the server, by path. */
export async function withPendingWrites(
  userId: string | null,
  path: string,
  data: unknown,
): Promise<unknown> {
  const pathname = new URL(path, 'http://x').pathname
  if (pathname === '/journals') return withPendingJournals(userId, data)
  return withPendingCards(userId, path, data)
}

setOverlayHook(withPendingWrites)

/** Reads an entry, with any save still waiting in the outbox laid over the server's copy. */
export async function fetchEntry(id: string): Promise<EntryDetail> {
  const user = getActiveUser()
  // Waiting to go to the trash: it reads as gone, like the server would answer once sent.
  if (
    user &&
    (
      await localDb(user)
        .outbox.where('entryId')
        .equals(outboxKey('delete-entry', id))
        .first()
        .catch(() => undefined)
    )?.kind === 'delete-entry'
  )
    throw new ApiError(404, { error: 'not_found' })
  try {
    return await withPendingEdits(user, await api(`/entries/${id}`, { schema: EntryDetailSchema }))
  } catch (e) {
    // Written offline and not sent yet: the server (or the local copy) has never heard of it.
    const waiting = user
      ? await localDb(user)
          .outbox.where('entryId')
          .equals(id)
          .first()
          .catch(() => undefined)
      : undefined
    if (
      waiting?.method === 'POST' &&
      kindOf(waiting) === 'entry' &&
      (isUnreachable(e) || (e instanceof ApiError && e.status === 404))
    )
      return pendingCreateDetail(waiting)
    throw e
  }
}

// ---- Replay ----

/** The caches a write that reached the server changes. */
function applyAnswer(qc: QueryClient, item: OutboxItem, data: unknown) {
  switch (kindOf(item)) {
    case 'entry': {
      const detail = data as EntryDetail
      qc.setQueryData(keys.entry(detail.entry.id), detail)
      invalidateAfterSave(qc)
      break
    }
    case 'journal':
    case 'journal-order':
      invalidateAfterSave(qc)
      void qc.invalidateQueries({ queryKey: keys.journals })
      invalidateMe(qc) // the default journal can change
      break
    case 'me':
      qc.setQueryData(keys.me, withTempUnit(data as z.infer<typeof MeSchema>))
      if ('defaultTimezone' in item.body) void qc.invalidateQueries({ queryKey: keys.insights })
      break
    case 'delete-entry':
      qc.removeQueries({ queryKey: keys.entry(item.entryId) })
      invalidateAfterTrash(qc)
      break
    case 'delete-journal':
      invalidateAfterTrash(qc)
      break
  }
}

const CHANGES_LOST = {
  journal: "Couldn't save a journal change.",
  'journal-order': "Couldn't save a journal change.",
  me: "A settings change couldn't be saved.",
  'delete-entry': "A delete couldn't be sent. The entry is back.",
  'delete-journal': "A delete couldn't be sent. The journal is back.",
} as const

/** Raises the banner for a write the server refused: where Review goes, and what it says. */
function refused(item: OutboxItem, kind: OutboxKind) {
  // Where "Review" goes: the restored draft, or the entry a quick change was about.
  const review =
    kind === 'journal' || kind === 'journal-order'
      ? '/journals'
      : kind === 'me'
        ? '/settings'
        : kind === 'delete-entry' || !item.draft
          ? `/entry/${item.entryId}`
          : item.method === 'POST'
            ? `/new?draft=${item.target}`
            : `/entry/${item.entryId}/edit`
  const failed = state.failed + 1
  // Several refusals at once (a journal and the entries written in it) get one sentence.
  const count = `${failed} changes couldn't be saved.`
  const message =
    kind === 'entry'
      ? state.message !== null
        ? count
        : null // the banner's own sentence about drafts
      : failed > 1
        ? count
        : CHANGES_LOST[kind]
  set({ failed, review, message })
}

let state: { pending: number; failed: number; review: string | null; message: string | null } = {
  pending: 0,
  failed: 0,
  review: null,
  message: null,
}
const listeners = new Set<() => void>()
const set = (next: Partial<typeof state>) => {
  if (Object.entries(next).every(([k, v]) => state[k as keyof typeof state] === v)) return
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

export const outboxState = () => state
export function subscribeOutbox(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const refreshOutbox = async (userId: string) => {
  try {
    set({ pending: await localDb(userId).outbox.count() })
  } catch {
    // Storage blocked: nothing can be queued either.
  }
}
export const dismissOutboxFailures = () => set({ failed: 0, review: null, message: null })
export const resetOutboxFailures = dismissOutboxFailures

let flushing = false

/** Runs `fn` if no other tab is replaying; a browser without Web Locks falls back to this tab only. */
async function exclusively(fn: () => Promise<void>) {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    await navigator.locks.request('cairn-outbox-replay', { ifAvailable: true }, async (lock) => {
      if (lock) await fn()
    })
  } else await fn()
}

/**
 * Sends the waiting saves in order. Stops at the first one the server can't be reached for (or
 * while signed out) and tries again later. A save the server answers with a refusal (the entry was
 * edited elsewhere, its journal is gone) leaves the queue and goes back to being a draft: opening
 * the entry shows it, and saving it from there runs the usual conflict choice.
 */
export async function flushOutbox(userId: string, qc: QueryClient): Promise<void> {
  if (flushing) return
  flushing = true
  const db = localDb(userId)
  try {
    await exclusively(async () => {
      for (const item of await loadOutbox(userId)) {
        const kind = kindOf(item)
        const forget = () => db.outbox.where('entryId').equals(item.entryId).delete()
        try {
          const data = await api(item.path, {
            method: item.method,
            body: item.method === 'DELETE' ? undefined : item.body,
            schema: ANSWERS[kind],
            // A hung request must not hold the replay lock (and every other tab's replay) forever.
            timeoutMs: 30_000,
          })
          if (kind === 'journal' && item.after)
            await api(`/journals/${journalIdOf(item)}`, {
              method: 'PATCH',
              body: item.after,
              schema: JournalSchema,
              timeoutMs: 30_000,
            })
          await forget()
          applyAnswer(qc, item, data)
        } catch (e) {
          if (isUnreachable(e) || (e instanceof ApiError && e.status === 401)) break
          await forget()
          // Already gone, or already in the trash: the delete is done.
          if (e instanceof ApiError && e.status === 404 && kind.startsWith('delete-')) {
            applyAnswer(qc, item, null)
            continue
          }
          // Our own earlier send of this very save, whose answer never arrived: it is done.
          const conflict = e instanceof ApiError ? ConflictSchema.safeParse(e.body) : null
          if (
            kind === 'entry' &&
            item.method === 'PATCH' &&
            conflict?.success &&
            matchesQueued(item.body, conflict.data.current)
          ) {
            qc.setQueryData(keys.entry(item.entryId), conflict.data.current)
            invalidateAfterSave(qc)
            continue
          }
          // Don't overwrite something typed since (a newer draft in the same slot).
          const draft = item.draft ? RestorableDraft.safeParse(item.draft) : null
          if (draft?.success && !loadDraft(userId, item.target))
            saveDraft(userId, item.target, draft.data)
          refused(item, kind)
        }
      }
    })
  } finally {
    flushing = false
    await refreshOutbox(userId)
    announce(userId)
  }
}
