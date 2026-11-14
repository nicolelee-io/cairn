import type { Page } from '@playwright/test'
import { expect, test } from './helpers/test.ts'
import type { Api } from './helpers/api.ts'
import { typeInEditor } from './helpers/ui.ts'

// The entry is changed elsewhere (here: straight through the API) while the editor is open, so
// Save gets a 409 and the user picks a side. Nothing is overwritten without that choice.
async function editThenConflict(page: Page, api: Api, journalId: string) {
  const { entry } = await api.createEntry({ journalId, bodyMd: 'Original text' })
  await page.goto(`/j/${journalId}/entry/${entry.id}/edit`)
  await typeInEditor(page, ' plus my edit')
  await api.updateEntry(entry.id, { bodyMd: 'Changed on another device', baseRev: entry.rev })

  await page.getByRole('button', { name: 'Save' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edited somewhere else' })
  await expect(dialog).toContainText('Changed on another device')
  return { id: entry.id, dialog }
}

test('Keep mine saves my text over the other change', async ({ page, api, journal }) => {
  const { id, dialog } = await editThenConflict(page, api, journal.id)
  await dialog.getByRole('button', { name: 'Keep my version' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('article')).toContainText('Original text plus my edit')
  expect((await api.getEntry(id)).entry.bodyMd).toBe('Original text plus my edit')
})

test('Use theirs replaces my text with the other change', async ({ page, api, journal }) => {
  const { id, dialog } = await editThenConflict(page, api, journal.id)
  await dialog.getByRole('button', { name: 'Use the other version' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Entry text' })).toHaveText(
    'Changed on another device',
  )
  expect((await api.getEntry(id)).entry.bodyMd).toBe('Changed on another device')
})
