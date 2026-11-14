import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { memoryDb } from './test-helpers.ts'

let root: string
let app: ReturnType<typeof createApp>

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'cairn-static-'))
  const webDist = join(root, 'web')
  mkdirSync(join(webDist, 'assets'), { recursive: true })
  writeFileSync(join(webDist, 'index.html'), '<title>Cairn SPA</title>')
  writeFileSync(join(webDist, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(root, 'secret.txt'), 'TOP-SECRET')
  app = createApp({ sha: 'x', db: memoryDb().db, webDist })
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('serving the built SPA', () => {
  it('serves index.html at / and for client-side routes', async () => {
    for (const path of ['/', '/journals/abc', '/entry/123']) {
      const res = await app.request(path)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Cairn SPA')
    }
  })

  it('serves real assets with their own content type', async () => {
    const res = await app.request('/assets/app.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/javascript/)
  })

  it('never falls back to HTML for /api: logged-out callers get a JSON 401', async () => {
    const res = await app.request('/api/anything')
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toMatch(/json/)
  })

  it('does not serve files outside the web root', async () => {
    for (const path of [
      '/../secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e/secret.txt',
      '/assets/../../secret.txt',
    ]) {
      const res = await app.request(path)
      expect(await res.text()).not.toContain('TOP-SECRET')
    }
  })
})
