import { tagKey } from '@cairn/shared'

/** The same tags, ignoring case and order (names match case-insensitively, see `tagKey`). */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const keys = new Set(a.map(tagKey))
  return keys.size === new Set(b.map(tagKey)).size && b.every((t) => keys.has(tagKey(t)))
}

/** Adds a typed tag unless one matching it (ignoring case) is already there. */
export function withTag(tags: readonly string[], name: string): string[] {
  const clean = name.trim().replace(/^#+\s*/, '')
  if (!clean || tags.some((t) => tagKey(t) === tagKey(clean))) return [...tags]
  return [...tags, clean]
}

/**
 * Offline the tag list is counted from the few journals kept on the device. The suggestions should
 * still offer every tag the last online read knew: this list first (its counts are current), then
 * the remembered tags it doesn't have.
 */
export function withRememberedTags<T extends { name: string; count: number }>(
  fromDevice: readonly T[],
  remembered: readonly T[] | undefined,
): T[] {
  const have = new Set(fromDevice.map((t) => tagKey(t.name)))
  return [...fromDevice, ...(remembered ?? []).filter((t) => !have.has(tagKey(t.name)))]
}
