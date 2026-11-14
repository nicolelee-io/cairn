import type { Page } from '@playwright/test'
import { expect, test } from './helpers/test.ts'

// The trash. Phone and desktop share one account and run side by side, so every test only touches
// its own uniquely named items, and Empty trash (which would take the other run's too) is left to
// the unit tests.

/** Opens an item's menu from its ⋮ button (the same at every width). */
async function itemMenu(page: Page, name: string) {
  await page.getByRole('button', { name: `More actions for ${name}` }).click()
}

/** Restore is a button on the row from 600px, and in the row's menu below that. */
async function restoreItem(page: Page, name: string) {
  const button = page
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Restore', exact: true })
  if (await button.isVisible()) return button.click()
  await itemMenu(page, name)
  await page.getByRole('menuitem', { name: 'Restore' }).click()
}

test('read a deleted entry, then restore it from its page', async ({ page, api, journal }) => {
  const title = `Readable ${journal.name}`
  const { entry } = await api.createEntry({
    journalId: journal.id,
    bodyMd: `${title}\n\nThe walrus wrote this.`,
  })
  await api.deleteEntry(entry.id)

  await page.goto('/trash')
  await page.getByRole('link', { name: new RegExp(title) }).click()
  await expect(page).toHaveURL(`/trash/${entry.id}`)
  await expect(page.getByText('The walrus wrote this.')).toBeVisible()
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/entry/${entry.id}$`))
  await expect(
    page.getByRole('region', { name: 'Entry' }).getByText('The walrus wrote this.'),
  ).toBeVisible()
})

test('restore a deleted entry from the trash', async ({ page, api, journal }) => {
  const title = `Trashed ${journal.name}`
  const { entry } = await api.createEntry({ journalId: journal.id, bodyMd: title })
  await api.deleteEntry(entry.id)

  await page.goto('/trash')
  await expect(page.getByRole('heading', { name: 'Trash' })).toBeVisible()
  await expect(page.getByText(title)).toBeVisible()
  await restoreItem(page, title)
  await expect(page.getByRole('status')).toContainText('Entry restored')
  await expect(page.getByText(title)).toBeHidden()
  expect(await api.timelineTitles(journal.id)).toEqual([title])
})

test('restore a deleted journal with its entries', async ({ page, api, journal }) => {
  await api.createEntry({ journalId: journal.id, bodyMd: `In ${journal.name}` })
  await api.deleteJournal(journal.id)

  await page.goto('/journals')
  await page.getByRole('link', { name: /^Trash/ }).click()
  await expect(page.getByText(journal.name, { exact: true })).toBeVisible()
  await restoreItem(page, journal.name)
  await expect(page.getByRole('status')).toContainText(`${journal.name} restored`)
  expect((await api.listJournals()).find((j) => j.id === journal.id)?.entryCount).toBe(1)
})

test('delete an entry forever after confirming', async ({ page, api, journal }) => {
  const title = `Forever ${journal.name}`
  const { entry } = await api.createEntry({ journalId: journal.id, bodyMd: title })
  await api.deleteEntry(entry.id)

  await page.goto('/trash')
  await itemMenu(page, title)
  await page.getByRole('menuitem', { name: 'Delete forever…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete this entry forever?' })
  await confirm.getByRole('button', { name: 'Delete forever' }).click()
  // The list row, not any text: the menu sheet still shows the title while it slides away, and a
  // locator matching two elements is a strict-mode error, not something Playwright retries.
  await expect(page.getByRole('listitem').filter({ hasText: title })).toHaveCount(0)
  expect(await api.restoreEntryStatus(entry.id)).toBe(404)
})
