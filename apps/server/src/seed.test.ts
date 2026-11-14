import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyPassword } from './auth/password.ts'
import { countUsers, findUserByUsername } from './repo/users.ts'
import { seedInitialUser } from './seed.ts'
import { memoryDb } from './test-helpers.ts'

const initial = {
  username: 'Alice',
  password: 'first-password',
  displayName: 'Alice',
  timezone: 'America/Denver',
}

afterEach(() => vi.restoreAllMocks())

describe('seedInitialUser', () => {
  it('creates the first user with a hashed password', async () => {
    const { db } = memoryDb()
    expect(await seedInitialUser(db, initial)).toBe(true)
    const user = findUserByUsername(db, 'alice')!
    expect(user.defaultTimezone).toBe('America/Denver')
    expect(user.passwordHash).not.toContain('first-password')
    expect(await verifyPassword(user.passwordHash, 'first-password')).toBe(true)
  })

  it('never touches an existing user, even if the env values change', async () => {
    const { db } = memoryDb()
    await seedInitialUser(db, initial)
    expect(await seedInitialUser(db, { ...initial, username: 'other', password: 'changed' })).toBe(
      false,
    )
    expect(countUsers(db)).toBe(1)
    const user = findUserByUsername(db, 'alice')!
    expect(await verifyPassword(user.passwordHash, 'first-password')).toBe(true)
  })

  it('warns and creates nobody when no initial user is configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { db } = memoryDb()
    expect(await seedInitialUser(db, undefined)).toBe(false)
    expect(countUsers(db)).toBe(0)
    expect(warn).toHaveBeenCalled()
  })
})
