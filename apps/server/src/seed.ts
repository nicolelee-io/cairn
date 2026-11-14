import type { InitialUser } from './config.ts'
import type { Db } from './db/index.ts'
import { hashPassword } from './auth/password.ts'
import { countUsers, createUser } from './repo/users.ts'

/** Creates the first user (an admin) from env, only while the user table is empty. Returns whether it did. */
export async function seedInitialUser(db: Db, initial: InitialUser | undefined) {
  if (countUsers(db) > 0) return false
  if (!initial) {
    console.warn(
      'No users exist and INITIAL_USERNAME/INITIAL_PASSWORD are not set: nobody can log in',
    )
    return false
  }
  createUser(db, {
    username: initial.username,
    passwordHash: await hashPassword(initial.password),
    displayName: initial.displayName,
    timezone: initial.timezone,
    role: 'admin', // the first user runs the server
  })
  console.log(`Created initial user "${initial.username.toLowerCase()}"`)
  return true
}
