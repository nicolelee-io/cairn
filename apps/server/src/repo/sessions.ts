import { createHash, randomBytes } from 'node:crypto'
import { and, eq, lt, ne } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { sessions, users } from '../db/schema.ts'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function createSession(db: Db, userId: string, now = Date.now()) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = now + SESSION_TTL_MS
  db.insert(sessions)
    .values({ id: hashToken(token), userId, createdAt: now, expiresAt })
    .run()
  return { token, expiresAt }
}

/**
 * Returns the session's user and role, or null if unknown, expired or the user is disabled (the
 * session is then deleted). Slides expiry once past half-life. The role is read on every request,
 * so a demotion or a disable takes effect at once.
 */
export function validateSession(db: Db, token: string, now = Date.now()) {
  const id = hashToken(token)
  const s = db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      role: users.role,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get()
  if (!s) return null
  if (s.expiresAt <= now || s.disabledAt !== null) {
    db.delete(sessions).where(eq(sessions.id, id)).run()
    return null
  }
  if (s.expiresAt - now < SESSION_TTL_MS / 2) {
    db.update(sessions)
      .set({ expiresAt: now + SESSION_TTL_MS })
      .where(eq(sessions.id, id))
      .run()
  }
  return { userId: s.userId, role: s.role }
}

export function deleteSession(db: Db, token: string) {
  db.delete(sessions)
    .where(eq(sessions.id, hashToken(token)))
    .run()
}

export function purgeExpiredSessions(db: Db, now = Date.now()) {
  db.delete(sessions).where(lt(sessions.expiresAt, now)).run()
}

/** Ends every session of the user except the one holding `keepToken` (null = end them all). */
export function deleteSessionsOf(db: Db, userId: string, keepToken: string | null = null) {
  db.delete(sessions)
    .where(
      keepToken
        ? and(eq(sessions.userId, userId), ne(sessions.id, hashToken(keepToken)))
        : eq(sessions.userId, userId),
    )
    .run()
}
