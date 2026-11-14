import { z } from 'zod'
import { LocationSchema, MoodSchema, WeatherEditSchema } from '@cairn/shared'
import { sameTags } from './tags.ts'
import { sameLocation } from './location.ts'
import { sameWeather } from './weather.ts'

// Unsent edits live in localStorage (SPEC 6, decision 5: server-side drafts come with sync). One
// draft per open editor: a new entry, or an existing entry being edited. Keys include the user id
// so two accounts on one browser never see each other's text.

export const DraftSchema = z.object({
  v: z.literal(1),
  /** Client-minted entry id for a new entry, so a retried save is idempotent (SPEC 4d). */
  newId: z.string().nullable(),
  journalId: z.string(),
  bodyMd: z.string(),
  createdAt: z.number(),
  timezone: z.string(),
  allDay: z.boolean(),
  starred: z.boolean(),
  pinned: z.boolean(),
  /** A key; drafts saved before mood keys hold a 1-5 rating, which MoodSchema converts. */
  mood: MoodSchema.nullable(),
  /** Drafts saved before places existed have none. */
  location: LocationSchema.nullable().default(null),
  weather: WeatherEditSchema.nullable().default(null),
  /** Drafts saved before tags could be edited have none. */
  tags: z.array(z.string()).default([]),
  /** The entry rev the edit started from; null for a new entry. */
  baseRev: z.number().nullable(),
  savedAt: z.number(),
})
export type Draft = z.infer<typeof DraftSchema>

/** What the editor changes; a draft is this plus where it came from. */
export type DraftFields = Pick<
  Draft,
  | 'journalId'
  | 'bodyMd'
  | 'createdAt'
  | 'timezone'
  | 'allDay'
  | 'starred'
  | 'pinned'
  | 'mood'
  | 'location'
  | 'weather'
  | 'tags'
>

const keyFor = (userId: string, target: string) => `cairn:draft:${userId}:${target}`
/** `target` is an entry id, or 'new'. */
export type DraftTarget = string

// localStorage can be absent or throw (private windows, blocked site data): drafts are a safety
// net, so failing quietly beats breaking the editor.
const store = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadDraft(
  userId: string,
  target: DraftTarget,
  s: Storage | null = store(),
): Draft | null {
  try {
    const raw = s?.getItem(keyFor(userId, target))
    if (!raw) return null
    const parsed = DraftSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// Who wants to know when drafts change (the nav count, the drafts list). localStorage only tells
// other tabs, so changes made here are announced by hand; `draftsVersion` is the snapshot.
const listeners = new Set<() => void>()
let version = 0
const changed = () => {
  version++
  listeners.forEach((l) => l())
}
export const draftsVersion = () => version
export function subscribeDrafts(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', changed)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', changed)
  }
}

export interface StoredDraft {
  /** The entry id being edited, or 'new'. */
  target: DraftTarget
  draft: Draft
}

/** Every draft this user has on this device, newest first. */
export function listDrafts(userId: string, s: Storage | null = store()): StoredDraft[] {
  const prefix = keyFor(userId, '')
  const out: StoredDraft[] = []
  try {
    for (let i = 0; s && i < s.length; i++) {
      const key = s.key(i)
      if (!key?.startsWith(prefix)) continue
      const target = key.slice(prefix.length)
      const draft = loadDraft(userId, target, s)
      if (draft) out.push({ target, draft })
    }
  } catch {
    // Unreadable storage: show none.
  }
  return out.sort((a, b) => b.draft.savedAt - a.draft.savedAt)
}

export function saveDraft(
  userId: string,
  target: DraftTarget,
  draft: Omit<Draft, 'v' | 'savedAt'>,
  s: Storage | null = store(),
): boolean {
  try {
    s?.setItem(keyFor(userId, target), JSON.stringify({ ...draft, v: 1, savedAt: Date.now() }))
    changed()
    return !!s
  } catch {
    return false
  }
}

export function clearDraft(userId: string, target: DraftTarget, s: Storage | null = store()) {
  try {
    s?.removeItem(keyFor(userId, target))
    changed()
  } catch {
    // Nothing to clear.
  }
}

export function sameFields(a: DraftFields, b: DraftFields): boolean {
  return (
    a.journalId === b.journalId &&
    a.bodyMd === b.bodyMd &&
    a.createdAt === b.createdAt &&
    a.timezone === b.timezone &&
    a.allDay === b.allDay &&
    a.starred === b.starred &&
    a.pinned === b.pinned &&
    a.mood === b.mood &&
    sameLocation(a.location, b.location) &&
    sameWeather(a.weather, b.weather) &&
    sameTags(a.tags, b.tags)
  )
}
