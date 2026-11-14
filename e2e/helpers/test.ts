// The `test` every spec imports: Playwright's, plus `api` (seeding) and `journal` (a fresh journal
// with a unique name). Tests share one user and one database, so each one works inside its own
// journal and never asserts on totals across journals.
import { test as base, expect } from '@playwright/test'
import type { Journal } from '@cairn/shared'
import { Api } from './api.ts'

export const test = base.extend<{ api: Api; journal: Journal }>({
  api: async ({ request }, use) => {
    await use(new Api(request))
  },
  journal: async ({ api }, use, testInfo) => {
    const name = `${testInfo.title.slice(0, 40)} ${testInfo.project.name} ${Date.now() % 100000}`
    await use(await api.createJournal({ name }))
  },
})

export { expect }

/** True in the phone project (single pane, bottom bar, drawer nav). */
export const isPhone = (projectName: string) => projectName === 'phone'
