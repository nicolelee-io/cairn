import type { ZodType, z } from 'zod'
import { getActiveUser } from './localDb.ts'
import { localRead } from './localRead.ts'
import { clearOfflineData } from './offlineCache.ts'
import { isGatewayDown, reportServer } from './serverStatus.ts'

/**
 * Lays saves still waiting in the outbox over a list that didn't come live from the server
 * (lib/outbox.ts registers it; api.ts can't import that file, which imports this one).
 */
let overlayHook: ((user: string | null, path: string, data: unknown) => Promise<unknown>) | null =
  null
export const setOverlayHook = (fn: typeof overlayHook) => {
  overlayHook = fn
}
const overlay = async (path: string, data: unknown) =>
  overlayHook ? overlayHook(getActiveUser(), path, data) : data

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`)
  }
}

/** The `error` code of an API refusal (`{ error: 'journal_archived' }`), if it is one. */
export const errorCode = (e: unknown): string | undefined =>
  e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined

interface Options<S extends ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Validates the response; the shared Zod schemas are the source of truth for API types. */
  schema?: S
  /** Gives up (as an unreachable server) after this long; for background work that holds a lock. */
  timeoutMs?: number
}

export async function api<S extends ZodType>(
  path: string,
  { method = 'GET', body, schema, timeoutMs }: Options<S> = {},
): Promise<z.infer<S>> {
  // Without a schema the caller takes the response as untyped (e.g. 204 -> null).
  const finish = (data: unknown) => (schema ? schema.parse(data) : data) as z.infer<S>
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    })
  } catch (e) {
    reportServer(true)
    // Nothing answered: the copy kept on this device may be able to (lib/localRead.ts).
    const local = method === 'GET' ? await localRead(getActiveUser(), path, false) : undefined
    if (local !== undefined) return finish(await overlay(path, local))
    throw e
  }
  // The service worker answers from its cache when the network fails and says so in a header, so
  // reading still works offline while the banner still tells the truth.
  reportServer(isGatewayDown(res.status) || res.headers.has('x-cairn-offline'))
  // The service worker had only an older answer: the local copy is fresher where it has one.
  if (method === 'GET' && (res.headers.has('x-cairn-offline') || isGatewayDown(res.status))) {
    const local = await localRead(getActiveUser(), path, res.headers.has('x-cairn-offline'))
    if (local !== undefined) return finish(await overlay(path, local))
  }
  // Cached reads belong to the user whose session just ended.
  if (res.status === 401) void clearOfflineData()
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  // A reply the worker took from its cache is as old as the cache: show waiting saves on it too.
  return finish(
    method === 'GET' && res.headers.has('x-cairn-offline') ? await overlay(path, data) : data,
  )
}
