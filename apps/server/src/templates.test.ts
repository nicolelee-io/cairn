import { beforeAll, describe, expect, it } from 'vitest'
import {
  MAX_USER_TEMPLATES,
  TEMPLATE_BODY_MAX_LENGTH,
  TEMPLATE_NAME_MAX_LENGTH,
} from '@cairn/shared'
import { createApp } from './app.ts'
import { createRepos } from './repo/index.ts'
import { TemplateLimitError } from './repo/templates.ts'
import { addUser, memoryDb } from './test-helpers.ts'

const HOST = 'cairn.test'
let db: ReturnType<typeof memoryDb>['db']
let app: ReturnType<typeof createApp>
let a: ReturnType<typeof createRepos>
let b: ReturnType<typeof createRepos>

beforeAll(async () => {
  db = memoryDb().db
  app = createApp({ sha: 'x', db, trustProxy: () => true })
  const [ua, ub] = [await addUser(db, 'a'), await addUser(db, 'b')]
  a = createRepos(db, ua.id)
  b = createRepos(db, ub.id)
})

describe('user scoping', () => {
  it("B cannot list, edit or delete A's templates", () => {
    const mine = a.templates.create({ name: 'A private', bodyMd: '# A secret\n\nBody' })
    expect(b.templates.list()).toEqual([])
    expect(b.templates.update(mine.id, { name: 'pwned' })).toBeUndefined()
    expect(b.templates.update(mine.id, { bodyMd: 'pwned' })).toBeUndefined()
    expect(b.templates.remove(mine.id)).toBe(false)
    expect(a.templates.list().map((t) => [t.name, t.bodyMd])).toEqual([
      ['A private', '# A secret\n\nBody'],
    ])
    expect(a.templates.remove(mine.id)).toBe(true)
  })

  it('counts the cap per user, not across users', () => {
    for (let i = 0; i < MAX_USER_TEMPLATES; i++) a.templates.create({ name: `t${i}`, bodyMd: 'x' })
    expect(() => a.templates.create({ name: 'one more', bodyMd: 'x' })).toThrow(TemplateLimitError)
    expect(() => b.templates.create({ name: 'mine', bodyMd: 'x' })).not.toThrow()
    for (const t of a.templates.list()) a.templates.remove(t.id)
    for (const t of b.templates.list()) b.templates.remove(t.id)
  })
})

describe('repo', () => {
  it('lists by name ignoring case, then oldest first', () => {
    a.templates.create({ name: 'banana', bodyMd: '1' }, 1000)
    a.templates.create({ name: 'Apple', bodyMd: '2' }, 2000)
    a.templates.create({ name: 'apple', bodyMd: '3' }, 1500)
    expect(a.templates.list().map((t) => t.bodyMd)).toEqual(['3', '2', '1'])
    for (const t of a.templates.list()) a.templates.remove(t.id)
  })

  it('updates the fields given and stamps updatedAt only', () => {
    const t = a.templates.create({ name: 'Daily', bodyMd: 'Old' }, 1000)
    const renamed = a.templates.update(t.id, { name: 'Daily log' }, 5000)!
    expect([renamed.name, renamed.bodyMd, renamed.createdAt, renamed.updatedAt]).toEqual([
      'Daily log',
      'Old',
      1000,
      5000,
    ])
    expect(a.templates.update(t.id, { bodyMd: 'New\n' }, 6000)!.bodyMd).toBe('New\n')
    expect(a.templates.update('nope', { name: 'x' })).toBeUndefined()
    a.templates.remove(t.id)
  })
})

