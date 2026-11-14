import { expect, isPhone, test } from './helpers/test.ts'
import { goOffline, goOnline, serverUnreachable, waitForServiceWorker } from './helpers/offline.ts'
import { entryPane, typeInEditor } from './helpers/ui.ts'
import { newUser } from './helpers/users.ts'

// A user of its own: reordering saves the whole list, and the shared account is shared by every test.

test('journals made, renamed, archived and reordered offline reach the server once back online', async ({
  browser,
  request,
}, info) => {
  const tag = `oj${info.project.name}${Date.now() % 1000000}`
  const { page, context, api } = await newUser(browser, request, tag)
  const second = await api.createJournal({ name: `Second ${tag}` })
  const third = await api.createJournal({ name: `Third ${tag}` })
  const first = (await api.listJournals()).find((j) => j.name === `Journal ${tag}`)!
  const made = `Made offline ${tag}`

  await page.goto('/journals')
  await expect(page.getByRole('button', { name: `Edit ${second.name}` })).toBeVisible()
  await waitForServiceWorker(page)
  await page.reload() // so the worker has the journal list for offline reads
  await expect(page.getByRole('button', { name: `Edit ${second.name}` })).toBeVisible()
  await goOffline(context)
  expect(await serverUnreachable(page)).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))

  // Create.
  await page.getByRole('main').getByRole('button', { name: 'New journal' }).click()
  const create = page.getByRole('dialog', { name: 'New journal' })
  await create.getByRole('textbox', { name: 'Name' }).fill(made)
  await create.getByRole('button', { name: 'Create' }).click()
  await expect(create).toBeHidden()
  await expect(page.getByRole('button', { name: `Edit ${made}` })).toBeVisible()

  // Rename one, archive another.
  await page.getByRole('button', { name: `Edit ${second.name}` }).click()
  const edit = page.getByRole('dialog', { name: 'Edit journal' })
  await edit.getByRole('textbox', { name: 'Name' }).fill(`${second.name} renamed`)
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(edit).toBeHidden()
  await page.getByRole('button', { name: `Edit ${third.name}` }).click()
  await edit.getByRole('button', { name: 'Archive' }).click()
  await expect(edit).toBeHidden()
  // It moves under the folded Archived list.
  await expect(page.getByRole('button', { name: `Edit ${third.name}` })).toBeHidden()
  await page
    .getByRole('main')
    .getByText(/^Archived \(1\)/)
    .click()
  await expect(page.getByRole('button', { name: `Edit ${third.name}` })).toBeVisible()

  // The journal that exists only here can't be kept on the device yet.
  await page.getByRole('button', { name: `Edit ${made}` }).click()
  await expect(edit.getByText('Available once it’s saved to your account')).toBeVisible()
  await expect(edit.getByRole('switch', { name: `Keep ${made} on this device` })).toBeDisabled()
  await edit.getByRole('button', { name: 'Cancel' }).click()

  // Reorder: the new journal goes to the top.
  const grip = page.getByRole('button', { name: `Reorder ${made}` })
  await grip.focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('button', { name: /^Edit / }).first()).toContainText(made)

  // Write an entry in the journal that only exists here.
  await page.getByRole('link', { name: `Open ${made} entries` }).click()
  await page.getByRole('link', { name: 'New entry' }).last().click()
  await typeInEditor(page, '# Into the new journal\n\nWritten before it existed')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(entryPane(page).getByRole('heading', { name: 'Into the new journal' })).toBeVisible()
  if (isPhone(info.project.name)) await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { level: 1, name: made })).toBeVisible()

  expect((await api.listJournals()).map((j) => j.name)).not.toContain(made)

  await goOnline(context)
  // The replay runs in order; the entry written in the new journal is the last thing to land.
  await expect
    .poll(async () => {
      const id = (await api.listJournals()).find((j) => j.name === made)?.id
      return id ? await api.timelineTitles(id) : []
    })
    .toEqual(['Into the new journal'])
  const after = await api.listJournals()
  const byName = (n: string) => after.filter((j) => j.name === n)
  expect(byName(made)).toHaveLength(1) // not duplicated by the replay
  expect(byName(`${second.name} renamed`)).toHaveLength(1)
  expect(after.find((j) => j.id === third.id)!.archivedAt).not.toBeNull()
  const newId = byName(made)[0]!.id
  const active = after.filter((j) => !j.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder)
  expect(active[0]!.id).toBe(newId)
  expect(active.map((j) => j.id)).toContain(first.id)
  await context.close()
})
