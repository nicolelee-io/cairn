import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import type { Health } from '@cairn/shared'
import { authRoutes, type AuthOptions } from './auth/routes.ts'
import { originCheck, requireAdmin, requireAuth, type AuthEnv } from './auth/middleware.ts'
import { loginLimits } from './auth/rateLimit.ts'
import type { Db } from './db/index.ts'
import { adminRoutes } from './routes/admin.ts'
import { backupRoutes } from './routes/backup.ts'
import { entryRoutes } from './routes/entries.ts'
import { exportRoutes } from './routes/export.ts'
import { importRoutes } from './routes/import.ts'
import { importJobs, type ImportJobs } from './import/jobs.ts'
import { journalRoutes } from './routes/journals.ts'
import { insightRoutes } from './routes/insights.ts'
import { mediaRoutes } from './routes/media.ts'
import { promptRoutes } from './routes/prompts.ts'
import { templateRoutes } from './routes/templates.ts'
import { tagRoutes } from './routes/tags.ts'
import { trashRoutes } from './routes/trash.ts'
import { searchRoutes } from './routes/search.ts'
import { syncRoutes } from './routes/sync.ts'
import { attachmentRoutes } from './routes/attachments.ts'
import { avatarRoutes } from './routes/avatar.ts'
import { photoRoutes } from './routes/photos.ts'
import { placeRoutes } from './routes/places.ts'
import { storageRoutes } from './routes/storage.ts'
import { weatherRoutes } from './routes/weather.ts'
import { googleKeys as buildGoogleKeys, type GoogleKeys } from './places/index.ts'

/**
 * The most a request body may hold anywhere in the API but the upload routes. The largest JSON
 * body is an entry's text (500,000 characters, at most four bytes each).
 */
export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024
/** Routes that take a file and enforce a limit of their own (a new upload route goes here too). */
const UPLOAD_ROUTES = new Set([
  'POST /api/photos',
  'PUT /api/attachments',
  'PUT /api/import',
  'PUT /api/avatar',
])

export interface AppConfig extends AuthOptions {
  sha: string
  /** ISO build time (BUILD_DATE); shown in Settings > About. */
  builtAt?: string
  db: Db
  /** Where photo and attachment files live; they 404 without it. */
  dataDir?: string
  /** The Google key (Settings or env) and the place lookups built on it; /places answers 424 without a key. */
  googleKeys?: GoogleKeys
  /** Directory holding the built SPA; omit in dev, where Vite serves it. */
  webDist?: string
  /** The fetch behind alert messages; tests swap it. */
  notifyFetch?: typeof fetch
  /** Imports from Settings; built here from `dataDir` unless a test passes its own. */
  imports?: ImportJobs
}

export function createApp({
  sha,
  builtAt,
  db,
  dataDir,
  googleKeys,
  webDist,
  now,
  trustProxy,
  notifyFetch,
  imports,
}: AppConfig) {
  const app = new Hono()
  // An attachment file opened in its own tab (a PDF) gets a policy of its own: the app's
  // `object-src 'none'` makes Chrome's built-in PDF viewer show a blank page. Registered before
  // secureHeaders so it runs after it and has the last word. Nothing on these responses can run
  // script: the bytes are checked to be PDF/MP4/MOV/M4A and sent with nosniff.
  app.use('/api/attachments/:id', async (c, next) => {
    await next()
    if (c.req.method === 'GET' && c.res.ok)
      c.res.headers.set(
        'Content-Security-Policy',
        "default-src 'none'; object-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
      )
  })
  // CodeMirror and the inlined icons style elements at runtime, hence 'unsafe-inline' for styles
  // only; scripts are same-origin files. Photos are same-origin <img>s; the only other image origin is
  // OSM's tile server for the map (Markdown shows remote images as links).
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // OpenStreetMap's tile server, for the Entries map view.
        imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  )

  const api = new Hono<AuthEnv>()
  api.use('*', originCheck)
  // Before anything reads a body, the public login included: without it a request of any size is
  // held in memory before it is refused. The upload routes cap their own bodies.
  const jsonLimit = bodyLimit({
    maxSize: MAX_JSON_BODY_BYTES,
    onError: (c) => c.json({ error: 'too_large' }, 413),
  })
  api.use('*', (c, next) =>
    UPLOAD_ROUTES.has(`${c.req.method} ${c.req.path}`) ? next() : jsonLimit(c, next),
  )
  api.get('/health', (c) => c.json<Health>({ status: 'ok', sha, builtAt: builtAt ?? null }))
  const limits = loginLimits(now)
  api.route('/auth', authRoutes(db, { now, trustProxy, limits })) // login is public; the rest needs a session

  // Everything registered after this line needs a session. Unauthenticated callers get 401 even
  // for routes that don't exist, so the API's shape isn't probeable.
  api.use('*', requireAuth(db, now))
  // Server-wide settings are admin only (SPEC Phase 8, Settings tiers). Reading the attachment
  // limit stays open: every uploader needs it, and the upload enforces it anyway.
  api.on(['GET', 'PUT', 'DELETE'], '/places/key', requireAdmin)
  api.put('/attachments/limit', requireAdmin)
  api.use('/backup/*', requireAdmin)
  // Categories and suggested prompts are read by everyone, written by admins only.
  api.on(
    ['POST', 'PUT', 'PATCH', 'DELETE'],
    ['/prompts/categories', '/prompts/categories/*', '/prompts/suggested', '/prompts/suggested/*'],
    requireAdmin,
  )
  const keys = googleKeys ?? buildGoogleKeys(db)
  api.route('/admin', adminRoutes(db, limits, keys, dataDir, notifyFetch))
  api.route('/journals', journalRoutes(db))
  api.route('/prompts', promptRoutes(db))
  api.route('/tags', tagRoutes(db))
  api.route('/templates', templateRoutes(db))
  api.route('/trash', trashRoutes(db))
  api.route('/insights', insightRoutes(db))
  api.route('/media', mediaRoutes(db))
  api.route('/entries', entryRoutes(db, keys))
  api.route('/search', searchRoutes(db))
  api.route('/places', placeRoutes(keys))
  api.route('/weather', weatherRoutes(keys))
  api.route('/sync', syncRoutes(db, dataDir))
  if (dataDir) {
    api.route('/avatar', avatarRoutes(db, dataDir))
    api.route('/photos', photoRoutes(db, dataDir))
    api.route('/attachments', attachmentRoutes(db, dataDir))
    api.route('/export', exportRoutes(db, dataDir))
    api.route('/import', importRoutes(db, imports ?? importJobs(db, dataDir)))
    api.route('/storage', storageRoutes(db, dataDir))
    api.route('/backup', backupRoutes(dataDir))
  }
  api.all('*', (c) => c.json({ error: 'not_found' }, 404))
  app.route('/api', api)

  if (webDist) {
    // serveStatic resolves roots relative to cwd.
    const root = relative(process.cwd(), webDist) || '.'
    app.use(
      '*',
      serveStatic({
        root,
        // Vite content-hashes everything under /assets, so it never changes under its name.
        onFound: (path, c) => {
          if (path.includes('/assets/'))
            c.header('Cache-Control', 'public, max-age=31536000, immutable')
        },
      }),
    )
    app.get('*', async (c) => {
      // A missing file (a stale /assets/x.js after a deploy) is a 404, not the app shell.
      if (/\.[A-Za-z0-9]+$/.test(c.req.path)) return c.text('Not found', 404)
      c.header('Cache-Control', 'no-cache')
      return c.html(await readFile(join(webDist, 'index.html'), 'utf8'))
    })
  }

  return app
}
