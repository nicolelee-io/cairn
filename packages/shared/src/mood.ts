import { z } from 'zod'

/**
 * Moods are stored as a text key, never as an emoji (SPEC 4a); this is the only place the emoji
 * live. `valence` (-2..2) is for trends and the calendar tint only: moods are not a linear scale,
 * so never average the keys themselves. Order is the picker's order (two rows of seven).
 */
export const MOODS = [
  { key: 'happy', emoji: '😄', label: 'Happy', valence: 2 },
  { key: 'content', emoji: '🙂', label: 'Content', valence: 1 },
  { key: 'calm', emoji: '😌', label: 'Calm', valence: 1 },
  { key: 'loved', emoji: '🥰', label: 'Loved', valence: 2 },
  { key: 'excited', emoji: '🤩', label: 'Excited', valence: 2 },
  { key: 'meh', emoji: '😐', label: 'Meh', valence: 0 },
  { key: 'tired', emoji: '😴', label: 'Tired', valence: -1 },
  { key: 'sad', emoji: '😢', label: 'Sad', valence: -2 },
  { key: 'down', emoji: '😔', label: 'Down', valence: -1 },
  { key: 'anxious', emoji: '😰', label: 'Anxious', valence: -1 },
  { key: 'stressed', emoji: '😫', label: 'Stressed', valence: -2 },
  { key: 'frustrated', emoji: '😤', label: 'Frustrated', valence: -1 },
  { key: 'angry', emoji: '😠', label: 'Angry', valence: -2 },
  { key: 'unwell', emoji: '🤒', label: 'Unwell', valence: -1 },
] as const

export type MoodKey = (typeof MOODS)[number]['key']
export type Mood = (typeof MOODS)[number]

const KEYS = MOODS.map((m) => m.key) as [MoodKey, ...MoodKey[]]

export function moodByKey(key: string | null | undefined): Mood | undefined {
  return MOODS.find((m) => m.key === key)
}

/** The old 1-5 ratings (😞 😕 😐 🙂 😄), as the keys they became. */
const LEGACY: Record<number, MoodKey> = { 1: 'sad', 2: 'down', 3: 'meh', 4: 'content', 5: 'happy' }

/** A mood key, or an old 1-5 rating (queued edits, drafts and cached copies written before keys). */
export const MoodSchema = z.union([
  z.enum(KEYS),
  z
    .number()
    .int()
    .min(1)
    .max(5)
    .transform((n) => LEGACY[n]!),
])

/** Reads a stored or cached value leniently: a key or an old rating comes back as a key, anything else is unrated. */
export function readMood(value: unknown): MoodKey | null {
  const r = MoodSchema.safeParse(value)
  return r.success ? r.data : null
}
