import { expect, test } from './helpers/test.ts'
import { goOffline, goOnline, serverUnreachable, waitForServiceWorker } from './helpers/offline.ts'
import { entriesPane, entryPane, fab, typeInEditor } from './helpers/ui.ts'

// Tags are account-wide and tests share the account, so every name here is unique to its test.
const word = () => `tag${Math.random().toString(36).slice(2, 8)}`

test('tag an entry, filter the list by it, and edit the tags', async ({ page, api, journal }) => {
  const tag = word()
  const untagged = `Untagged ${word()}`
  const other = await api.createEntry({ journalId: journal.id, bodyMd: untagged })

  await page.goto(`/j/${journal.id}`)
  await fab(page).click()
  await typeInEditor(page, `Tagged day ${tag}`)
  await page.getByRole('button', { name: 'Add tags' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tags' })
  await dialog.getByRole('textbox', { name: 'Add a tag' }).fill(`#${tag.toUpperCase()}`)
  await dialog.getByRole('textbox', { name: 'Add a tag' }).press('Enter')
  await expect(dialog.getByRole('button', { name: `Remove ${tag.toUpperCase()}` })).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: `Tags: ${tag.toUpperCase()}` })).toBeVisible()
  await page.getByRole('button', { name: 'Save' }).click()

  // The reader shows it as a link into the filtered list.
  const chip = entryPane(page).getByRole('link', { name: tag.toUpperCase() })
  await expect(chip).toBeVisible()
  const id = page.url().split('/entry/')[1]!
  expect((await api.getEntry(id)).tags).toEqual([tag.toUpperCase()])

  await chip.click()
  await expect(page).toHaveURL(new RegExp(`\\?tag=${tag.toUpperCase()}`))
  const list = entriesPane(page)
  await expect(list.getByRole('link', { name: new RegExp(`Tagged day ${tag}`) })).toBeVisible()
  // Another entry of this journal is not in it, and the tag comes back case-insensitively.
  await expect(list.getByRole('link', { name: untagged })).toHaveCount(0)
  expect(other.entry.id).not.toBe(id)

  // Clearing the filter brings the whole list back.
  await list.getByRole('link', { name: `Clear tag filter: ${tag.toUpperCase()}` }).click()
  await expect(list.getByRole('link', { name: untagged })).toHaveCount(1)

  // Editing: a differently-cased tag is the same tag; removing it clears it.
  await page.goto(`/entry/${id}/edit`)
  await page.getByRole('button', { name: `Tags: ${tag.toUpperCase()}` }).click()
  await page
    .getByRole('dialog', { name: 'Tags' })
    .getByRole('button', { name: `Remove ${tag.toUpperCase()}` })
    .click()
  await page.getByRole('dialog', { name: 'Tags' }).getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(entryPane(page).getByRole('article')).toBeVisible()
  expect((await api.getEntry(id)).tags).toEqual([])
})

test('search by tag, alone and with words, and a tag-only match says so', async ({
  page,
  api,
  journal,
}) => {
  const tag = word()
  const river = `river${word()}`
  await api.createEntry({ journalId: journal.id, bodyMd: `# Hike\n\n${river} walk`, tags: [tag] })
  await api.createEntry({ journalId: journal.id, bodyMd: `# Swim\n\n${river} swim` })
  await api.createEntry({ journalId: journal.id, bodyMd: '# Cooking\n\nSoup', tags: [tag] })

  // The tag picker on the Search page narrows to it with no words typed.
  await page.goto('/search')
  await page.getByRole('button', { name: 'Tag' }).click()
  await page.getByRole('option', { name: tag }).click()
  const results = page.getByRole('list', { name: 'Results' }).getByRole('listitem')
  await expect(results).toHaveCount(2)
  await expect(page).toHaveURL(new RegExp(`tag=${tag}`))

  // With words it is the tag AND the words.
  await page.getByRole('searchbox', { name: 'Search entries' }).fill(river)
  await expect(results).toHaveCount(1)
  await expect(results.first()).toContainText('Hike')

  // Words that only match the tag say where the match was.
  await page.goto(`/search?q=${tag}`)
  const hit = page.getByRole('list', { name: 'Results' }).getByRole('listitem')
  await expect(hit).toHaveCount(2)
  await expect(hit.first()).toContainText('Tags')
  await expect(hit.first().locator('mark')).toHaveText(tag)
})

test('rename, merge and delete tags in Manage tags', async ({ page, api, journal }) => {
  const [a, b, c] = [word(), word(), word()]
  const e1 = await api.createEntry({ journalId: journal.id, bodyMd: `One ${a}`, tags: [a] })
  const e2 = await api.createEntry({ journalId: journal.id, bodyMd: `Two ${a}`, tags: [a, b] })
  const e3 = await api.createEntry({ journalId: journal.id, bodyMd: `Three ${c}`, tags: [c] })

  await page.goto('/tags')
  const dialog = page.getByRole('dialog', { name: 'Edit tag' })
  const list = page.getByRole('list', { name: 'Tags' })

  // Rename: every entry that had it shows the new name.
  await list.getByRole('button', { name: `Edit ${a}` }).click()
  await dialog.getByRole('textbox', { name: 'Name' }).fill(`${a}-renamed`)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(list.getByRole('button', { name: `Edit ${a}-renamed` })).toBeVisible()
  expect((await api.getEntry(e1.entry.id)).tags).toEqual([`${a}-renamed`])
  expect((await api.getEntry(e2.entry.id)).tags.sort()).toEqual([`${a}-renamed`, b].sort())

  // Renaming onto an existing tag is a merge, and says so first.
  await list.getByRole('button', { name: `Edit ${b}` }).click()
  await dialog.getByRole('textbox', { name: 'Name' }).fill(`${a}-RENAMED`)
  await expect(dialog).toContainText('already exists')
  await dialog.getByRole('button', { name: 'Merge…' }).click()
  await page
    .getByRole('dialog', { name: `Merge “${b}”?` })
    .getByRole('button', { name: 'Merge' })
    .click()
  await expect(list.getByRole('button', { name: `Edit ${b}` })).toHaveCount(0)
  expect((await api.getEntry(e2.entry.id)).tags).toEqual([`${a}-renamed`])

  // Delete: the tag goes, the entry stays.
  await list.getByRole('button', { name: `Edit ${c}` }).click()
  await dialog.getByRole('button', { name: 'Delete…' }).click()
  await page
    .getByRole('dialog', { name: `Delete “${c}”?` })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(list.getByRole('button', { name: `Edit ${c}` })).toHaveCount(0)
  expect((await api.getEntry(e3.entry.id)).tags).toEqual([])
})

