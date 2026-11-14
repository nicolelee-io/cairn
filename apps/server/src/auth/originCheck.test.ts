import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { originCheck } from './middleware.ts'

const app = new Hono()
app.use('*', originCheck)
app.all('/x', (c) => c.text('ok'))

const call = (method: string, headers: Record<string, string> = {}) =>
  app.request('http://cairn.test/x', { method, headers: { host: 'cairn.test', ...headers } })

describe('originCheck', () => {
  it('lets reads through whatever the Origin says', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS'])
      expect((await call(method, { origin: 'https://evil.test' })).status).toBe(200)
  })

  it('allows a write from its own host, and one with no Origin', async () => {
    expect((await call('POST', { origin: 'http://cairn.test' })).status).toBe(200)
    expect((await call('POST')).status).toBe(200)
    expect((await call('POST', { 'sec-fetch-site': 'same-origin' })).status).toBe(200)
  })

  it('refuses a write from another host, port or an unparseable Origin', async () => {
    for (const origin of ['https://evil.test', 'http://cairn.test:8080', 'null', 'not a url'])
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'])
        expect((await call(method, { origin })).status, `${method} ${origin}`).toBe(403)
  })

  it('refuses a write with no Origin that the browser says is cross-site', async () => {
    const res = await call('POST', { 'sec-fetch-site': 'cross-site' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'bad_origin' })
  })
})
