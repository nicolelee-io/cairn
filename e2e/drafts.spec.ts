import { expect, test } from './helpers/test.ts'
import { fab, typeInEditor } from './helpers/ui.ts'

test('unsaved text is kept as a draft, resumed and discarded', async ({ page, journal }) => {
  await page.goto(`/j/${journal.id}`)
  await fab(page).click()
  await typeInEditor(page, 'Half a thought about the garden')

  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Leave the editor?' })
    .getByRole('button', { name: 'Keep draft' })
    .click()
  await expect(page.getByText('Draft saved')).toBeVisible()
  await page.getByRole('link', { name: 'View drafts' }).click()

  await expect(page.getByRole('heading', { name: 'Drafts' })).toBeVisible()
  const draft = page.getByRole('link', { name: /Half a thought about the garden/ })
  await expect(draft).toContainText(journal.name)

  // Opening it resumes the text in the editor.
  await draft.click()
  await expect(page.getByRole('textbox', { name: 'Entry text' })).toContainText(
    'Half a thought about the garden',
  )
  await page.goBack()

  await page.getByRole('button', { name: 'Discard draft' }).click()
  await page
    .getByRole('dialog', { name: 'Discard this draft?' })
    .getByRole('button', { name: 'Discard' })
    .click()
  await expect(page.getByText('No drafts.')).toBeVisible()
})
