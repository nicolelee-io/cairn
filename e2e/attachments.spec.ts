import { expect, test } from './helpers/test.ts'
import { entryPane, fab, typeInEditor } from './helpers/ui.ts'

// A one-line PDF made on the fly: enough for the server to recognise, never a real document.
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
)

test('attach a PDF; it shows as a chip while writing and a card in the reader', async ({
  page,
  journal,
}) => {
  await page.goto(`/j/${journal.id}`)
  await fab(page).click()
  await typeInEditor(page, 'Paperwork day')
  await page
    .getByLabel('Choose files')
    .setInputFiles({ name: 'Warranty card.pdf', mimeType: 'application/pdf', buffer: PDF })

  // The upload lands in the text as a chip with the file's name; Save waits for it.
  const chip = entryPane(page).getByRole('button', { name: 'Warranty card.pdf', exact: true })
  await expect(chip).toBeVisible()
  await page.getByRole('button', { name: 'Save' }).click()

  const reader = entryPane(page).getByRole('article')
  const card = reader.getByRole('link', { name: /Warranty card\.pdf/ })
  await expect(card).toContainText('PDF ·')
  const href = await card.getAttribute('href')
  expect(href).toMatch(/^\/api\/attachments\/[\w-]+$/)

  // Served inline, under the name it was uploaded with.
  const res = await page.request.get(href!)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('application/pdf')
  expect(res.headers()['content-disposition']).toContain("filename*=UTF-8''Warranty%20card.pdf")

  // Search's Attachments chip finds it with no words typed (this journal only: tests share data).
  const findWithFiles = async () => {
    await page.goto(`/search?j=${journal.id}`)
    await page.getByRole('button', { name: 'More filters' }).click()
    await page.getByRole('button', { name: 'Attachments' }).click()
    return page.getByRole('list', { name: 'Results' })
  }
  await expect((await findWithFiles()).getByText('Paperwork day')).toBeVisible()
  await (await findWithFiles()).getByRole('link', { name: /Paperwork day/ }).click()

  // Removing it from the text and saving deletes it (until then the strip lists it as not in
  // the text, like a photo).
  await entryPane(page).getByRole('link', { name: 'Edit', exact: true }).click()
  await chip.click() // the first tap selects it and shows its buttons
  await entryPane(page).getByRole('button', { name: 'Remove file' }).click()
  await expect(chip).toHaveCount(0)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(reader.getByRole('link', { name: /Warranty card\.pdf/ })).toHaveCount(0)
  expect((await page.request.get(href!)).status()).toBe(404)
  await expect((await findWithFiles()).getByText('Paperwork day')).toBeHidden()
})
