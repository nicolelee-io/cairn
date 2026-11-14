import { Hono, type Context } from 'hono'
import {
  CreateUserSchema,
  ResetUserPasswordSchema,
  TrashSettingsSchema,
  UpdateWeatherSettingsSchema,
  UpdateNotifySettingsSchema,
  UpdatePhotoQualitySchema,
  UpdateUserSchema,
  type AdminPhotos,
  type AdminStorage,
  type NotifySettings,
  type NotifyTestResult,
  type ServerHealth,
  type CleanupReport,
  type AdminUser,
  type TrashSettings,
  type WeatherSettings,
} from '@cairn/shared'
import { requireAdmin, type AuthEnv } from '../auth/middleware.ts'
import { hashPassword } from '../auth/password.ts'
import type { LoginLimits } from '../auth/rateLimit.ts'
import type { Db } from '../db/index.ts'
import type { GoogleKeys } from '../places/index.ts'
import { deleteSessionsOf } from '../repo/sessions.ts'
import {
  countActiveAdmins,
  createUser,
  findUserById,
  listUsers,
  setDisabled,
  setRole,
  updateCredentials,
  UsernameTakenError,
} from '../repo/users.ts'
import { checkHealth } from '../health/check.ts'
import { notifySettings, sendAlert } from '../health/notify.ts'
import { readBackupStatus } from '../backup/status.ts'
import { BACKUP_WITHIN_MS, photoCompressor } from '../photos/compressExisting.ts'
import { describeMaintenance, runMaintenance } from '../maintenance.ts'
import { TRASH_RETENTION_KEY, trashRetentionDays } from '../repo/trash.ts'
import { appSettingsRepo } from '../repo/appSettings.ts'
import { photoQuality } from '../photos/quality.ts'
import { adminUsage } from '../storage/usage.ts'
import { badRequest, notFound, parseBody } from './util.ts'

const toAdminUser = (u: ReturnType<typeof listUsers>[number]): AdminUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  disabled: u.disabledAt !== null,
  createdAt: u.createdAt,
})

/**
 * Manage users, admins only. Accounts, never content: nothing here reads or names another user's
 * journals, entries or files (storage gives their sizes only). There is no hard delete (files are shared by sha256 and sit in
 * backups and offline copies); disabling ends the user's sessions and stops sign-in.
 */
