import { expect, isPhone, test } from './helpers/test.ts'
import { typeInEditor } from './helpers/ui.ts'

// Templates belong to the shared user (not a journal), and tests run in parallel: every name here is
// unique to its run, and a test removes what it made.
const unique = (label: string, project: string) => `${label} ${project} ${Date.now() % 1000000}`
const DATE = /\d{1,2}\/\d{1,2}\/\d{4}/

test('add, edit and delete a template from Settings', async ({ page, api }, info) => {
  const name = unique('Evening', info.project.name)
  const renamed = `${name} v2`
  await page.goto('/settings')
  await page.getByRole('link', { name: /Manage templates/ }).click()
  await expect(page).toHaveURL(/\/templates$/)

  await page.getByRole('button', { name: 'New template' }).click()
  const dialog = page.getByRole('dialog', { name: 'New template' })
  await dialog.getByRole('textbox', { name: 'Template name' }).fill(name)
  const body = dialog.getByRole('textbox', { name: 'Template text' })
  await body.fill('# Evening\n\nToday: ')
  // A placeholder button puts its token at the caret, here the end of the text.
  await body.press('ControlOrMeta+End')
  await dialog.getByRole('button', { name: 'Date', exact: true }).click()
  await expect(body).toHaveValue('# Evening\n\nToday: {{date}}')
  await dialog.getByRole('button', { name: 'Add' }).click()
  await expect(dialog).toBeHidden()

  const row = page.getByRole('button', { name: `Edit ${name}`, exact: true })
  await expect(row).toBeVisible()
  await expect(row).toContainText('# Evening')

  await row.click()
  const edit = page.getByRole('dialog', { name: 'Edit template' })
  // Nothing changed yet, so Save is off.
  await expect(edit.getByRole('button', { name: 'Save' })).toBeDisabled()
  await edit.getByRole('textbox', { name: 'Template name' }).fill(renamed)
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(edit).toBeHidden()
  await expect(page.getByRole('button', { name: `Edit ${renamed}`, exact: true })).toBeVisible()
  await expect(row).toHaveCount(0)

  await page.getByRole('button', { name: `Edit ${renamed}`, exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Edit template' })
    .getByRole('button', { name: 'Delete…' })
    .click()
  const confirm = page.getByRole('dialog', { name: 'Delete template?' })
  await expect(confirm).toContainText(renamed)
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByRole('button', { name: `Edit ${renamed}`, exact: true })).toHaveCount(0)
  // Reload: it is gone from the server too, not just the screen.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible()
  await expect(page.getByRole('button', { name: `Edit ${renamed}`, exact: true })).toHaveCount(0)
  void api
})

test('a blank name or text cannot be saved', async ({ page }) => {
  await page.goto('/templates')
  await page.getByRole('button', { name: 'New template' }).click()
  const dialog = page.getByRole('dialog', { name: 'New template' })
  const add = dialog.getByRole('button', { name: 'Add' })
  await expect(add).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'Template name' }).fill('Only a name')
  await expect(add).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'Template text' }).fill('  \n ')
  await expect(add).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'Template text' }).fill('Text')
  await expect(add).toBeEnabled()
})

test('typing / lists the templates and picking one inserts its text with the date filled in', async ({
  page,
  api,
  journal,
}, info) => {
  const name = unique('Zebra log', info.project.name)
  const made = await api.createTemplate({ name, bodyMd: '## Log {{date}}\n\nMood: ' })
  try {
    await page.goto(`/j/${journal.id}/new`)
    await typeInEditor(page, `Notes\n/${name.toLowerCase()}`)
    // The menu is filtered by what was typed, spaces and all; the template is the one match.
    const option = page.getByRole('option', { name })
    await expect(option).toBeVisible()
    if (isPhone(info.project.name)) await option.click()
    else {
      // CodeMirror ignores Enter for 75ms after the menu opens.
      await page.waitForTimeout(150)
      await page.keyboard.press('Enter')
    }
    const text = page.locator('.cm-content')
    await expect(text).toContainText(new RegExp(`Log ${DATE.source}`))
    await expect(text).toContainText('Mood:')
    await expect(text).not.toContainText('{{date}}')
    await expect(text).not.toContainText('/zebra log')
  } finally {
    await api.deleteTemplate(made.id)
  }
})

test('templates are listed first in the slash menu, under their own heading', async ({
  page,
  api,
  journal,
}, info) => {
  const name = unique('Alpha pick', info.project.name)
  const made = await api.createTemplate({ name, bodyMd: 'x' })
  try {
    await page.goto(`/j/${journal.id}/new`)
    await typeInEditor(page, '/')
    const menu = page.getByRole('listbox').filter({ has: page.getByRole('option') })
    await expect(menu).toBeVisible()
    // The built-ins are all there too, after the templates.
    await expect(page.getByRole('option', { name: /^Date and time/ })).toBeVisible()
    const labels = await page.getByRole('option').allInnerTexts()
    const mine = labels.findIndex((l) => l.startsWith(name))
    const builtIn = labels.findIndex((l) => l.startsWith('Date and time'))
    expect(mine).toBeGreaterThanOrEqual(0)
    expect(mine).toBeLessThan(builtIn)
  } finally {
    await api.deleteTemplate(made.id)
  }
})

