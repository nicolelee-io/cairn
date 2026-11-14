import { BASE_URL } from './env.ts'
import { expect, isPhone, test } from './helpers/test.ts'
import { entriesPane, entryPane, fab, swipeAcross, typeInEditor } from './helpers/ui.ts'

test('write, save, read and edit an entry', async ({ page, api, journal }, info) => {
  await page.goto(`/j/${journal.id}`)
  await fab(page).click()

  await typeInEditor(
    page,
    '# Morning walk\n\nSaw a **heron** by the river. <img src=x onerror="window.__xss=1">',
  )
  await page.getByRole('button', { name: 'Add mood' }).click()
  await page.getByRole('group', { name: 'Mood' }).getByRole('button', { name: 'Anxious' }).click()
  await page.getByRole('button', { name: 'Star' }).click()
  await page.getByRole('button', { name: 'Save' }).click()

  // Save steps back to the reader, which renders the markdown.
  const reader = entryPane(page).getByRole('article')
  await expect(reader.getByRole('heading', { name: 'Morning walk' })).toBeVisible()
  await expect(reader.locator('strong')).toHaveText('heron')
  await expect(reader.getByRole('img', { name: 'Anxious' })).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Star', pressed: true })).toBeVisible()
  // Raw HTML in an entry is shown as text, never run.
  await expect(reader).toContainText('<img src=x')
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined()

  // The card in the list.
  if (isPhone(info.project.name)) await page.getByRole('button', { name: 'Back' }).click()
  const card = entriesPane(page).getByRole('link', { name: /Morning walk/ })
  await expect(card).toContainText('Saw a heron by the river.')
  await expect(card.getByRole('img', { name: 'Anxious' })).toBeVisible()

  // Edit, save, and it survives a reload.
  await card.click()
  await entryPane(page).getByRole('link', { name: 'Edit', exact: true }).click()
  await typeInEditor(page, '\n\nLater: it came back.')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(reader).toContainText('Later: it came back.')
  await page.reload()
  await expect(entryPane(page).getByRole('article')).toContainText('Later: it came back.')

  const id = page.url().split('/entry/')[1]!
  const saved = await api.getEntry(id)
  expect(saved.entry).toMatchObject({ journalId: journal.id, mood: 'anxious', starred: true })
  expect(saved.entry.bodyMd).toMatch(/^# Morning walk\n\nSaw a \*\*heron\*\*/)
})

test('Ctrl+S saves and stays in the editor; Ctrl+Shift+S saves and closes', async ({
  page,
  api,
  journal,
}) => {
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, '# Keep going\n\nFirst paragraph.')

  // A new entry: the first Ctrl+S creates it and carries on in the edit route, caret in the text.
  await page.keyboard.press('Control+s')
  await expect(page).toHaveURL(/\/entry\/[^/]+\/edit$/)
  const id = page.url().split('/entry/')[1]!.split('/')[0]!
  await expect(page.locator('.cm-content')).toContainText('First paragraph.')
  await expect(page.getByRole('button', { name: 'Save and close' })).toBeDisabled()

  // Typing carries straight on, and the next Ctrl+S is an edit of the same entry.
  await page.keyboard.type('\n\nSecond paragraph.')
  await expect(page.getByRole('button', { name: 'Save and close' })).toBeEnabled()
  await page.keyboard.press('Control+s')
  await expect(page.getByRole('button', { name: 'Save and close' })).toBeDisabled()
  await expect
    .poll(async () => (await api.getEntry(id)).entry.bodyMd)
    .toContain('Second paragraph.')
  await expect(page).toHaveURL(/\/edit$/)

  // Ctrl+Shift+S saves and goes to the reader.
  await page.keyboard.type('\n\nThird paragraph.')
  await page.keyboard.press('Control+Shift+s')
  await expect(entryPane(page).getByRole('article')).toContainText('Third paragraph.')
  expect((await api.getEntry(id)).entry.bodyMd).toContain('Third paragraph.')
})

test('an Open link pill appears while the caret is in a link', async ({ page, journal }) => {
  await page.goto(`/j/${journal.id}`)
  await fab(page).click()
  await typeInEditor(page, 'Read https://example.com/pill now')
  const pill = page.getByRole('button', { name: 'Open link' })
  await expect(pill).toBeHidden() // the caret is past the link
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
  await expect(pill).toBeVisible()
  const popup = page.waitForEvent('popup')
  await pill.click()
  expect((await popup).url()).toContain('example.com/pill')
})

test('clicking the empty space below a short text puts the caret in the text', async ({
  page,
  journal,
}) => {
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, 'Short.')
  // Move focus away, then click near the bottom of the editor, well below the one line of text.
  await page.getByRole('button', { name: 'Star' }).focus()
  const box = (await page.locator('.cm-editor').boundingBox())!
  const line = (await page.locator('.cm-line').first().boundingBox())!
  expect(box.y + box.height - (line.y + line.height)).toBeGreaterThan(80)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12)
  await page.keyboard.type(' More.')
  await expect(page.locator('.cm-content')).toContainText('Short. More.')
})

test('the reader: journal chip leads the footer, and an archived journal explains the disabled buttons', async ({
  page,
  api,
  journal,
}) => {
  const { entry } = await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Chip order',
    createdAt: Date.now(),
  } as never)
  await page.goto(`/entry/${entry.id}`)
  const chips = page.getByRole('article').locator('footer > div').first().locator('> *')
  await expect(chips.first()).toContainText(journal.name)

  const res = await page.request.patch(`/api/journals/${journal.id}`, {
    data: { archived: true },
    headers: { Origin: BASE_URL },
  })
  expect(res.ok()).toBe(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Star' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Star' })).toHaveAttribute(
    'title',
    'This journal is archived',
  )
})

test('swiping the reader goes to the older and newer entry, and stops at the ends', async ({
  page,
  api,
  journal,
  isMobile,
}) => {
  test.skip(!isMobile, 'a touch gesture')
  const at = (iso: string) => Date.parse(iso)
  await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Oldest swipe',
    createdAt: at('2026-02-01T15:00:00Z'),
  })
  const middle = await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Middle swipe',
    createdAt: at('2026-02-02T15:00:00Z'),
  })
  await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Newest swipe',
    createdAt: at('2026-02-03T15:00:00Z'),
  })

  await page.goto(`/j/${journal.id}/entry/${middle.entry.id}`)
  const heading = (name: string) => page.getByRole('heading', { name })
  await expect(heading('Middle swipe')).toBeVisible()

  await swipeAcross(page, 'left') // the finger moves left: the older entry
  await expect(heading('Oldest swipe')).toBeVisible()
  await swipeAcross(page, 'left') // nothing older
  await expect(heading('Oldest swipe')).toBeVisible()
  await swipeAcross(page, 'right')
  await expect(heading('Middle swipe')).toBeVisible()
  await swipeAcross(page, 'right')
  await expect(heading('Newest swipe')).toBeVisible()
  await expect(page).toHaveURL(/\/entry\//)
  // Back still goes to the list (each swipe replaced the entry in history).
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(entriesPane(page).getByText('Newest swipe')).toBeVisible()
})
