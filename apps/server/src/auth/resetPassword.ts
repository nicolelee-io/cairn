import { NewPasswordSchema } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { deleteSessionsOf } from '../repo/sessions.ts'
import { findUserByUsername, updateCredentials } from '../repo/users.ts'
import { hashPassword } from './password.ts'

export type ResetResult =
  { ok: true } | { ok: false; reason: 'no_such_user' | 'weak_password'; message: string }

/**
 * Sets a user's password with the app's own rules and hashing, then ends all of their sessions so
 * whoever knew the old password is signed out. The CLI's core, apart from the terminal handling.
 */
export async function resetPassword(
  db: Db,
  username: string,
  password: string,
): Promise<ResetResult> {
  const user = findUserByUsername(db, username.trim())
  if (!user) return { ok: false, reason: 'no_such_user', message: `No user "${username}".` }
  const valid = NewPasswordSchema.safeParse(password)
  if (!valid.success)
    return {
      ok: false,
      reason: 'weak_password',
      message: valid.error.issues[0]?.message ?? 'Invalid password.',
    }
  updateCredentials(db, user.id, { passwordHash: await hashPassword(password) })
  deleteSessionsOf(db, user.id)
  return { ok: true }
}
