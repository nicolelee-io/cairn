import { Hono, type Context } from 'hono'
import {
  CreateEntrySchema,
  UpdateEntrySchema,
  type Attachment,
  type Conflict,
  type Entry,
  type EntryDetail,
  isAutoWeather,
} from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { Db } from '../db/index.ts'
import type { attachments, entries } from '../db/schema.ts'
import {
  IdTakenError,
  JournalArchivedError,
  JournalNotFoundError,
  RevConflictError,
} from '../repo/entries.ts'
import type { GoogleKeys } from '../places/index.ts'
import { WeatherError } from '../weather/google.ts'
import { refreshWeather, refreshWeatherFromCache } from '../weather/service.ts'
import { badRequest, notFound, parseBody, reposFor } from './util.ts'

const toEntry = (e: typeof entries.$inferSelect): Entry => ({
  id: e.id,
  journalId: e.journalId,
  bodyMd: e.bodyMd,
  createdAt: e.createdAt,
  modifiedAt: e.modifiedAt,
  timezone: e.timezone,
  starred: e.starred,
  pinned: e.pinned,
  allDay: e.allDay,
  mood: e.moodKey,
  moodSuggested: e.moodSuggested,
  creationDevice: e.creationDevice,
  source: e.source,
  rev: e.rev,
})

// Explicit field lists: file paths, hashes, source_raw and user ids never leave the server.
type RepoDetail = NonNullable<ReturnType<ReturnType<typeof reposFor>['entries']['detail']>>
export const toDetail = (d: RepoDetail): EntryDetail => ({
  entry: toEntry(d.entry),
  location: d.location && {
    latitude: d.location.latitude,
    longitude: d.location.longitude,
    placeName: d.location.placeName,
    locality: d.location.locality,
    region: d.location.region,
    country: d.location.country,
    address: d.location.address,
    googlePlaceId: d.location.googlePlaceId,
  },
  weather: d.weather && {
    condition: d.weather.condition,
    isDay: d.weather.isDay,
    tempC: d.weather.tempC,
    description: d.weather.description,
    pressureMb: d.weather.pressureMb,
    humidityPct: d.weather.humidityPct,
    windKph: d.weather.windKph,
    source: d.weather.source,
  },
  tags: d.tags,
  photos: d.photos.map((p) => ({
    id: p.id,
    position: p.position,
    width: p.width,
    height: p.height,
    takenAt: p.takenAt,
    latitude: p.latitude,
    longitude: p.longitude,
  })),
  attachments: d.attachments.map(toAttachment),
})

export const toAttachment = (a: typeof attachments.$inferSelect): Attachment => ({
  id: a.id,
  kind: a.kind,
  position: a.position,
  filename: a.filename,
  mime: a.mime,
  bytes: a.bytes,
})

const MAX_PAGE = 100

export function entryRoutes(db: Db, keys: GoogleKeys) {
  const r = new Hono<AuthEnv>()

  // After any save that leaves an entry with a place and no weather. That covers a new place, a
  // changed time, a weather removed for "automatic", and entries whose place predates weather.
  // When the editor's preview already asked the provider (its answer is cached), the weather is
  // stored right here and true comes back, so the response carries it and the reader opens with
  // it. Otherwise it is fetched in the background, never awaited by the response, and a failure
  // just leaves the entry without weather. Out-of-range entries cost nothing (no request).
  const autoWeather = (userId: string, entryId: string): boolean => {
    const provider = keys.weather()
    try {
      const outcome = refreshWeatherFromCache(db, provider, userId, entryId)
      if (outcome !== 'miss') return outcome === 'ok'
    } catch (e) {
      console.error('weather failed', e) // fall through to the background fetch
    }
    void refreshWeather(db, provider, userId, entryId).catch((e: unknown) => {
      if (e instanceof WeatherError) console.error(`weather: ${e.message}`)
      else console.error('weather failed', e)
    })
    return false
  }

  const writeError = (c: Context, e: unknown) => {
    if (e instanceof JournalNotFoundError) return c.json({ error: 'journal_not_found' }, 404)
    if (e instanceof JournalArchivedError) return c.json({ error: 'journal_archived' }, 409)
    if (e instanceof IdTakenError) return c.json({ error: 'id_taken' }, 409)
    throw e
  }

  r.get('/', (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), MAX_PAGE)
    try {
      return c.json(
        reposFor(db, c).entries.timeline({
          journalId: c.req.query('journalId') || undefined,
          cursor: c.req.query('cursor') || undefined,
          includeArchived: c.req.query('includeArchived') === 'true',
          tag: c.req.query('tag') || undefined,
          limit,
        }),
      )
    } catch {
      return badRequest(c) // malformed cursor
    }
  })

  r.get('/recent-places', (c) => c.json({ places: reposFor(db, c).entries.recentPlaces() }))

  // Before /:id, which would take "map" for an entry id.
  r.get('/map', (c) =>
    c.json(
      reposFor(db, c).entries.mapPoints({
        journalId: c.req.query('journalId') || undefined,
        includeArchived: c.req.query('includeArchived') === 'true',
      }),
    ),
  )

  r.get('/:id', (c) => {
    const d = reposFor(db, c).entries.detail(c.req.param('id'))
    return d ? c.json(toDetail(d)) : notFound(c)
  })

  r.post('/', async (c) => {
    const body = await parseBody(c, CreateEntrySchema)
    if (!body) return badRequest(c)
    const repos = reposFor(db, c)
    try {
      const e = repos.entries.create(body)
      let detail = repos.entries.detail(e.id)!
      // An explicit `weather: null` means the user removed it before saving.
      if (detail.location && !detail.weather && body.weather !== null) {
        if (autoWeather(c.get('userId'), e.id)) detail = repos.entries.detail(e.id)!
      }
      return c.json(toDetail(detail), 201)
    } catch (e) {
      return writeError(c, e)
    }
  })

  r.patch('/:id', async (c) => {
    const body = await parseBody(c, UpdateEntrySchema)
    if (!body) return badRequest(c)
    const { baseRev, removeMediaIds, removePhotoIds, ...patch } = body
    const repos = reposFor(db, c)
    const id = c.req.param('id')
    try {
      const e = repos.entries.update(id, patch, {
        baseRev,
        removeMediaIds: [...(removeMediaIds ?? []), ...(removePhotoIds ?? [])],
      })
      let detail = e ? repos.entries.detail(id) : undefined
      // A moved place or changed time makes a provider's weather for the old ones wrong.
      const moved = patch.location !== undefined || patch.createdAt !== undefined
      // Weather removed in this same save stays removed (only `auto` asks for a fetch).
      if (
        detail?.location &&
        patch.weather !== null &&
        (!detail.weather || (moved && isAutoWeather(detail.weather.source)))
      ) {
        if (autoWeather(c.get('userId'), id)) detail = repos.entries.detail(id)
      }
      return detail ? c.json(toDetail(detail)) : notFound(c)
    } catch (e) {
      if (e instanceof RevConflictError) {
        // Hand back the current version so the client can show both rather than overwrite.
        return c.json<Conflict>(
          { error: 'conflict', current: toDetail(repos.entries.detail(id)!) },
          409,
        )
      }
      return writeError(c, e)
    }
  })

  r.delete('/:id', (c) => {
    try {
      return reposFor(db, c).entries.softDelete(c.req.param('id')) ? c.body(null, 204) : notFound(c)
    } catch (e) {
      return writeError(c, e)
    }
  })

  return r
}
