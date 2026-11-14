// The three daily prompts (docs/design/prompts-proposal.md). Pure: the page keeps the state in localStorage.
//
// Today's ids are remembered with the date, so they don't change between loads and adding or
// deleting a prompt mid-day doesn't reshuffle them. A refresh and each new day take the next ones
// from a shuffle bag (a shuffled order plus a position), so nothing repeats until the list is used up.

export const DAILY_COUNT = 3

export interface DailyState {
  /** The local date (YYYY-MM-DD) `shown` was drawn for. */
  day: string
  shown: string[]
  bag: string[]
  pos: number
  /** A fingerprint of the list the bag was shuffled from; a different list reshuffles it. */
  sig: string
}

/** Fingerprint of a set of ids (order ignored): djb2 over the sorted ids. Cheap, not cryptographic. */
export function listSignature(ids: string[]): string {
  let h = 5381
  for (const id of [...ids].sort()) {
    for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0
    h = ((h << 5) + h + 44) | 0
  }
  return `${ids.length}:${(h >>> 0).toString(36)}`
}

/** Fisher-Yates; `random` returns [0, 1). */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

const EMPTY: DailyState = { day: '', shown: [], bag: [], pos: 0, sig: '' }

/**
 * The daily prompts for `today`, given what was stored. Keeps today's ids (dropping ones that no
 * longer exist and topping up from the bag); a new day or `refresh` draws a new set.
 */
export function dailyPrompts(
  stored: DailyState | null,
  ids: string[],
  today: string,
  { refresh = false, random = Math.random }: { refresh?: boolean; random?: () => number } = {},
): DailyState {
  if (ids.length === 0) return { ...EMPTY, day: today }
  const valid = new Set(ids)
  const want = Math.min(DAILY_COUNT, ids.length)
  const s = stored ?? EMPTY

  let { bag, pos } = s
  const sig = listSignature(ids)
  let shown = s.shown.filter((id) => valid.has(id))
  if (refresh || s.day !== today) shown = []

  // A different list: reshuffle, with what is on screen last so it isn't drawn straight away again.
  if (s.sig !== sig) {
    const onScreen = new Set(shown)
    bag = [
      ...shuffle(
        ids.filter((id) => !onScreen.has(id)),
        random,
      ),
      ...shuffle(shown, random),
    ]
    pos = 0
  }

  while (shown.length < want) {
    if (pos >= bag.length) {
      bag = shuffle(ids, random)
      pos = 0
    }
    const id = bag[pos++]!
    if (!shown.includes(id)) shown.push(id)
  }
  return { day: today, shown, bag, pos, sig }
}
