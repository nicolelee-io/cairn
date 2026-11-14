import { expect, test } from './helpers/test.ts'
import { openNav } from './helpers/ui.ts'
import { goOffline, goOnline, serverUnreachable } from './helpers/offline.ts'

test('create a journal; it shows in the nav', async ({ page, api }, info) => {
  const name = `Created ${info.project.name} ${Date.now() % 100000}`
  await page.goto('/journals')
  await page.getByRole('main').getByRole('button', { name: 'New journal' }).click()
  const dialog = page.getByRole('dialog', { name: 'New journal' })
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByRole('button', { name: `Edit ${name}` })).toBeVisible()
  // Manage journals shows a back arrow where the menu button would be, so open the menu elsewhere.
  await page.goto('/search')
  const nav = await openNav(page)
  await expect(nav.getByRole('link', { name })).toBeVisible()
  expect((await api.listJournals()).some((j) => j.name === name)).toBe(true)
})

test('the nav + creates a journal over the page you are on', async ({ page, api }, info) => {
  const name = `Plus ${info.project.name} ${Date.now() % 100000}`
  // The nav shows its Journals label and + only once the account has a journal.
  await api.createJournal({ name: `Has one ${name}` })
  await page.goto('/search')
  const nav = await openNav(page)
  await nav.getByRole('button', { name: 'New journal' }).click()
  const dialog = page.getByRole('dialog', { name: 'New journal' })
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/search/)
  expect((await api.listJournals()).some((j) => j.name === name)).toBe(true)
})

test('rename and recolor a journal', async ({ page, api, journal }) => {
  const renamed = `${journal.name} renamed`
  await page.goto('/journals')
  await page.getByRole('button', { name: `Edit ${journal.name}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit journal' })
  await dialog.getByRole('textbox', { name: 'Name' }).fill(renamed)
  await dialog.getByRole('button', { name: 'Choose icon' }).click()
  await dialog.getByRole('button', { name: 'Icon local florist' }).click()
  await dialog.getByRole('button', { name: 'Color #328086' }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('button', { name: `Edit ${renamed}` })).toBeVisible()
  const saved = (await api.listJournals()).find((j) => j.id === journal.id)
  expect(saved).toMatchObject({ name: renamed, color: '#328086', icon: 'local_florist' })
})

test('closing the journal dialog with unsaved edits asks first', async ({ page, api, journal }) => {
  await page.goto('/journals')
  await page.getByRole('button', { name: `Edit ${journal.name}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit journal' })
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Not saved')

  await page.keyboard.press('Escape')
  const ask = page.getByRole('dialog', { name: 'Discard changes?' })
  await ask.getByRole('button', { name: 'Keep editing' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Not saved')

  await page.keyboard.press('Escape')
  await ask.getByRole('button', { name: 'Discard' }).click()
  await expect(dialog).toBeHidden()
  expect((await api.listJournals()).find((j) => j.id === journal.id)?.name).toBe(journal.name)
})

test('archiving takes a journal out of the nav', async ({ page, api, journal }) => {
  await page.goto('/search')
  const nav = await openNav(page)
  await expect(nav.getByRole('link', { name: journal.name })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('/journals')

  await page.getByRole('button', { name: `Edit ${journal.name}` }).click()
  await page
    .getByRole('dialog', { name: 'Edit journal' })
    .getByRole('button', { name: 'Archive' })
    .click()

  await expect
    .poll(async () => (await api.listJournals()).find((j) => j.id === journal.id)?.archivedAt)
    .toBeTruthy()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'All Entries' })).toBeVisible()
  const navAfter = await openNav(page)
  await expect(navAfter.getByRole('link', { name: 'Manage journals' })).toBeVisible()
  await expect(navAfter.getByRole('link', { name: journal.name })).toBeHidden()
})

test('delete a journal (to the trash) after confirming', async ({ page, api, journal }) => {
  await page.goto('/journals')
  await page.getByRole('button', { name: `Edit ${journal.name}` }).click()
  await page
    .getByRole('dialog', { name: 'Edit journal' })
    .getByRole('button', { name: 'Delete…' })
    .click()

  const confirm = page.getByRole('dialog', { name: `Delete “${journal.name}”?` })
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()

  await expect(page.getByRole('button', { name: `Edit ${journal.name}` })).toBeHidden()
  await expect(page.getByRole('status')).toContainText('Journal moved to Trash')
  expect((await api.listJournals()).some((j) => j.id === journal.id)).toBe(false)
})

test('reorder journals with the keyboard and by dragging', async ({ page, api }, info) => {
  // A reorder saves the whole list, so two of these running at once (phone and desktop share one
  // account) would undo each other's moves. Pointer events are the same at both widths.
  test.skip(info.project.name === 'phone', 'shares the account with the desktop run')
  const tag = `${Math.random().toString(36).slice(2, 7)}`
  const [a, b, c, d] = [
    await api.createJournal({ name: `A ${tag}` }),
    await api.createJournal({ name: `B ${tag}` }),
    await api.createJournal({ name: `C ${tag}` }),
    await api.createJournal({ name: `D ${tag}` }),
  ] as const
  const ids = [a.id, b.id, c.id, d.id]
  const mine = async () =>
    (await api.listJournals()).filter((j) => ids.includes(j.id)).map((j) => j.name[0])
  const grip = (j: { name: string }) => page.getByRole('button', { name: `Reorder ${j.name}` })

  await page.goto('/journals')
  // Keyboard: two presses in a row (focus must survive the first), saved after a pause.
  await grip(a).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect.poll(mine).toEqual(['B', 'C', 'A', 'D'])

  // Pointer (mouse, and the same events a finger sends): drag D up past two rows in one go.
  // The shared account has many journals by now, so these rows can sit below the fold, and
  // `page.mouse` takes viewport coordinates: scroll first, then measure both rows.
  await grip(d).scrollIntoViewIfNeeded()
  const from = (await grip(d).boundingBox())!
  const target = (await page.getByRole('button', { name: `Edit ${c.name}` }).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 10, target.y + 2, { steps: 12 })
  await page.mouse.up()
  await expect.poll(mine).toEqual(['B', 'D', 'C', 'A'])

  await page.reload()
  await expect(page.getByRole('button', { name: /^Edit [ABCD] / }).first()).toContainText('B ')
})

test('offline, the journal dialog works as usual', async ({ page, context, journal }) => {
  await page.goto('/journals')
  const newJournal = page.getByRole('main').getByRole('button', { name: 'New journal' })
  await expect(newJournal).toBeEnabled()

  await goOffline(context)
  expect(await serverUnreachable(page)).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  // Creating, editing, archiving, reordering and deleting wait in the outbox (offline-journals.spec.ts).
  await expect(newJournal).toBeEnabled()

  await page.getByRole('button', { name: `Edit ${journal.name}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit journal' })
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Archive' })).toBeEnabled()
  // Deleting waits in the outbox too (offline-deletes.spec.ts).
  await expect(dialog.getByRole('button', { name: 'Delete…' })).toBeEnabled()
  await expect(
    dialog.getByRole('switch', { name: `Keep ${journal.name} on this device` }),
  ).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  await goOnline(context)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(newJournal).toBeEnabled()
})
