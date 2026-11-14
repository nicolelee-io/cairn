import { expect, test } from './helpers/test.ts'
import { entriesPane, fab, openNav } from './helpers/ui.ts'

// The right-click menu. Playwright's phone and desktop projects both click with a mouse, so the
// long press and the iOS-only ⋮ button on cards are only checked by hand.

test('an entry card: star, then delete to the trash with Undo', async ({ page, api, journal }) => {
  const keep = await api.createEntry({ journalId: journal.id, bodyMd: 'Keep this one' })
  await api.createEntry({ journalId: journal.id, bodyMd: 'Delete this one' })
  await page.goto(`/j/${journal.id}`)

  const card = (name: string) => entriesPane(page).getByRole('link', { name: new RegExp(name) })
  await card('Keep this one').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Star' }).click()
  await expect.poll(async () => (await api.getEntry(keep.entry.id)).entry.starred).toBe(true)

  await card('Delete this one').click({ button: 'right' })
  expect(await page.getByRole('menuitem').allTextContents()).toContain('Move to journal…')
  // No confirmation: it goes to the trash, and the toast's Undo brings it back.
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(card('Delete this one')).toBeHidden()
  await expect.poll(() => api.timelineTitles(journal.id)).toHaveLength(1)
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click()
  await expect(card('Delete this one')).toBeVisible()
  await expect.poll(() => api.timelineTitles(journal.id)).toHaveLength(2)

  await card('Delete this one').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(card('Delete this one')).toBeHidden()
  await expect.poll(() => api.timelineTitles(journal.id)).toHaveLength(1)
})

test('a journal row: archive from the nav menu', async ({ page, api, journal }) => {
  await page.goto('/search')
  const nav = await openNav(page)
  await nav.getByRole('link', { name: journal.name }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'New entry here' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Archive' }).click()
  await expect
    .poll(async () => (await api.listJournals()).find((j) => j.id === journal.id)?.archivedAt)
    .toBeTruthy()
})

test('Escape closes the menu and the Menu key opens it from a focused card', async ({
  page,
  api,
  journal,
}) => {
  await api.createEntry({ journalId: journal.id, bodyMd: 'Keyboard entry' })
  await page.goto(`/j/${journal.id}`)
  await entriesPane(page)
    .getByRole('link', { name: /Keyboard entry/ })
    .focus()
  await page.keyboard.press('ContextMenu')
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
})

test('the New entry button: right-click offers up to four journals to start in', async ({
  page,
  api,
}) => {
  // The menu needs two active journals; make both here, so the test also passes on its own.
  await api.createJournal({ name: 'FAB menu journal one' })
  await api.createJournal({ name: 'FAB menu journal two' })
  await page.goto('/')
  await fab(page).click({ button: 'right' })
  // Parallel specs add journals too, so only the shape is checked: 2 to 4 rows, and a pick opens
  // the editor in that journal.
  const rows = page.getByRole('menuitem')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeGreaterThanOrEqual(2)
  expect(await rows.count()).toBeLessThanOrEqual(4)
  await rows.last().click()
  await expect(page).toHaveURL(/\/j\/[^/]+\/new$/)
})
