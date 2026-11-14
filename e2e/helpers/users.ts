import type { APIRequestContext, Browser } from '@playwright/test'
import { BASE_URL } from '../env.ts'
import { Api } from './api.ts'
import { expect } from './test.ts'

const headers = { Origin: BASE_URL }
const PASSWORD = 'temporary-123'

/**
 * A plain user made by the admin and signed in in their own browser context, with a journal to
 * write into. For tests that change account-wide state (the shared `e2e` user is shared by every
 * test running in parallel) or need a list nobody else adds to. `tag` must be unique.
 */
export async function newUser(browser: Browser, admin: APIRequestContext, tag: string) {
  const username = `${tag}u`
  const created = await admin.post('/api/admin/users', {
    data: { username, displayName: username, password: PASSWORD },
    headers,
  })
  expect(created.status(), await created.text()).toBe(201)
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const login = await context.request.post('/api/auth/login', {
    data: { username, password: PASSWORD },
    headers,
  })
  expect(login.ok()).toBe(true)
  const api = new Api(context.request)
  await api.createJournal({ name: `Journal ${tag}` })
  return { page: await context.newPage(), request: context.request, api, context }
}
