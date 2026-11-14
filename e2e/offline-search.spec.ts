import { expect, test } from './helpers/test.ts'
import { goOffline, serverUnreachable, waitForServiceWorker } from './helpers/offline.ts'
import { entriesPane, entryPane } from './helpers/ui.ts'

// Other tests write to the same database, so the word searched for is unique to this test.
const unique = () => `zq${Math.random().toString(36).slice(2, 8)}`

test('offline, search finds entries in the journals kept on the device, and the reader highlights them', async ({
  page,
  context,
  api,
  journal,
}) => {
  const word = unique()
  await api.createEntry({
    journalId: journal.id,
    bodyMd: `# Kept and searchable\n\nA ${word} on the ridge`,
  })
  await api.createEntry({ journalId: journal.id, bodyMd: '# Unrelated\n\nNothing to see' })

  await page.goto('/sync')
  await waitForServiceWorker(page)
  await page.getByRole('switch', { name: `Keep ${journal.name} on this device` }).click()
  await expect(page.getByRole('listitem').filter({ hasText: journal.name })).toContainText(
    '2 entries on this device',
  )
  // The worker needs the current app shell to load /search with no server.
  await page.goto(`/j/${journal.id}`)
  await expect(entriesPane(page).getByRole('link', { name: /Unrelated/ })).toBeVisible()

  await page.goto('/search')
  await expect(page.getByRole('button', { name: 'Sort' })).toBeVisible()

  await goOffline(context)
  expect(await serverUnreachable(page)).toBe(true)

  await page.goto('/search')
  await page.getByRole('searchbox', { name: 'Search entries' }).fill(word)
  const results = page.getByRole('list', { name: 'Results' }).getByRole('listitem')
  await expect(results).toHaveCount(1)
  await expect(results.locator('mark')).toHaveText(word)
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'You’re offline. Searching only the 1 journal kept on this device' }),
  ).toBeVisible()
  // Offline results are always newest first, so there is nothing to choose.
  await expect(page.getByRole('button', { name: 'Sort' })).toHaveCount(0)

  await results.getByRole('link').click()
  await expect(entryPane(page).getByRole('heading', { name: 'Kept and searchable' })).toBeVisible()
  await expect(entryPane(page).locator('mark')).toHaveText(word)
})

test('offline with nothing kept, search says it needs a connection', async ({ page, context }) => {
  await page.goto('/search')
  await waitForServiceWorker(page)
  await page.reload()
  await goOffline(context)
  expect(await serverUnreachable(page)).toBe(true)
  await page.getByRole('searchbox', { name: 'Search entries' }).fill(unique())
  await expect(page.getByText(/Search only works on journals kept on this device/)).toBeVisible()
})