test('Manage tags says it needs a connection offline, and comes back online', async ({
  page,
  context,
  api,
  journal,
}) => {
  const tag = word()
  await api.createEntry({ journalId: journal.id, bodyMd: `Offline ${tag}`, tags: [tag] })
  await page.goto('/tags')
  const list = page.getByRole('list', { name: 'Tags' })
  await expect(list.getByRole('button', { name: `Edit ${tag}` })).toBeVisible()

  await goOffline(context)
  expect(await serverUnreachable(page)).toBe(true)
  // The page notices the server is gone on its next request: coming back to the tab makes one.
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  const notice = page.getByRole('alert').filter({ hasText: 'You’re offline' })
  await expect(notice).toBeVisible()
  await expect(list).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Edit ${tag}` })).toHaveCount(0)

  // Going back online makes a request by itself (the account is re-read), which ends the notice;
  // Try again would too, but it may already be gone.
  await goOnline(context)
  await expect(notice).toBeHidden()
  await expect(list.getByRole('button', { name: `Edit ${tag}` })).toBeVisible()
})

test('merge a tag into another from the Merge into… picker', async ({ page, api, journal }) => {
  const [from, into] = [word(), `${word()}Keep`]
  const e1 = await api.createEntry({ journalId: journal.id, bodyMd: `One ${from}`, tags: [from] })
  const e2 = await api.createEntry({
    journalId: journal.id,
    bodyMd: `Two ${from}`,
    tags: [from, into],
  })

  await page.goto('/tags')
  const list = page.getByRole('list', { name: 'Tags' })
  await list.getByRole('button', { name: `Edit ${from}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit tag' })
  await dialog.getByRole('button', { name: 'Merge into…' }).click()
  const picker = page.getByRole('dialog', { name: `Merge “${from}” into` })
  await picker.getByRole('searchbox', { name: 'Search tags' }).fill(into.toLowerCase())
  await picker.getByRole('button', { name: new RegExp(`^${into}`) }).click()

  // It asks first, naming both tags and how many entries move.
  const confirm = page.getByRole('dialog', { name: `Merge “${from}”?` })
  await expect(confirm).toContainText(`tagged “${into}” instead`)
  // Back returns to the picker without changing anything.
  await confirm.getByRole('button', { name: 'Back' }).click()
  await expect(picker).toBeVisible()
  expect((await api.getEntry(e1.entry.id)).tags).toEqual([from])

  await picker.getByRole('button', { name: new RegExp(`^${into}`) }).click()
  await confirm.getByRole('button', { name: 'Merge' }).click()
  await expect(list.getByRole('button', { name: `Edit ${from}` })).toHaveCount(0)
  expect((await api.getEntry(e1.entry.id)).tags).toEqual([into])
  expect((await api.getEntry(e2.entry.id)).tags).toEqual([into])
})

test('offline, the editor still suggests the tags it knew, and new and existing tags save once online', async ({
  page,
  context,
  api,
  journal,
}) => {
  const [known, fresh] = [word(), word()]
  await api.createEntry({ journalId: journal.id, bodyMd: `Has ${known}`, tags: [known] })

  await page.goto(`/j/${journal.id}`)
  await waitForServiceWorker(page)
  await page.reload()
  // Online, opening the tag list once is what remembers it on this device.
  await page.goto(`/j/${journal.id}/new`)
  await page.getByRole('button', { name: 'Add tags' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tags' })
  await dialog.getByRole('textbox', { name: 'Add a tag' }).fill(known)
  await expect(dialog.getByRole('button', { name: new RegExp(`^${known}`) })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Offline, with no journal kept on the device to count tags from, they are still offered.
  await goOffline(context)
  expect(await serverUnreachable(page)).toBe(true)
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, `Offline tagged ${fresh}`)
  await page.getByRole('button', { name: 'Add tags' }).click()
  await dialog.getByRole('textbox', { name: 'Add a tag' }).fill(known)
  await dialog.getByRole('button', { name: new RegExp(`^${known}`) }).click()
  await dialog.getByRole('textbox', { name: 'Add a tag' }).fill(fresh)
  await dialog.getByRole('textbox', { name: 'Add a tag' }).press('Enter')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(entryPane(page).getByRole('link', { name: known })).toBeVisible()
  const id = page.url().split('/entry/')[1]!

  await goOnline(context)
  await expect
    .poll(async () => {
      // Not on the server until the replay lands: a 404 until then.
      const tags = await api.getEntry(id).then(
        (e) => e.tags,
        () => null,
      )
      return tags && [...tags].sort()
    })
    .toEqual([known, fresh].sort())
})