describe('routes', () => {
  type Client = (method: string, path: string, body?: unknown) => Response | Promise<Response>
  let admin: Client
  let user: Client

  async function signIn(username: string): Promise<Client> {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { host: HOST, 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.8' },
      body: JSON.stringify({ username, password: 'pw' }),
    })
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!
    return (method, path, body) =>
      app.request(path, {
        method,
        headers: {
          host: HOST,
          cookie,
          'content-type': 'application/json',
          'x-forwarded-for': '10.0.0.8',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
  }

  beforeAll(async () => {
    await addUser(db, 'boss', 'pw', 'admin')
    admin = await signIn('boss')
    user = await signIn('a')
  })

  it('needs a session', async () => {
    const res = await app.request('/api/templates', { headers: { host: HOST } })
    expect(res.status).toBe(401)
  })

  it('a user adds, lists, edits and deletes their own, and an admin gets no route to them', async () => {
    const made = await user('POST', '/api/templates', {
      name: '  Daily log  ',
      bodyMd: '# {{weekday}}\n\n',
    })
    expect(made.status).toBe(201)
    const t = (await made.json()) as { id: string; name: string; bodyMd: string }
    // The name is trimmed; the body is kept exactly (its trailing blank line matters).
    expect([t.name, t.bodyMd]).toEqual(['Daily log', '# {{weekday}}\n\n'])
    // The response carries the template's own fields only, no user id.
    expect(Object.keys(t).sort()).toEqual(['bodyMd', 'createdAt', 'id', 'name', 'updatedAt'])

    const list = (await (await user('GET', '/api/templates')).json()) as {
      templates: { id: string }[]
    }
    expect(list.templates.map((x) => x.id)).toEqual([t.id])

    // An admin is another user here: empty list, and every write to the id is a 404.
    const adminList = (await (await admin('GET', '/api/templates')).json()) as {
      templates: unknown[]
    }
    expect(adminList.templates).toEqual([])
    expect((await admin('PATCH', `/api/templates/${t.id}`, { name: 'pwned' })).status).toBe(404)
    expect((await admin('DELETE', `/api/templates/${t.id}`)).status).toBe(404)

    const patched = await user('PATCH', `/api/templates/${t.id}`, { bodyMd: 'Changed' })
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { bodyMd: string }).bodyMd).toBe('Changed')
    expect((await user('PATCH', '/api/templates/nope', { name: 'x' })).status).toBe(404)
    expect((await user('DELETE', `/api/templates/${t.id}`)).status).toBe(204)
    expect((await user('DELETE', `/api/templates/${t.id}`)).status).toBe(404)
  })

  it('refuses a blank, oversized or empty request', async () => {
    const bad: unknown[] = [
      {},
      { name: '', bodyMd: 'x' },
      { name: '   ', bodyMd: 'x' },
      { name: 'x', bodyMd: '' },
      { name: 'x', bodyMd: '  \n ' },
      { name: 'x'.repeat(TEMPLATE_NAME_MAX_LENGTH + 1), bodyMd: 'x' },
      { name: 'x', bodyMd: 'x'.repeat(TEMPLATE_BODY_MAX_LENGTH + 1) },
    ]
    for (const body of bad) expect((await user('POST', '/api/templates', body)).status).toBe(400)
    const ok = (await (
      await user('POST', '/api/templates', {
        name: 'x'.repeat(TEMPLATE_NAME_MAX_LENGTH),
        bodyMd: 'x'.repeat(TEMPLATE_BODY_MAX_LENGTH),
      })
    ).json()) as { id: string }
    expect((await user('PATCH', `/api/templates/${ok.id}`, {})).status).toBe(400)
    expect((await user('PATCH', `/api/templates/${ok.id}`, { bodyMd: ' ' })).status).toBe(400)
    await user('DELETE', `/api/templates/${ok.id}`)
  })

  it('answers 409 limit_reached over the cap', async () => {
    for (let i = 0; i < MAX_USER_TEMPLATES; i++)
      expect((await user('POST', '/api/templates', { name: `n${i}`, bodyMd: 'x' })).status).toBe(
        201,
      )
    const over = await user('POST', '/api/templates', { name: 'over', bodyMd: 'x' })
    expect(over.status).toBe(409)
    expect(((await over.json()) as { error: string }).error).toBe('limit_reached')
    // The cap is per user: the admin is unaffected.
    expect((await admin('POST', '/api/templates', { name: 'mine', bodyMd: 'x' })).status).toBe(201)
  })
})
