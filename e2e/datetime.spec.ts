import type { Page } from '@playwright/test'
import { expect, test } from './helpers/test.ts'
import { entriesPane, entryPane } from './helpers/ui.ts'

const DENVER = 'America/Denver'
// Noon in Denver on a day in 2026 (MDT, UTC-6, for the April dates used here).
const denverNoon = (month: number, day: number) => Date.UTC(2026, month - 1, day, 18)

async function openDateDialog(page: Page) {
  await entryPane(page)
    .getByRole('button', { name: /2026 ·/ })
    .click()
  return page.getByRole('dialog', { name: 'Date and time' })
}

test('changing the date moves the entry in the list', async ({ page, api, journal }) => {
  const { entry } = await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Moving day',
    createdAt: denverNoon(4, 10),
    timezone: DENVER,
  })
  await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Staying put',
    createdAt: denverNoon(4, 20),
    timezone: DENVER,
  })
  // Card titles, top to bottom.
  const order = () =>
    entriesPane(page)
      .getByRole('link', { name: /Moving day|Staying put/ })
      .evaluateAll((cards) => cards.map((c) => c.querySelector('p')?.textContent))

  await page.goto(`/j/${journal.id}`)
  await expect.poll(order).toEqual(['Staying put', 'Moving day'])

  await page.goto(`/j/${journal.id}/entry/${entry.id}/edit`)
  const dialog = await openDateDialog(page)
  await dialog.getByRole('button', { name: '2026-04-25' }).click()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(entryPane(page).getByRole('article')).toContainText(/Apr(il)? 25, 2026/)

  await page.goto(`/j/${journal.id}`)
  await expect.poll(order).toEqual(['Moving day', 'Staying put'])
  // Same wall clock, new day.
  expect((await api.getEntry(entry.id)).entry.createdAt).toBe(denverNoon(4, 25))
})

test('changing only the timezone keeps the wall clock', async ({ page, api, journal }) => {
  const { entry } = await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Jet lag',
    createdAt: denverNoon(4, 10),
    timezone: DENVER,
  })
  await page.goto(`/j/${journal.id}/entry/${entry.id}/edit`)
  const dialog = await openDateDialog(page)
  await dialog.getByRole('button', { name: `Timezone ${DENVER}` }).click()
  const zones = page.getByRole('dialog', { name: 'Timezone' })
  await zones.getByRole('searchbox', { name: 'Search timezones' }).fill('Tokyo')
  await zones.getByRole('button', { name: /^Asia\/Tokyo/ }).click()
  await expect(dialog.getByRole('button', { name: 'Timezone Asia/Tokyo' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(entryPane(page).getByRole('article')).toContainText('12:00 PM')
  const saved = (await api.getEntry(entry.id)).entry
  expect(saved.timezone).toBe('Asia/Tokyo')
  // Noon in Tokyo (UTC+9) on 10 April.
  expect(saved.createdAt).toBe(Date.UTC(2026, 3, 10, 3))
})
