import { expect, isPhone, test } from './helpers/test.ts'
import { goOffline, goOnline, serverUnreachable } from './helpers/offline.ts'
import { entryPane, fab, typeInEditor } from './helpers/ui.ts'

test('a save made offline waits, then reaches the server once back online', async ({
  page,
  context,
  api,
  journal,
}, info) => {
  await page.goto(`/j/${journal.id}`)
  await expect(page.getByRole('heading', { level: 1, name: journal.name })).toBeVisible()

  await goOffline(context)
  expect(await serverUnreachable(page)).toBe(true)

  // Save closes the editor as if it had worked; the entry opens from the queue.
  await fab(page).click()
  await typeInEditor(page, '# Written on the train\n\nNo signal in the tunnel')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(entryPane(page).getByRole('heading', { name: 'Written on the train' })).toBeVisible()

  if (isPhone(info.project.name)) await page.getByRole('button', { name: 'Back' }).click()
  const status = page.getByRole('link', { name: 'Offline · 1 waiting to sync' })
  await expect(status).toBeVisible()
  expect(await api.timelineTitles(journal.id)).toEqual([])

  // Back online: the queue replays by itself (the `online` event).
  await goOnline(context)
  await expect.poll(() => api.timelineTitles(journal.id)).toEqual(['Written on the train'])
  await expect(status).toBeHidden()
})

test('offline the place dialog says search needs a connection and keeps the coordinates', async ({
  page,
  context,
  journal,
}) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 51.5, longitude: -0.1 })
  await page.goto(`/j/${journal.id}`)
  await expect(page.getByRole('heading', { level: 1, name: journal.name })).toBeVisible()

  await goOffline(context)
  await fab(page).click()
  await typeInEditor(page, 'Somewhere with no signal')
  await page.getByRole('button', { name: 'Add place' }).click()

  await expect(page.getByText('Reconnect to search for places.')).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search for a place' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Use current location' }).click()
  await expect(page.getByText('Can’t look up the address offline.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Save coordinates only' }).click()
  await expect(page.getByRole('button', { name: 'Place: 51.500, -0.100' })).toBeVisible()
})
