import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_PROMPT_CATEGORIES, MAX_USER_PROMPTS, type PromptImportFile } from '@cairn/shared'
import { createApp } from './app.ts'
import { createRepos } from './repo/index.ts'
import {
  CategoryExistsError,
  CategoryNotFoundError,
  PromptLimitError,
  promptCategoryRepo,
  suggestedPromptRepo,
} from './repo/prompts.ts'
import { addUser, memoryDb } from './test-helpers.ts'

const HOST = 'cairn.test'
let db: ReturnType<typeof memoryDb>['db']
let app: ReturnType<typeof createApp>
let a: ReturnType<typeof createRepos>
let b: ReturnType<typeof createRepos>
let categories: ReturnType<typeof promptCategoryRepo>
let suggested: ReturnType<typeof suggestedPromptRepo>

beforeAll(async () => {
  db = memoryDb().db
  app = createApp({ sha: 'x', db, trustProxy: () => true })
  const [ua, ub] = [await addUser(db, 'a'), await addUser(db, 'b')]
  a = createRepos(db, ua.id)
  b = createRepos(db, ub.id)
  categories = promptCategoryRepo(db)
  suggested = suggestedPromptRepo(db)
})

describe('user scoping', () => {
  it("B cannot list, edit, delete or save from A's prompts", () => {
    const mine = a.prompts.create({ text: 'A secret question', categoryId: null })
    expect(b.prompts.list()).toEqual([])
    expect(b.prompts.update(mine.id, { text: 'pwned' })).toBeUndefined()
    expect(b.prompts.remove(mine.id)).toBe(false)
    expect(a.prompts.list().map((p) => p.text)).toEqual(['A secret question'])
    // A's own prompts are not "suggested" ones: nothing to save, and the suggested scope can't see them.
    expect(suggested.list()).toEqual([])
    expect(suggested.update(mine.id, { text: 'pwned' })).toBeUndefined()
    expect(suggested.remove(mine.id)).toBe(false)
    expect(b.prompts.saveSuggested({ ids: [mine.id] })).toBe(0)
    expect(b.prompts.list()).toEqual([])
  })

  it('a suggested prompt is not reachable through a user scope', () => {
    const s = suggested.create({ text: 'Suggested one', categoryId: null })
    expect(a.prompts.update(s.id, { text: 'pwned' })).toBeUndefined()
    expect(a.prompts.remove(s.id)).toBe(false)
    expect(suggested.list().find((p) => p.id === s.id)?.text).toBe('Suggested one')
    suggested.remove(s.id)
  })
})

describe('bulk delete', () => {
  it("deletes the caller's own prompts only, and says how many", () => {
    const [m1, m2, m3] = ['m1', 'm2', 'm3'].map((text) =>
      a.prompts.create({ text, categoryId: null }),
    )
    const theirs = b.prompts.create({ text: 'b private', categoryId: null })
    const s = suggested.create({ text: 'bulk suggested', categoryId: null })

    // Another user's id, a suggested id and an unknown id are skipped, not errors.
    expect(a.prompts.removeMany([m1!.id, theirs.id, s.id, 'nope'])).toBe(1)
    expect(b.prompts.list().some((p) => p.id === theirs.id)).toBe(true)
    expect(suggested.list().some((p) => p.id === s.id)).toBe(true)
    expect(a.prompts.removeMany([m2!.id, m3!.id])).toBe(2)
    expect(a.prompts.removeMany([m2!.id])).toBe(0)

    // The suggested scope can't reach a user's prompt either.
    expect(suggested.removeMany([theirs.id])).toBe(0)
    expect(suggested.removeMany([s.id])).toBe(1)
    b.prompts.remove(theirs.id)
  })

  it('leaves saved copies when the suggestion is deleted', () => {
    const s = suggested.create({ text: 'to be pruned', categoryId: null })
    expect(a.prompts.saveSuggested({ ids: [s.id] })).toBe(1)
    expect(suggested.removeMany([s.id])).toBe(1)
    expect(a.prompts.list().some((p) => p.text === 'to be pruned')).toBe(true)
    a.prompts.removeMany(
      a.prompts
        .list()
        .filter((p) => p.text === 'to be pruned')
        .map((p) => p.id),
    )
  })
})

