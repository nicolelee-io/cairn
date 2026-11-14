import type { AddressInfo } from 'node:net'
import { serve, type ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shutdownHandler } from './shutdown.ts'

// A real HTTP server with one request we can hold open (/slow) and one that answers at once.
async function start() {
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  const app = new Hono()
    .get('/fast', (c) => c.text('fast'))
    .get('/slow', async (c) => {
      await held
      return c.text('slow')
    })
  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0 }, () => resolve(s))
  })
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { server, url, release }
}

let open: ServerType | undefined
afterEach(() => {
  open?.close()
  open = undefined
})

describe('shutdownHandler', () => {
  it('lets an in-flight request finish, then closes the database and exits 0', async () => {
    const { server, url, release } = await start()
    open = server
    const onClosed = vi.fn()
    const slow = fetch(`${url}/slow`).then((r) => r.text())
    await new Promise((r) => setTimeout(r, 50)) // the request is in
    const exited = new Promise<number>((resolve) => {
      const shutdown = shutdownHandler(server, onClosed, { exit: resolve, forceAfterMs: 5_000 })
      shutdown()
      shutdown() // a second signal changes nothing
    })
    await new Promise((r) => setTimeout(r, 50))
    const dbClosedBeforeRelease = onClosed.mock.calls.length > 0
    release()
    expect(await slow).toBe('slow')
    expect(await exited).toBe(0)
    expect(dbClosedBeforeRelease).toBe(false)
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it('does not wait for idle keep-alive connections', async () => {
    const { server, url } = await start()
    open = server
    // fetch keeps the connection alive after this answer; shutdown must not wait for it to time out.
    expect(await (await fetch(`${url}/fast`)).text()).toBe('fast')
    const t0 = Date.now()
    const code = await new Promise<number>((resolve) =>
      shutdownHandler(server, () => {}, { exit: resolve, forceAfterMs: 5_000 })(),
    )
    expect(code).toBe(0)
    expect(Date.now() - t0).toBeLessThan(1_000)
  })

  it('exits 1 without closing the database when a request is still running at the deadline', async () => {
    const { server, url, release } = await start()
    open = server
    const onClosed = vi.fn()
    void fetch(`${url}/slow`).catch(() => {})
    await new Promise((r) => setTimeout(r, 50))
    const code = await new Promise<number>((resolve) =>
      shutdownHandler(server, onClosed, { exit: resolve, forceAfterMs: 100 })(),
    )
    expect(code).toBe(1)
    expect(onClosed).not.toHaveBeenCalled()
    release()
  })
})