export function adminRoutes(
  db: Db,
  limits: LoginLimits,
  keys: GoogleKeys,
  dataDir?: string,
  notifyFetch?: typeof fetch,
) {
  const r = new Hono<AuthEnv>()
  r.use('*', requireAdmin)

  const one = (id: string) => {
    const u = findUserById(db, id)
    return u && toAdminUser(u)
  }
  // An admin changes their own role, state or password through Account, never here, so a stolen
  // session can't skip the current-password check or lock the server out of its last admin.
  const isSelf = (c: Context<AuthEnv>) => c.req.param('id') === c.get('userId')

  r.get('/users', (c) => c.json({ users: listUsers(db).map(toAdminUser) }))

  r.post('/users', async (c) => {
    const body = await parseBody(c, CreateUserSchema)
    if (!body) return badRequest(c)
    // The new user starts in the admin's timezone (a family usually shares one); they can change it.
    const admin = findUserById(db, c.get('userId'))
    try {
      const row = createUser(db, {
        username: body.username,
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName,
        timezone: admin?.defaultTimezone ?? 'UTC',
        role: body.role,
      })
      return c.json(one(row.id), 201)
    } catch (e) {
      if (e instanceof UsernameTakenError) return c.json({ error: 'username_taken' }, 409)
      throw e
    }
  })

  r.patch('/users/:id', async (c) => {
    const body = await parseBody(c, UpdateUserSchema)
    if (!body) return badRequest(c)
    const target = findUserById(db, c.req.param('id'))
    if (!target) return notFound(c)
    if (isSelf(c)) return c.json({ error: 'self' }, 409)

    const result = db.transaction(() => {
      const losesAdmin =
        target.role === 'admin' &&
        target.disabledAt === null &&
        (body.role === 'user' || body.disabled === true)
      // Unreachable while the caller is an active admin other than the target, but the rule is
      // "never zero admins", so it is checked where it is enforced rather than assumed.
      if (losesAdmin && countActiveAdmins(db) <= 1) return 'last_admin' as const
      if (body.role !== undefined) setRole(db, target.id, body.role)
      if (body.disabled !== undefined) setDisabled(db, target.id, body.disabled)
      return 'ok' as const
    })
    if (result === 'last_admin') return c.json({ error: 'last_admin' }, 409)

    if (body.disabled === true) deleteSessionsOf(db, target.id)
    if (body.disabled === false) limits.byUser.reset(`user:${target.username}`)
    return c.json(one(target.id))
  })

  r.post('/users/:id/password', async (c) => {
    const body = await parseBody(c, ResetUserPasswordSchema)
    if (!body) return badRequest(c)
    const target = findUserById(db, c.req.param('id'))
    if (!target) return notFound(c)
    if (isSelf(c)) return c.json({ error: 'self' }, 409)
    updateCredentials(db, target.id, { passwordHash: await hashPassword(body.newPassword) })
    // Whoever knew the old password is signed out; a sign-in lockout on the name is lifted.
    deleteSessionsOf(db, target.id)
    limits.byUser.reset(`user:${target.username}`)
    return c.json(one(target.id))
  })

  // How long deleted entries and journals stay in the trash, for everyone (the daily run purges).
  r.get('/trash', (c) => c.json<TrashSettings>({ retentionDays: trashRetentionDays(db) }))
  r.put('/trash', async (c) => {
    const body = await parseBody(c, TrashSettingsSchema)
    if (!body) return badRequest(c)
    appSettingsRepo(db).set(TRASH_RETENTION_KEY, String(body.retentionDays))
    return c.json<TrashSettings>({ retentionDays: trashRetentionDays(db) })
  })

  // Where automatic weather comes from: Open-Meteo (no key) or Google (the Places key).
  const weatherState = (): WeatherSettings => ({
    provider: keys.weatherChoice.get(),
    googleConfigured: keys.googleConfigured(),
  })
  r.get('/weather', (c) => c.json(weatherState()))
  r.put('/weather', async (c) => {
    const body = await parseBody(c, UpdateWeatherSettingsSchema)
    if (!body) return badRequest(c)
    // Google needs its key; choosing it without one would silently turn weather off.
    if (body.provider === 'google' && !keys.googleConfigured()) {
      return c.json({ error: 'google_key_needed' }, 409)
    }
    keys.weatherChoice.set(body.provider)
    return c.json(weatherState())
  })

  // Server alerts through ntfy. The token is write-only: it is saved here and never read back.
  const notify = notifySettings(db)
  r.get('/notifications', (c) => c.json<NotifySettings>(notify.view()))
  r.put('/notifications', async (c) => {
    const body = await parseBody(c, UpdateNotifySettingsSchema)
    if (!body) return badRequest(c)
    notify.save(body)
    return c.json<NotifySettings>(notify.view())
  })
  r.post('/notifications/test', async (c) =>
    c.json<NotifyTestResult>(
      await sendAlert(
        notify.read(),
        { title: 'Cairn test', message: 'Alerts from Cairn are working.', tags: ['bell'] },
        notifyFetch,
      ),
    ),
  )

  // Sizes only: each user's journals are a list of numbers, never their names or ids.
  if (dataDir) {
    r.get('/health', (c) => c.json<ServerHealth>(checkHealth(db, dataDir)))
    r.get('/storage', async (c) => c.json<AdminStorage>(await adminUsage(db, dataDir)))

    // The cleanup that runs daily (trash expiry, then media): GET previews it, POST runs it now.
    // Counts only; the paths of missing files go to the server log.
    const cleanup = (dryRun: boolean) => {
      const { missingPaths, ...report } = runMaintenance(db, dataDir, Date.now(), { dryRun })
      const line = describeMaintenance({ ...report, missingPaths })
      if (line && !dryRun) console.log(line)
      return report satisfies CleanupReport
    }
    r.get('/cleanup', (c) => c.json(cleanup(true)))
    r.post('/cleanup', (c) => c.json(cleanup(false)))

    // Photo quality for new photos, and compressing the existing ones (server-wide).
    const quality = photoQuality(db)
    const compressor = photoCompressor(db, dataDir)
    const lastBackup = () => readBackupStatus(dataDir).lastSuccessAt
    const backupFresh = () => {
      const at = lastBackup()
      return at !== null && Date.now() - at <= BACKUP_WITHIN_MS
    }
    const photosState = async (): Promise<AdminPhotos> => ({
      quality: quality.get(),
      candidates: await compressor.candidates(),
      lastBackupAt: lastBackup(),
      backupFresh: backupFresh(),
      job: compressor.status(),
    })
    r.get('/photos', async (c) => c.json(await photosState()))
    r.put('/photos', async (c) => {
      const body = await parseBody(c, UpdatePhotoQualitySchema)
      if (!body) return badRequest(c)
      quality.set(body.quality)
      return c.json(await photosState())
    })
    r.post('/photos/compress', async (c) => {
      // Only under the compressed setting, or new uploads would keep originals the job just
      // replaced; and only with a fresh backup, since the old files are deleted.
      if (quality.get() !== 'compressed') return c.json({ error: 'quality_original' }, 409)
      if (!backupFresh()) return c.json({ error: 'backup_needed' }, 409)
      if (!compressor.start()) return c.json({ error: 'running' }, 409)
      return c.json(await photosState(), 202)
    })
  }

  return r
}
