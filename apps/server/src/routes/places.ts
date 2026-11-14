import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { SetGoogleKeySchema } from '@cairn/shared'
import type { AuthEnv } from '../auth/middleware.ts'
import type { GoogleKeys } from '../places/index.ts'
import { PlacesError, type PlacesProvider } from '../places/provider.ts'
import { badRequest, notFound, parseBody } from './util.ts'

const Coord = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
})
const Search = z.object({
  q: z.string().trim().min(1).max(200),
  session: z.string().max(100).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
})
const Details = z.object({
  id: z.string().min(1).max(300),
  session: z.string().max(100).optional(),
})

/**
 * A proxy to the place provider, so the key stays on the server, plus the key's own settings.
 * Needs a session like the rest of /api.
 */
export function placeRoutes(keys: GoogleKeys) {
  const r = new Hono<AuthEnv>()

  // The key belongs to the instance, not a user; there is only one user to set it.
  r.get('/key', (c) => c.json(keys.status()))
  r.put('/key', async (c) => {
    const body = await parseBody(c, SetGoogleKeySchema)
    if (!body) return badRequest(c)
    keys.set(body.key)
    return c.json(keys.status())
  })
  r.delete('/key', (c) => {
    keys.clear()
    return c.json(keys.status())
  })

  // No key: say so, so the UI can point at Settings instead of failing on every try.
  const lookup = async (c: Context, run: (p: PlacesProvider) => Promise<object | null>) => {
    const places = keys.provider()
    if (!places) return c.json({ error: 'places_unavailable' }, 424)
    try {
      const out = await run(places)
      return out === null ? notFound(c) : c.json(out)
    } catch (e) {
      if (e instanceof PlacesError) {
        console.error(`places: ${e.message}`) // the key is never part of the message
        return c.json({ error: 'places_failed' }, 424)
      }
      throw e
    }
  }

  r.get('/search', (c) => {
    const q = Search.safeParse(c.req.query())
    if (!q.success) return badRequest(c)
    const { q: text, session, lat, lng } = q.data
    const bias =
      lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : undefined
    return lookup(c, async (p) => ({ suggestions: await p.search(text, bias, session) }))
  })

  r.get('/details', (c) => {
    const q = Details.safeParse(c.req.query())
    if (!q.success) return badRequest(c)
    return lookup(c, (p) => p.details(q.data.id, q.data.session))
  })

  r.get('/reverse', (c) => {
    const q = Coord.safeParse(c.req.query())
    if (!q.success) return badRequest(c)
    return lookup(c, (p) => p.reverse(q.data.lat, q.data.lng))
  })

  return r
}