describe('categories', () => {
  it('rejects a name that matches ignoring case, and keeps positions', () => {
    const c1 = categories.create({ name: 'Gratitude', icon: 'favorite' })
    const c2 = categories.create({ name: 'Reflection', icon: 'psychology' })
    expect(c2.position).toBe(c1.position + 1)
    expect(() => categories.create({ name: 'gratitude', icon: 'star' })).toThrow(
      CategoryExistsError,
    )
    expect(() => categories.update(c2.id, { name: 'GRATITUDE' })).toThrow(CategoryExistsError)
    expect(categories.update(c2.id, { name: 'REFLECTION' })?.name).toBe('REFLECTION')
    expect(categories.update('nope', { name: 'x' })).toBeUndefined()
  })

  it('reorders, skipping unknown and duplicate ids', () => {
    const [x, y] = categories.list()
    categories.reorder(['nope', y!.id, y!.id, x!.id])
    expect(categories.list().map((c) => c.id)).toEqual([y!.id, x!.id])
    categories.reorder([x!.id])
    expect(categories.list().map((c) => c.id)).toEqual([x!.id, y!.id])
  })

  it('deleting one leaves its prompts uncategorized', () => {
    const c = categories.create({ name: 'Doomed', icon: 'star' })
    const s = suggested.create({ text: 'Keep me', categoryId: c.id })
    const mine = a.prompts.create({ text: 'Mine too', categoryId: c.id })
    expect(categories.remove(c.id)).toBe(true)
    expect(categories.remove(c.id)).toBe(false)
    expect(suggested.list().find((p) => p.id === s.id)).toMatchObject({
      text: 'Keep me',
      categoryId: null,
    })
    expect(a.prompts.list().find((p) => p.id === mine.id)).toMatchObject({
      text: 'Mine too',
      categoryId: null,
    })
    suggested.remove(s.id)
    a.prompts.remove(mine.id)
  })

  it('refuses an unknown category on a prompt', () => {
    expect(() => a.prompts.create({ text: 'x', categoryId: 'nope' })).toThrow(CategoryNotFoundError)
    expect(() => suggested.create({ text: 'x', categoryId: 'nope' })).toThrow(CategoryNotFoundError)
  })

  it('is capped', async () => {
    const fresh = memoryDb().db
    const repo = promptCategoryRepo(fresh)
    for (let i = 0; i < MAX_PROMPT_CATEGORIES; i++) repo.create({ name: `c${i}`, icon: 'star' })
    expect(() => repo.create({ name: 'one more', icon: 'star' })).toThrow(PromptLimitError)
  })
})

describe('saving suggested prompts', () => {
  it('copies by id or by category, and a repeat is a no-op', () => {
    const cat = categories.create({ name: 'Fun', icon: 'celebration' })
    const s1 = suggested.create({ text: 'Fun one', categoryId: cat.id })
    const s2 = suggested.create({ text: 'Fun two', categoryId: cat.id })
    const s3 = suggested.create({ text: 'Other', categoryId: null })

    expect(b.prompts.saveSuggested({ ids: [s1.id, 'unknown'] })).toBe(1)
    expect(b.prompts.saveSuggested({ ids: [s1.id] })).toBe(0)
    expect(b.prompts.saveSuggested({ categoryId: cat.id })).toBe(1) // only s2 is new
    expect(b.prompts.saveSuggested({ categoryId: cat.id })).toBe(0)
    expect(b.prompts.saveSuggested({ ids: [s3.id] })).toBe(1)

    const copies = b.prompts.list()
    expect(copies.map((p) => p.sourcePromptId).sort()).toEqual([s1.id, s2.id, s3.id].sort())
    expect(copies.find((p) => p.sourcePromptId === s1.id)).toMatchObject({
      text: 'Fun one',
      categoryId: cat.id,
      userId: expect.any(String),
    })
    expect(a.prompts.list().some((p) => p.sourcePromptId)).toBe(false)

    // Deleting a suggestion leaves the copy; deleting the copy lets it be saved again.
    suggested.remove(s1.id)
    expect(b.prompts.list().some((p) => p.text === 'Fun one')).toBe(true)
    const copy = copies.find((p) => p.sourcePromptId === s2.id)!
    b.prompts.remove(copy.id)
    expect(b.prompts.saveSuggested({ ids: [s2.id] })).toBe(1)
  })

  it('stops at the per-user cap and saves nothing', async () => {
    const fresh = memoryDb().db
    const u = await addUser(fresh, 'full')
    const repos = createRepos(fresh, u.id)
    const sug = suggestedPromptRepo(fresh)
    const s = sug.create({ text: 'one more', categoryId: null })
    for (let i = 0; i < MAX_USER_PROMPTS; i++)
      repos.prompts.create({ text: `p${i}`, categoryId: null })
    expect(() => repos.prompts.saveSuggested({ ids: [s.id] })).toThrow(PromptLimitError)
    expect(() => repos.prompts.create({ text: 'x', categoryId: null })).toThrow(PromptLimitError)
    expect(repos.prompts.list()).toHaveLength(MAX_USER_PROMPTS)
  })
})

