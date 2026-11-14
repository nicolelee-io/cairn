import { expect, test } from './helpers/test.ts'
import { goOffline, goOnline, serverUnreachable, waitForServiceWorker } from './helpers/offline.ts'
import { entriesPane, openNav } from './helpers/ui.ts'

test('deletes made offline are listed in the Trash, can be undone, and reach the server once back online', async ({
  page,
  context,
  api,
  journal,
}, info) => {
  const tag = `${info.project.name}${Date.now() % 1000000}`
  const doomed = await api.createJournal({ name: `Doomed ${tag}` })
  await api.createEntry({ journalId: doomed.id, bodyMd: `In the doomed one ${tag}` })
  await api.createEntry({ journalId: journal.id, bodyMd: `Keep this ${tag}` })
  const gone = await api.createEntry({ journalId: journal.id, bodyMd: `Delete this ${tag}` })

  await page.goto(`/j/${journal.id}`)
  const card = (name: string) => entriesPane(page).getByRole('link', { name: new RegExp(name) })
  await expect(card(`Delete this ${tag}`)).toBeVisible()
  await waitForServiceWorker(page)
  await page.reload() // so the worker has this list for offline reads
  await expect(card(`Delete this ${tag}`)).toBeVisible()

  await goOffline(context)
  expect(await serverUnreachable(page)).toBe(true)

  // Delete, change your mind, delete again.
  await card(`Delete this ${tag}`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(card(`Delete this ${tag}`)).toBeHidden()
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
  await expect(card(`Delete this ${tag}`)).toBeVisible()
  await card(`Delete this ${tag}`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(card(`Delete this ${tag}`)).toBeHidden()
  await expect(card(`Keep this ${tag}`)).toBeVisible()

  // A whole journal, from its nav menu.
  const nav = await openNav(page)
  await nav.getByRole('link', { name: doomed.name }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete…' }).click()
  await page
    .getByRole('dialog', { name: `Delete “${doomed.name}”?` })
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(page.getByRole('link', { name: doomed.name })).toHaveCount(0)

  // The Trash page lists what is waiting, and Undo takes one back.
  await page.goto('/trash')
  const waiting = page.getByRole('region', { name: 'Waiting to move to Trash' })
  await expect(waiting.getByRole('listitem')).toHaveCount(2)
  await expect(waiting.getByText(doomed.name)).toBeVisible()
  await waiting
    .getByRole('listitem')
    .filter({ hasText: doomed.name })
    .getByRole('button', { name: 'Undo' })
    .click()
  await expect(waiting.getByRole('listitem')).toHaveCount(1)
  await page.getByRole('status').filter({ hasText: 'Journal kept' }).waitFor()

  // Nothing has reached the server yet.
  expect(await api.timelineTitles(journal.id)).toHaveLength(2)
  expect((await api.listJournals()).some((j) => j.id === doomed.id)).toBe(true)

  await goOnline(context)
  // The journal's delete was undone, so only the entry's reaches the server.
  await expect.poll(() => api.timelineTitles(journal.id)).toHaveLength(1)
  expect((await api.listJournals()).some((j) => j.id === doomed.id)).toBe(true)
  // It is in the trash, not purged.
  expect(await api.restoreEntryStatus(gone.entry.id)).toBe(200)
})
