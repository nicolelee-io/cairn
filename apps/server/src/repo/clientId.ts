import { IdTakenError } from './entries.ts'

/**
 * Create-by-client-id (SPEC 4d): given the row found under a client-supplied id (or undefined), returns
 * it for an idempotent replay, or undefined when the id is free. Someone else's row, or a
 * tombstoned one (a deleted id is never reused), throws `IdTakenError`.
 */
export function replayOrFree<T extends { userId: string; deletedAt: number | null }>(
  existing: T | undefined,
  userId: string,
): T | undefined {
  if (existing && (existing.userId !== userId || existing.deletedAt !== null))
    throw new IdTakenError()
  return existing
}