describe('JSON import', () => {
  const file: PromptImportFile = {
    categories: [
      { name: 'Import A', icon: 'psychology', prompts: ['Imp one', 'Imp two', 'Imp one'] },
      { name: 'Import B', icon: 'not_an_icon', prompts: ['Imp three'] },
      { name: 'import a', prompts: ['Imp four'] }, // the same category, spelled differently
    ],
  }

  it('previews without writing, then merges, and a re-import changes nothing', () => {
    const before = suggested.list().length
    const cats = categories.list().length
    const preview = suggested.importFile(file, { dryRun: true })
    expect(preview).toEqual({
      newCategories: 2,
      newPrompts: 4,
      existingPrompts: 1,
      unknownIcons: 1,
    })
    expect(suggested.list()).toHaveLength(before)
    expect(categories.list()).toHaveLength(cats)

    expect(suggested.importFile(file)).toEqual(preview)
    expect(suggested.list()).toHaveLength(before + 4)
    const byName = new Map(categories.list().map((c) => [c.name, c]))
    expect(byName.get('Import A')?.icon).toBe('psychology')
    expect(byName.get('Import B')?.icon).toBe('edit_note') // unknown icon -> default
    const four = suggested.list().find((p) => p.text === 'Imp four')
    expect(four?.categoryId).toBe(byName.get('Import A')?.id)

    expect(suggested.importFile(file)).toEqual({
      newCategories: 0,
      newPrompts: 0,
      existingPrompts: 5,
      unknownIcons: 0,
    })
    expect(suggested.list()).toHaveLength(before + 4)
  })

  it('keeps the order of the file', () => {
    const texts = suggested.list().map((p) => p.text)
    expect(texts.indexOf('Imp one')).toBeLessThan(texts.indexOf('Imp two'))
    expect(texts.indexOf('Imp two')).toBeLessThan(texts.indexOf('Imp three'))
  })
})