test('the header menu inserts a template, and its Manage link opens the templates page', async ({
  page,
  api,
  journal,
}, info) => {
  const name = unique('Header pick', info.project.name)
  const made = await api.createTemplate({ name, bodyMd: 'Gratitude: {{weekday}}' })
  try {
    await page.goto(`/j/${journal.id}/new`)
    await typeInEditor(page, 'Start. ')
    const button = page.getByRole('button', { name: 'Templates', exact: true })
    await button.click()
    await page.getByRole('menuitem', { name, exact: true }).click()
    const text = page.locator('.cm-content')
    await expect(text).toContainText(/Start\. Gratitude: [A-Z][a-z]+day/)
    await expect(text).not.toContainText('{{weekday}}')

    await expect(page.getByRole('menu')).toBeHidden() // a sheet may still be sliding away
    await button.click()
    await page.getByRole('menuitem', { name: 'Manage templates' }).click()
    await expect(page).toHaveURL(/\/templates$/)
  } finally {
    await api.deleteTemplate(made.id)
  }
})

test('Save as template makes a template of the entry text, named after its title', async ({
  page,
  api,
  journal,
}, info) => {
  const title = unique('Weekly review', info.project.name)
  await page.goto(`/j/${journal.id}/new`)
  await typeInEditor(page, `# ${title}\n\nWins:\n\nNext week:`)
  await page.getByRole('button', { name: 'Templates', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Save as template/ }).click()

  const dialog = page.getByRole('dialog', { name: 'Save as template' })
  await expect(dialog.getByRole('textbox', { name: 'Template name' })).toHaveValue(title)
  await expect(dialog.getByRole('textbox', { name: 'Template text' })).toHaveValue(
    `# ${title}\n\nWins:\n\nNext week:`,
  )
  // The entry's own text is what gets saved, as it stands: no change is needed first.
  await dialog.getByRole('button', { name: 'Save template' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Saved as a template')).toBeVisible()

  const res = await page.request.get('/api/templates')
  const saved = (
    (await res.json()) as { templates: { id: string; name: string; bodyMd: string }[] }
  ).templates.find((t) => t.name === title)
  try {
    expect(saved?.bodyMd).toBe(`# ${title}\n\nWins:\n\nNext week:`)
    // It is in the menu now, and the entry itself is untouched.
    await page.getByRole('button', { name: 'Templates', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: title, exact: true })).toBeVisible()
  } finally {
    if (saved) await api.deleteTemplate(saved.id)
  }
})

test('Save as template is off for an empty entry', async ({ page, journal }) => {
  await page.goto(`/j/${journal.id}/new`)
  await page.getByRole('button', { name: 'Templates', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: /^Save as template/ })).toBeDisabled()
  await expect(page.getByRole('menuitem', { name: /^Manage templates/ })).toBeEnabled()
})

test('the command palette inserts a template while writing', async ({
  page,
  api,
  journal,
}, info) => {
  test.skip(isPhone(info.project.name), 'the palette is a keyboard feature')
  const name = unique('Palette pick', info.project.name)
  const made = await api.createTemplate({ name, bodyMd: 'From the palette {{date}}' })
  try {
    await page.goto(`/j/${journal.id}/new`)
    await typeInEditor(page, 'Note: ')
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await page.keyboard.type(`insert template: ${name}`)
    await expect(
      palette.getByRole('option', { name: new RegExp(`^Insert template: ${name}`) }),
    ).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden()
    await expect(page.locator('.cm-content')).toContainText(
      new RegExp(`Note: From the palette ${DATE.source}`),
    )
  } finally {
    await api.deleteTemplate(made.id)
  }
})

test('on a phone the Templates button is in the toolbar, and the header fits 360px', async ({
  page,
  journal,
}, info) => {
  test.skip(!isPhone(info.project.name), 'a phone-width check')
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto(`/j/${journal.id}/new`)
  for (const name of ['Close', 'Add mood', 'Pin', 'Star', 'Source', 'Save and close']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox()
    expect(box, name).not.toBeNull()
    expect(box!.x, name).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, name).toBeLessThanOrEqual(360)
  }
  // The touch toolbar has room for it after the groups; the header doesn't carry a second one.
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' })
  await expect(toolbar.getByRole('button', { name: 'Templates', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Templates', exact: true })).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
})

test('a multi-line template put above the title does not turn the heading into plain text', async ({
  page,
  api,
  journal,
}, info) => {
  const name = unique('Block pick', info.project.name)
  const made = await api.createTemplate({ name, bodyMd: 'Best of:\n- one\n\nAs of: {{date}}' })
  try {
    await page.goto(`/j/${journal.id}/new`)
    await typeInEditor(page, '# Template test\n\nBody text')
    // The caret to the very start, above the title.
    await page.keyboard.press('ControlOrMeta+Home')
    await page.getByRole('button', { name: 'Templates', exact: true }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()

    const lines = page.locator('.cm-line')
    const texts = await lines.allInnerTexts()
    // The template's last line and the title are on separate lines, a blank line apart.
    const asOf = texts.findIndex((t) => t.startsWith('As of:'))
    expect(asOf).toBeGreaterThanOrEqual(0)
    expect(texts[asOf]).toMatch(new RegExp(`^As of: ${DATE.source}$`))
    expect(texts[asOf + 1]?.trim()).toBe('') // an empty line reports a bare line break
    expect(texts[asOf + 2]).toContain('Template test')
    expect(texts[asOf + 2]).not.toContain('As of')
  } finally {
    await api.deleteTemplate(made.id)
  }
})
