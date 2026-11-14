import { expect, test } from './helpers/test.ts'
import { goOffline, serverUnreachable, waitForServiceWorker } from './helpers/offline.ts'
import { entriesPane, entryPane } from './helpers/ui.ts'

test('a journal kept on the device reads offline, mid-session and after a reload', async ({
  page,
  context,
  api,
  journal,
}) => {
  const { entry } = await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Kept for the plane\n\nRead somewhere over the ocean',
  })
  await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Not opened yet\n\nOnly the local copy has this',
  })

  await page.goto('/sync')
  await waitForServiceWorker(page)
  await page.getByRole('switch', { name: `Keep ${journal.name} on this device` }).click()
  const row = page.getByRole('listitem').filter({ hasText: journal.name })
  await expect(row).toContainText('2 entries on this device')

  // Load the app once more online, so the worker holds the current app shell.
  await page.goto(`/j/${journal.id}`)
  await expect(entriesPane(page).getByRole('link', { name: /Not opened yet/ })).toBeVisible()

  await goOffline(context)
  expect(await serverUnreachable(page)).toBe(true)

  // Mid-session (the browser has said it is offline): an entry never opened before comes from
  // the local copy.
  await entriesPane(page)
    .getByRole('link', { name: /Not opened yet/ })
    .click()
  await expect(entryPane(page).getByRole('article')).toContainText('Only the local copy has this')

  // A full reload with no server: the worker serves the shell, the local copy the entry.
  await page.goto(`/j/${journal.id}/entry/${entry.id}`)
  const reader = entryPane(page).getByRole('article')
  await expect(reader.getByRole('heading', { name: 'Kept for the plane' })).toBeVisible()
  await expect(reader).toContainText('Read somewhere over the ocean')

  await page.goto(`/j/${journal.id}`)
  await expect(entriesPane(page).getByRole('link', { name: /Kept for the plane/ })).toBeVisible()
})