describe('routes', () => {
  type Client = (method: string, path: string, body?: unknown) => Response | Promise<Response>
  let admin: Client
  let user: Client

  async function signIn(username: string): Promise<Client> {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { host: HOST, 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' },
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
          'x-forwarded-for': '10.0.0.9',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
  }

  beforeAll(async () => {
    await addUser(db, 'boss', 'pw', 'admin')
    admin = await signIn('boss')
    user = await signIn('a')
  })

  it('every category and suggested-prompt write is 403 for a plain user; reads are open', async () => {
    const cat = categories.list()[0]!.id
    const sug = suggested.create({ text: 'Gate me', categoryId: null }).id
    const gated: [string, string, unknown?][] = [
      ['POST', '/api/prompts/categories', { name: 'x' }],
      ['PUT', '/api/prompts/categories/order', { ids: [] }],
      ['PATCH', `/api/prompts/categories/${cat}`, { name: 'y' }],
      ['DELETE', `/api/prompts/categories/${cat}`],
      ['POST', '/api/prompts/suggested', { text: 'x' }],
      ['POST', '/api/prompts/suggested/import', { file: { categories: [] } }],
      ['PATCH', `/api/prompts/suggested/${sug}`, { text: 'y' }],
      ['DELETE', `/api/prompts/suggested/${sug}`],
      ['POST', '/api/prompts/suggested/bulk-delete', { ids: [sug] }],
    ]
    for (const [method, path, body] of gated)
      expect([method, path, (await user(method, path, body)).status]).toEqual([method, path, 403])
    expect((await user('GET', '/api/prompts/categories')).status).toBe(200)
    expect((await user('GET', '/api/prompts/suggested')).status).toBe(200)
    expect(categories.list().some((c) => c.id === cat)).toBe(true)
    expect(suggested.list().some((p) => p.id === sug)).toBe(true)
  })

  it('needs a session', async () => {
    const res = await app.request('/api/prompts/suggested', { headers: { host: HOST } })
    expect(res.status).toBe(401)
  })

  it('an admin manages categories and suggested prompts', async () => {
    const made = await admin('POST', '/api/prompts/categories', { name: 'Route cat', icon: 'spa' })
    expect(made.status).toBe(201)
    const cat = (await made.json()) as { id: string; icon: string }
    expect(cat.icon).toBe('spa')
    expect((await admin('POST', '/api/prompts/categories', { name: 'route CAT' })).status).toBe(409)
    expect(
      (await admin('POST', '/api/prompts/categories', { name: 'x', icon: 'bogus' })).status,
    ).toBe(400)

    const p = await admin('POST', '/api/prompts/suggested', {
      text: '  Route prompt  ',
      categoryId: cat.id,
    })
    expect(p.status).toBe(201)
    const created = (await p.json()) as { id: string; text: string }
    expect(created.text).toBe('Route prompt')
    expect(
      (await admin('POST', '/api/prompts/suggested', { text: 'x', categoryId: 'nope' })).status,
    ).toBe(400)
    expect((await admin('POST', '/api/prompts/suggested', { text: 'x'.repeat(201) })).status).toBe(
      400,
    )

    expect(
      (await admin('PATCH', `/api/prompts/suggested/${created.id}`, { text: 'Edited' })).status,
    ).toBe(200)
    expect((await admin('PATCH', '/api/prompts/suggested/nope', { text: 'Edited' })).status).toBe(
      404,
    )
    expect((await admin('DELETE', `/api/prompts/suggested/${created.id}`)).status).toBe(204)
    expect((await admin('DELETE', `/api/prompts/categories/${cat.id}`)).status).toBe(204)
    expect((await admin('DELETE', `/api/prompts/categories/${cat.id}`)).status).toBe(404)
  })

  it('a user manages their own prompts, and an admin gets no route to them', async () => {
    const made = await user('POST', '/api/prompts/mine', { text: 'My own', categoryId: null })
    expect(made.status).toBe(201)
    const mine = (await made.json()) as { id: string }
    // The response carries the user's prompt fields only, no user id.
    expect(Object.keys(mine).sort()).toEqual([
      'categoryId',
      'createdAt',
      'id',
      'sourcePromptId',
      'text',
    ])

    const adminList = (await (await admin('GET', '/api/prompts/mine')).json()) as {
      prompts: unknown[]
    }
    expect(adminList.prompts).toEqual([])
    expect((await admin('PATCH', `/api/prompts/mine/${mine.id}`, { text: 'pwned' })).status).toBe(
      404,
    )
    expect((await admin('DELETE', `/api/prompts/mine/${mine.id}`)).status).toBe(404)

    expect((await user('PATCH', `/api/prompts/mine/${mine.id}`, { text: 'Changed' })).status).toBe(
      200,
    )
    expect((await user('PATCH', `/api/prompts/mine/${mine.id}`, {})).status).toBe(400)
    expect((await user('POST', '/api/prompts/mine/from-suggested', {})).status).toBe(400)
    expect((await user('DELETE', `/api/prompts/mine/${mine.id}`)).status).toBe(204)
  })

  it('bulk delete over the API: own prompts only, a bad body is a 400', async () => {
    const made = (await (await user('POST', '/api/prompts/mine', { text: 'bulk 1' })).json()) as {
      id: string
    }
    const other = (await (await user('POST', '/api/prompts/mine', { text: 'bulk 2' })).json()) as {
      id: string
    }
    // An admin has no route to another user's prompts: nothing is deleted.
    const none = await admin('POST', '/api/prompts/mine/bulk-delete', { ids: [made.id, other.id] })
    expect(await none.json()).toEqual({ deleted: 0 })
    const done = await user('POST', '/api/prompts/mine/bulk-delete', {
      ids: [made.id, other.id, 'nope'],
    })
    expect(await done.json()).toEqual({ deleted: 2 })
    expect((await user('POST', '/api/prompts/mine/bulk-delete', { ids: [] })).status).toBe(400)
    expect((await user('POST', '/api/prompts/mine/bulk-delete', {})).status).toBe(400)

    const s = suggested.create({ text: 'admin bulk', categoryId: null })
    expect(
      await (await admin('POST', '/api/prompts/suggested/bulk-delete', { ids: [s.id] })).json(),
    ).toEqual({
      deleted: 1,
    })
  })

  it('imports a file: preview, merge, and bad shapes', async () => {
    const file = { categories: [{ name: 'Via route', icon: 'star', prompts: ['R one', 'R two'] }] }
    const preview = await admin('POST', '/api/prompts/suggested/import', { file, dryRun: true })
    expect(await preview.json()).toEqual({
      newCategories: 1,
      newPrompts: 2,
      existingPrompts: 0,
      unknownIcons: 0,
    })
    expect(suggested.list().some((p) => p.text === 'R one')).toBe(false)
    expect((await admin('POST', '/api/prompts/suggested/import', { file })).status).toBe(200)
    expect(suggested.list().some((p) => p.text === 'R one')).toBe(true)

    expect(
      (await admin('POST', '/api/prompts/suggested/import', { file: { nope: 1 } })).status,
    ).toBe(400)
    const tooMany = {
      categories: [{ name: 'Big', prompts: Array.from({ length: 501 }, (_, i) => `t${i}`) }],
    }
    expect((await admin('POST', '/api/prompts/suggested/import', { file: tooMany })).status).toBe(
      400,
    )
    const huge = {
      categories: [{ name: 'Huge', prompts: ['x'.repeat(190)] }],
      pad: 'y'.repeat(1_100_000),
    }
    expect((await admin('POST', '/api/prompts/suggested/import', { file: huge })).status).toBe(413)
  })
})
