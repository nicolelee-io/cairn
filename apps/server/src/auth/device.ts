import { randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { getSignedCookie, setSignedCookie } from 'hono/cookie'
import type { Db } from '../db/index.ts'
import { appSettingsRepo } from '../repo/appSettings.ts'
import { isHttps } from './middleware.ts'

const COOKIE = 'cairn_device'
const SECRET_KEY = 'device_cookie_secret'
/** Browsers cap a cookie's lifetime at 400 days. */
const MAX_AGE_S = 400 * 24 * 60 * 60

/**
 * "Known device" cookies (OWASP's answer to username lockouts): a browser that has signed in as a
 * user carries a signed cookie naming that user id, kept across logout. Such a browser skips the
 * per-username limit, so someone hammering the username can't lock the owner out of their own
 * devices; the per-IP limit still applies to everyone. The HMAC secret is made on first use and
 * kept in `app_setting`.
 */
export function knownDevices(db: Db) {
  let secret: string | undefined
  const key = () => {
    if (secret) return secret
    const store = appSettingsRepo(db)
    secret = store.get(SECRET_KEY)
    if (!secret) {
      secret = randomBytes(32).toString('base64url')
      store.set(SECRET_KEY, secret)
    }
    return secret
  }

  return {
    /** Whether this browser has signed in as `userId` before. */
    async knows(c: Context, userId: string): Promise<boolean> {
      return (await getSignedCookie(c, key(), COOKIE)) === userId
    },
    async remember(c: Context, userId: string) {
      await setSignedCookie(c, COOKIE, userId, key(), {
        httpOnly: true,
        sameSite: 'Lax',
        secure: isHttps(c),
        path: '/api/auth',
        maxAge: MAX_AGE_S,
      })
    },
  }
}
export type KnownDevices = ReturnType<typeof knownDevices>
