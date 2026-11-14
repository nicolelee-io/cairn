import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { Hono, type Context } from 'hono'
import {
  LoginRequestSchema,
  UpdateCredentialsSchema,
  UpdateMeSchema,
  type Me,
  type UserRole,
} from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { JournalArchivedError, JournalNotFoundError } from '../repo/entries.ts'
import { createRepos } from '../repo/index.ts'
import { createSession, deleteSession, deleteSessionsOf, SESSION_TTL_MS } from '../repo/sessions.ts'
import { trashRetentionDays } from '../repo/trash.ts'
import {
  findUserById,
  findUserByUsername,
  updateCredentials,
  updatePreferences,
  updateProfile,
  UsernameTakenError,
} from '../repo/users.ts'
import { isHttps, requireAuth, SESSION_COOKIE, type AuthEnv } from './middleware.ts'
import { clientIp, type TrustProxy } from './clientIp.ts'
import { knownDevices } from './device.ts'
import { loginLimits, type LoginLimits } from './rateLimit.ts'
import { hashPassword, verifyPassword } from './password.ts'

export interface AuthOptions {
  now?: () => number
  /** Which peers' X-Forwarded-For to believe (TRUST_PROXY); none when unset. */
  trustProxy?: TrustProxy
}

/** Public: POST /login. Everything else in the router needs a session. */
export function authRoutes(
  db: Db,
  {
    now = Date.now,
    trustProxy,
    limits = loginLimits(now),
  }: AuthOptions & { limits?: LoginLimits } = {},
) {
  const { byIp, byUser } = limits
  const devices = knownDevices(db)

  /**
   * The limit check for a password attempt as `username`. The per-username limit is skipped on a
   * browser that has signed in as that user before, so it can't be used to lock the owner out.
   */
  async function attempt(c: Context, username: string, userId: string | undefined) {
    const ipKey = `ip:${await clientIp(c, trustProxy)}`
    const userKey = `user:${username}`
    const known = userId !== undefined && (await devices.knows(c, userId))
    const wait = Math.max(byIp.retryAfter(ipKey), known ? 0 : byUser.retryAfter(userKey))
    return {
      wait,
      fail() {
        byIp.fail(ipKey)
        if (!known) byUser.fail(userKey)
      },
      // A known device's failures never counted, so its success doesn't clear anyone else's.
      succeed: () => !known && byUser.reset(userKey),
    }
  }

  const routes = new Hono<AuthEnv>()

  routes.post('/login', async (c) => {
    const parsed = LoginRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400)
    const { password } = parsed.data
    const username = parsed.data.username.toLowerCase()

    const user = findUserByUsername(db, username)
    const limit = await attempt(c, username, user?.id)
    if (limit.wait > 0) {
      c.header('Retry-After', String(limit.wait))
      return c.json({ error: 'rate_limited' }, 429)
    }

    if (!(await verifyPassword(user?.passwordHash, password)) || !user) {
      limit.fail()
      return c.json({ error: 'invalid_credentials' }, 401)
    }

    limit.succeed()
    // Only someone holding the right password learns the account is disabled.
    if (user.disabledAt !== null) return c.json({ error: 'account_disabled' }, 403)
    const session = createSession(db, user.id, now())
    setCookie(c, SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isHttps(c),
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    })
    await devices.remember(c, user.id)
    return c.json(toMe(db, user))
  })

  routes.use('*', requireAuth(db, now))

  routes.get('/me', async (c) => {
    const user = findUserById(db, c.get('userId'))
    // The session outlived its user (deleted out of band).
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    // Browsers signed in before known-device cookies existed get one without signing in again.
    if (!(await devices.knows(c, user.id))) await devices.remember(c, user.id)
    return c.json(toMe(db, user))
  })

  routes.patch('/me', async (c) => {
    const parsed = UpdateMeSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400)
    const user = findUserById(db, c.get('userId'))
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    const { journals } = createRepos(db, user.id)
    try {
      if (parsed.data.defaultJournalId !== undefined)
        journals.setDefault(parsed.data.defaultJournalId)
    } catch (e) {
      if (e instanceof JournalNotFoundError) return c.json({ error: 'journal_not_found' }, 404)
      if (e instanceof JournalArchivedError) return c.json({ error: 'journal_archived' }, 409)
      throw e
    }
    updateProfile(db, user.id, {
      ...(parsed.data.displayName !== undefined && { displayName: parsed.data.displayName }),
      ...(parsed.data.defaultTimezone !== undefined && {
        defaultTimezone: parsed.data.defaultTimezone,
      }),
    })
    updatePreferences(db, user.id, {
      ...(parsed.data.tempUnit !== undefined && { tempUnit: parsed.data.tempUnit }),
      ...(parsed.data.autoLocation !== undefined && { autoLocation: parsed.data.autoLocation }),
      ...(parsed.data.showArchivedInMenu !== undefined && {
        showArchivedInMenu: parsed.data.showArchivedInMenu,
      }),
      ...(parsed.data.showStreak !== undefined && { showStreak: parsed.data.showStreak }),
      ...(parsed.data.showBestStreak !== undefined && {
        showBestStreak: parsed.data.showBestStreak,
      }),
    })
    return c.json(toMe(db, findUserById(db, user.id) ?? user))
  })

  // Username and password live apart from PATCH /me so that one never needs the password. A wrong
  // current password counts against the same limiters as login, so this can't be used to guess it.
  routes.post('/credentials', async (c) => {
    const parsed = UpdateCredentialsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400)
    const user = findUserById(db, c.get('userId'))
    if (!user) return c.json({ error: 'unauthorized' }, 401)

    const limit = await attempt(c, user.username, user.id)
    if (limit.wait > 0) {
      c.header('Retry-After', String(limit.wait))
      return c.json({ error: 'rate_limited' }, 429)
    }
    if (!(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
      limit.fail()
      return c.json({ error: 'wrong_password' }, 403)
    }
    limit.succeed()

    const { username, newPassword } = parsed.data
    try {
      updateCredentials(db, user.id, {
        username,
        passwordHash: newPassword === undefined ? undefined : await hashPassword(newPassword),
      })
    } catch (e) {
      if (e instanceof UsernameTakenError) return c.json({ error: 'username_taken' }, 409)
      throw e
    }
    // A new password signs out every other device; this one stays.
    if (newPassword !== undefined) deleteSessionsOf(db, user.id, getCookie(c, SESSION_COOKIE))
    return c.json(toMe(db, findUserById(db, user.id) ?? user))
  })

  routes.post('/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) deleteSession(db, token)
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.body(null, 204)
  })

  return routes
}

export function toMe(
  db: Db,
  u: {
    id: string
    username: string
    displayName: string
    defaultTimezone: string
    tempUnit: 'F' | 'C'
    autoLocation: boolean
    showArchivedInMenu: boolean
    showStreak: boolean
    showBestStreak: boolean
    avatarUpdatedAt: number | null
    role: UserRole
  },
): Me {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    defaultTimezone: u.defaultTimezone,
    defaultJournalId: createRepos(db, u.id).journals.defaultId(),
    tempUnit: u.tempUnit,
    autoLocation: u.autoLocation,
    showArchivedInMenu: u.showArchivedInMenu,
    showStreak: u.showStreak,
    showBestStreak: u.showBestStreak,
    avatarUpdatedAt: u.avatarUpdatedAt,
    role: u.role,
    trashRetentionDays: trashRetentionDays(db),
  }
}
