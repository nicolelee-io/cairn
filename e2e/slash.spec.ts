import { expect, isPhone, test } from './helpers/test.ts'
import { typeInEditor } from './helpers/ui.ts'

const menu = (page: import('@playwright/test').Page) =>
  page.getByRole('listbox').filter({ has: page.getByRole('option') })

test('typing / lists the inserts, and picking one replaces the slash text', async ({
  page,
  journal,
}) => {
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, 'Today is /dat')
  await expect(menu(page)).toBeVisible()
  await expect(page.getByRole('option', { name: /^Date and time/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /^Yesterday/ })).toBeVisible()

  // A tap works on every screen; the keyboard path is the next test (desktop only).
  await page.getByRole('option', { name: /^Date(?!\s*and)/ }).click()
  const text = page.locator('.cm-content')
  await expect(text).toContainText(/Today is \d{1,2}\/\d{1,2}\/\d{4}/)
  await expect(text).not.toContainText('/dat')
  await expect(menu(page)).toBeHidden()
})

test('Enter picks the first match and Esc closes just the menu', async ({
  page,
  journal,
}, info) => {
  test.skip(isPhone(info.project.name), 'the phone project leaves Enter to the IME')
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, 'Notes\n/head')
  await expect(menu(page)).toBeVisible()
  // CodeMirror ignores Enter for 75ms after the menu opens (so a fast Enter isn't taken for a pick).
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  // The heading prefix goes on the line the slash was typed on; the caret is after it.
  await page.keyboard.type('Plan')
  await expect(page.locator('.cm-content')).toContainText('# Plan')
  await expect(page.locator('.cm-content')).not.toContainText('/head')

  await typeInEditor(page, '\n/quo')
  await expect(menu(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu(page)).toBeHidden()
  // Esc went to the menu, not to the editor's leave: still writing, no leave dialog.
  await expect(page).toHaveURL(/\/new/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.cm-content')).toContainText('/quo')
})

test('a slash inside a word or an address does not open the menu', async ({ page, journal }) => {
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, 'and/or see https://example.com/da')
  await expect(page.locator('.cm-content')).toContainText('and/or see https://example.com/da')
  await expect(menu(page)).toBeHidden()
})

test('an insert is one undo step', async ({ page, journal }, info) => {
  test.skip(isPhone(info.project.name), 'undo is checked on desktop; the phone has the button')
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, 'x /tom')
  await page.getByRole('option', { name: /^Tomorrow/ }).click()
  await expect(page.locator('.cm-content')).toContainText(/x \d{1,2}\/\d{1,2}\/\d{4}/)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.cm-content')).not.toContainText(/\d{1,2}\/\d{1,2}\/\d{4}/)
})
