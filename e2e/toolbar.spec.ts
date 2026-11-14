import { expect, isPhone, test } from './helpers/test.ts'
import { typeInEditor } from './helpers/ui.ts'

const toolbar = (page: import('@playwright/test').Page) =>
  page.getByRole('toolbar', { name: 'Formatting' })

/**
 * A phone groups its choices behind four buttons; a mouse shows each as a button until the row runs
 * short and a group folds into its menu button. So: press the button if it is there, else open the
 * group.
 */
async function choose(page: import('@playwright/test').Page, group: string, item: string) {
  const direct = toolbar(page).getByRole('button', { name: item, exact: true })
  if (await direct.count()) return direct.click()
  await toolbar(page).getByRole('button', { name: group, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

test('the heading buttons set a level, show the current one in the menu and go back to a paragraph', async ({
  page,
  journal,
}) => {
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, 'Morning')
  const text = page.locator('.cm-content')
  const grouped =
    (await toolbar(page).getByRole('button', { name: 'Heading', exact: true }).count()) > 0

  await choose(page, 'Heading', 'Heading 2')
  await expect(text).toContainText('## Morning')

  // In the menu the check is where the caret's line is now; a different level replaces it.
  if (grouped) {
    await expect(page.getByRole('menu')).toBeHidden() // a sheet may still be sliding away
    await toolbar(page).getByRole('button', { name: 'Heading', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Heading 2' })).toContainText('Selected')
    await page.getByRole('menuitem', { name: 'Heading 1' }).click()
  } else {
    await toolbar(page).getByRole('button', { name: 'Heading 1', exact: true }).click()
  }
  await expect(text).toContainText('# Morning')
  await expect(text).not.toContainText('## Morning')

  // Back to a paragraph: the menu has Paragraph; the buttons toggle the level off.
  if (grouped) {
    await expect(page.getByRole('menu')).toBeHidden()
    await choose(page, 'Heading', 'Paragraph')
  } else {
    await toolbar(page).getByRole('button', { name: 'Heading 1', exact: true }).click()
  }
  await expect(text).not.toContainText('# Morning')
  await expect(text).toContainText('Morning')
})

test('the mouse toolbar folds groups into menus before it runs into undo and redo', async ({
  page,
  journal,
}, info) => {
  test.skip(isPhone(info.project.name), 'a touch screen has the grouped layout')
  await page.goto(`/j/${journal.id}/new`)
  const bar = toolbar(page)
  const row = bar.locator('> div').first()
  const undo = bar.getByRole('button', { name: 'Undo' })
  const headingMenu = bar.getByRole('button', { name: 'Heading', exact: true })
  for (const width of [1800, 1400, 1100, 900]) {
    await page.setViewportSize({ width, height: 900 })
    // Fits or is folded to fit: the row never scrolls, and its last button ends before undo begins.
    await expect
      .poll(() => row.evaluate((el) => el.scrollWidth <= el.clientWidth), { message: `${width}px` })
      .toBe(true)
    const last = (await row.getByRole('button').last().boundingBox())!
    expect(last.x + last.width).toBeLessThanOrEqual((await undo.boundingBox())!.x)
    // Headings fold first: open at the widest window, one menu button at the narrowest.
    if (width === 1800) await expect(headingMenu).toHaveCount(0)
    if (width === 900) await expect(headingMenu).toHaveCount(1)
  }
})

test('the Quote and Files buttons (grouped on a phone) quote a line and open the file picker', async ({
  page,
  journal,
}) => {
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, 'Said something wise')

  await choose(page, 'Lists and blocks', 'Quote')
  await expect(page.locator('.cm-content')).toContainText('> Said something wise')

  await expect(page.getByRole('menu')).toBeHidden()
  const chooser = page.waitForEvent('filechooser')
  await choose(page, 'Attachments', 'Files')
  expect((await chooser).isMultiple()).toBe(true)
})

test('every toolbar button is in view on a 360px phone, with nothing to scroll', async ({
  page,
  journal,
}, info) => {
  test.skip(!isPhone(info.project.name), 'phone layout')
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto(`/j/${journal.id}/new`)
  const bar = toolbar(page)
  await expect(bar).toBeVisible()
  const { width } = page.viewportSize()!
  // Four groups, Templates, and undo and redo fit side by side, and each button is a real touch
  // target (44px at this width, 48px from 380px).
  for (const name of [
    'Heading',
    'Text styling',
    'Lists and blocks',
    'Attachments',
    'Templates',
    'Undo',
    'Redo',
  ]) {
    const box = (await bar.getByRole('button', { name }).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
    expect(box.width).toBeGreaterThanOrEqual(44)
  }
  // Nothing may push the page sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('italic uses asterisks, so it works in the middle of a word; strikethrough and divider render in the entry', async ({
  page,
  journal,
}) => {
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, 'Acatmeow and old news')
  const text = page.locator('.cm-content')

  // Select "cat" (offsets 1-4) with the keyboard, then italic from the toolbar.
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await choose(page, 'Text styling', 'Italic')
  await expect(text).toContainText('A*cat*meow')

  // Strike "old news" at the end, with the shortcut.
  await page.keyboard.press('Control+End')
  for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Control+Shift+x')
  await expect(text).toContainText('~~old news~~')

  // A divider goes in as its own block.
  await choose(page, 'Lists and blocks', 'Divider')
  await expect(text).toContainText('---')

  await page.getByRole('button', { name: 'Save and close' }).click()
  const article = page.getByRole('region', { name: 'Entry', exact: true }).getByRole('article')
  await expect(article.locator('em')).toHaveText('cat')
  await expect(article.locator('del')).toHaveText('old news')
  await expect(article.locator('hr')).toHaveCount(1)
})

test('a pipe table is styled in the editor and renders as a table in the reader', async ({
  page,
  journal,
}) => {
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, 'Shopping\n\n| Item | Qty |\n| --- | ---: |\n| Tea | 2 |\n\nDone')
  // Header, divider and row are three styled lines; the text around them is not.
  await expect(page.locator('.cm-table')).toHaveCount(3)
  await expect(page.locator('.cm-table-head')).toContainText('Item')

  await page.getByRole('button', { name: 'Save and close' }).click()
  const table = page.getByRole('region', { name: 'Entry', exact: true }).getByRole('table')
  await expect(table.getByRole('columnheader')).toHaveText(['Item', 'Qty'])
  await expect(table.getByRole('cell')).toHaveText(['Tea', '2'])
})

test('a checklist: the button makes items, a tap ticks one, and the reader shows them with footnotes and links', async ({
  page,
  journal,
}) => {
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, 'Packing\n\ntent\nstove')
  await page.keyboard.press('Control+End')
  for (let i = 0; i < 9; i++) await page.keyboard.press('Shift+ArrowLeft')
  await choose(page, 'Lists and blocks', 'Checklist')
  const text = page.locator('.cm-content')
  await expect(page.getByRole('checkbox')).toHaveCount(2)
  // The bullet is part of the box, not shown beside it.
  await expect(text.locator('.cm-line').filter({ hasText: 'tent' })).toHaveText('tent')

  // Tapping the first box ticks it in the text.
  await page.getByRole('checkbox').first().dispatchEvent('mousedown')
  await expect(page.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'true')

  // (Enter's list continuation is CodeMirror's own; on the phone project Enter is left to the IME.)
  await typeInEditor(
    page,
    '\n- [ ] matches\n- [ ]\n\nNote[^1] and www.example.com\n\n[^1]: Footnote text',
  )
  await expect(page.getByRole('checkbox')).toHaveCount(4)
  await expect(text).toContainText('Footnote text')
  // A bare address is styled as a link in the editor too.
  await expect(text.locator('.cm-link', { hasText: 'www.example.com' })).toHaveCount(1)

  // Ctrl+click opens it in a new tab (a plain click just edits).
  const popup = page.waitForEvent('popup')
  await text.locator('.cm-link', { hasText: 'www.example.com' }).click({ modifiers: ['Control'] })
  expect((await popup).url()).toContain('www.example.com')

  await page.getByRole('button', { name: 'Save and close' }).click()
  const article = page.getByRole('region', { name: 'Entry', exact: true }).getByRole('article')
  const boxes = article.getByRole('checkbox')
  await expect(boxes).toHaveCount(4) // the empty one too, not a bare "[ ]"
  await expect(boxes.first()).toBeChecked()
  await expect(boxes.nth(1)).not.toBeChecked()
  await expect(article.getByRole('link', { name: 'www.example.com' })).toHaveAttribute(
    'href',
    'http://www.example.com',
  )
  // A footnote's number jumps within the entry rather than opening a tab.
  const ref = article.locator('sup a')
  await expect(ref).toBeVisible()
  await expect(ref).not.toHaveAttribute('target', '_blank')
  await expect(article).toContainText('Footnote text')
})

test('a checklist in the reader can be ticked: one character changes and it is saved', async ({
  page,
  api,
  journal,
}) => {
  const body = 'Trip\n\n- [ ] boots\n- [x] map\n- [ ] flask\n\n```\n- [ ] not a task\n```'
  const id = (await api.createEntry({ journalId: journal.id, bodyMd: body })).entry.id
  await page.goto(`/j/${journal.id}/entry/${id}`)
  const article = page.getByRole('region', { name: 'Entry', exact: true }).getByRole('article')
  const boxes = article.getByRole('checkbox')
  await expect(boxes).toHaveCount(3)

  await boxes.nth(2).click()
  await expect(boxes.nth(2)).toBeChecked()
  await expect
    .poll(async () => (await api.getEntry(id)).entry.bodyMd)
    .toBe(body.replace('[ ] flask', '[x] flask'))
  await boxes.nth(1).click() // and back off
  await expect(boxes.nth(1)).not.toBeChecked()
  await expect
    .poll(async () => (await api.getEntry(id)).entry.bodyMd)
    .toBe(body.replace('[ ] flask', '[x] flask').replace('[x] map', '[ ] map'))
})
