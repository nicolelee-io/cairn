import { deleteCookie, getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { UserRole } from '@cairn/shared'
import type { Db } from '../db/index.ts'
import { validateSession } from '../repo/sessions.ts'

export const SESSION_COOKIE = 'cairn_session'

export type AuthEnv = { Variables: { userId: string; role: UserRole } }

export const requireAuth = (db: Db, now: () => number = Date.now) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE)
    const session = token ? validateSession(db, token, now()) : null
    if (!session) {
      if (token) deleteCookie(c, SESSION_COOKIE, { path: '/' })
      return c.json({ error: 'unauthorized' }, 401)
    }
    c.set('userId', session.userId)
    c.set('role', session.role)
    await next()
  })

/** Server-wide settings and Manage users. Goes after requireAuth, which reads the role fresh. */
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  if (c.get('role') !== 'admin') return c.json({ error: 'forbidden' }, 403)
  await next()
})

/**
 * CSRF defence for the cookie session, on top of SameSite=Lax: a state-changing request carrying
 * an Origin must come from our own host. (hono/csrf only inspects form content types, which JSON
 * requests bypass.) No Origin is allowed unless the browser says it is cross-site, so curl and
 * same-origin fetches that omit it keep working.
 */
export const originCheck = createMiddleware(async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next()
  const host = c.req.header('host') ?? new URL(c.req.url).host
  const origin = c.req.header('origin')
  if (origin) {
    let originHost: string | null = null
    try {
      originHost = new URL(origin).host
    } catch {
      /* malformed Origin is rejected below */
    }
    if (originHost !== host) return c.json({ error: 'bad_origin' }, 403)
  } else if (c.req.header('sec-fetch-site') === 'cross-site') {
    return c.json({ error: 'bad_origin' }, 403)
  }
  await next()
})

/** Secure cookies only when the request really arrived over https (the tunnel sets X-Forwarded-Proto). */
export function isHttps(c: { req: { header(n: string): string | undefined; url: string } }) {
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim()
  return (proto ?? new URL(c.req.url).protocol.replace(':', '')) === 'https'
}
