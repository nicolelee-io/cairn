import type { Db } from '../db/index.ts'
import { findUserByUsername, setDisabled, setRole } from '../repo/users.ts'

export type MakeAdminResult = { ok: true } | { ok: false; message: string }

/**
 * The escape hatch for a server with no usable admin (a hand-edited DB, an old restore): makes the
 * user an admin and re-enables them. The app itself never lets the last admin go. The CLI's core.
 */
export function makeAdmin(db: Db, username: string): MakeAdminResult {
  const user = findUserByUsername(db, username.trim())
  if (!user) return { ok: false, message: `No user "${username}".` }
  setRole(db, user.id, 'admin')
  if (user.disabledAt !== null) setDisabled(db, user.id, false)
  return { ok: true }
}
