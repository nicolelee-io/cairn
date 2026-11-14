import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { uuidv7, type UserRole } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { users } from '../db/schema.ts'

// Users are the one table not scoped by a userId: it is where the userId comes from.
export function findUserByUsername(db: Db, username: string) {
  return db.select().from(users).where(eq(users.username, username.toLowerCase())).get()
}

export function findUserById(db: Db, id: string) {
  return db.select().from(users).where(eq(users.id, id)).get()
}

export function updatePreferences(
  db: Db,
  id: string,
  prefs: {
    tempUnit?: 'F' | 'C'
    autoLocation?: boolean
    showArchivedInMenu?: boolean
    showStreak?: boolean
    showBestStreak?: boolean
  },
) {
  if (Object.keys(prefs).length) db.update(users).set(prefs).where(eq(users.id, id)).run()
}

export function updateProfile(
  db: Db,
  id: string,
  profile: { displayName?: string; defaultTimezone?: string },
) {
  if (Object.keys(profile).length) db.update(users).set(profile).where(eq(users.id, id)).run()
}

export class UsernameTakenError extends Error {}

/** Sets a new username (lowercased) and/or password hash. Throws UsernameTakenError on a clash. */
export function updateCredentials(
  db: Db,
  id: string,
  change: { username?: string; passwordHash?: string },
) {
  const set = {
    ...(change.username !== undefined && { username: change.username.toLowerCase() }),
    ...(change.passwordHash !== undefined && { passwordHash: change.passwordHash }),
  }
  if (!Object.keys(set).length) return
  try {
    db.update(users).set(set).where(eq(users.id, id)).run()
  } catch (e) {
    if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new UsernameTakenError()
    throw e
  }
}

/** `null` removes the avatar. The file itself is the caller's to write or delete. */
export function setAvatarUpdatedAt(db: Db, id: string, at: number | null) {
  db.update(users).set({ avatarUpdatedAt: at }).where(eq(users.id, id)).run()
}

export function countUsers(db: Db): number {
  return db.select({ n: count() }).from(users).get()?.n ?? 0
}

export function createUser(
  db: Db,
  input: {
    username: string
    passwordHash: string
    displayName: string
    timezone: string
    role?: UserRole
  },
  now = Date.now(),
) {
  const row = {
    id: uuidv7(now),
    username: input.username.toLowerCase(),
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    defaultTimezone: input.timezone,
    role: input.role ?? 'user',
    createdAt: now,
  }
  try {
    db.insert(users).values(row).run()
  } catch (e) {
    if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new UsernameTakenError()
    throw e
  }
  return row
}

/** Manage users: everyone, oldest first. Small by design (a family at most), so no paging. */
export function listUsers(db: Db) {
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.id))
    .all()
}

/** Admins who can still sign in. The app never lets this reach zero. */
export function countActiveAdmins(db: Db): number {
  return (
    db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)))
      .get()?.n ?? 0
  )
}

export function setRole(db: Db, id: string, role: UserRole) {
  db.update(users).set({ role }).where(eq(users.id, id)).run()
}

/** The caller ends the user's sessions when disabling. */
export function setDisabled(db: Db, id: string, disabled: boolean, now = Date.now()) {
  db.update(users)
    .set({ disabledAt: disabled ? now : null })
    .where(eq(users.id, id))
    .run()
}
