import type { APIRequestContext, Browser, TestInfo } from '@playwright/test'
import { BASE_URL } from './env.ts'
import { expect, test } from './helpers/test.ts'
import { newUser as newPlainUser } from './helpers/users.ts'

// Runs as the shared `e2e` user, an admin, who seeds the server-wide categories and suggested prompts
// (uniquely named, so parallel tests never meet). The user-side flows run as a user made for each
// test: the daily cards draw from a whole prompt list, so they need a list nobody else adds to.

const headers = { Origin: BASE_URL }

const uniqueTag = (info: TestInfo) =>
  `pr${info.project.name}${Date.now() % 1000000}${Math.floor(Math.random() * 100)}`

/** Seeds one category of suggested prompts as the admin; resolves to the category's id. */
async function seedSuggested(admin: APIRequestContext, name: string, prompts: string[]) {
  const imported = await admin.post('/api/prompts/suggested/import', {
    data: { file: { categories: [{ name, icon: 'star', prompts }] }, dryRun: false },
    headers,
  })
  expect(imported.status(), await imported.text()).toBe(200)
  const list = (await (await admin.get('/api/prompts/categories')).json()) as {
    categories: { id: string; name: string }[]
  }
  return list.categories.find((c) => c.name === name)!.id
}

/** A plain user (see helpers/users.ts) who can also add prompts to their own list. */
async function newUser(browser: Browser, admin: APIRequestContext, tag: string) {
  const user = await newPlainUser(browser, admin, tag)
  const addPrompt = async (text: string, categoryId: string | null = null) => {
    const res = await user.request.post('/api/prompts/mine', {
      data: { text, categoryId },
      headers,
    })
    expect(res.status(), await res.text()).toBe(201)
  }
  return { ...user, addPrompt }
}

test('save suggested prompts, then write from a daily card', async ({ request, browser }, info) => {
  const tag = uniqueTag(info)
  const texts = [1, 2, 3, 4].map((n) => `${tag} question ${n}?`)
  await seedSuggested(request, tag, texts)
  const user = await newUser(browser, request, tag)
  const { page } = user

  await page.goto('/prompts')
  await expect(page.getByText('Save a few suggested prompts to get started.')).toBeVisible()
  await page.getByRole('link', { name: 'Browse suggested prompts' }).click()

  // A category starts collapsed; opening it lists its prompts.
  const group = page.getByRole('region', { name: tag, exact: true })
  const toggle = group.getByRole('button', { expanded: false })
  await expect(toggle).toBeVisible()
  await expect(group.getByText(texts[0]!)).toBeHidden()
  await toggle.click()
  await group.getByRole('button', { name: `Save: ${texts[0]}` }).click()
  await expect(group.getByText('Saved', { exact: true })).toHaveCount(1)
  await group.getByRole('button', { name: `Save all 3 prompts in ${tag}` }).click()
  await expect(group.getByText('All saved')).toBeVisible()

  // Back on Prompts, three daily cards; one starts an entry with the prompt as its heading.
  await page.goto('/prompts')
  const cards = page.getByRole('region', { name: 'Daily prompts' }).getByRole('link')
  await expect(cards).toHaveCount(3)
  const label = await cards.first().locator('span').first().innerText()
  await cards.first().click()
  await expect(page).toHaveURL(/\/new\?prompt=/)
  const editor = page.getByRole('textbox', { name: 'Entry text' })
  await expect(editor).toContainText(label)
  // The caret is already below the heading, so typing needs no click.
  await expect(editor).toBeFocused()
  await page.keyboard.type('My answer')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page).toHaveURL(/\/entry\/[^/?]+$/)
  const id = /\/entry\/([^/?]+)$/.exec(page.url())![1]!
  expect((await user.api.getEntry(id)).entry.bodyMd).toBe(`# ${label}\n\nMy answer`)
  await expect(page.getByRole('article').getByRole('heading', { name: label })).toBeVisible()
  await user.context.close()
})

test('an untouched prompt entry closes without asking and leaves no draft', async ({
  request,
  browser,
}, info) => {
  const tag = uniqueTag(info)
  const user = await newUser(browser, request, tag)
  const { page } = user
  await page.goto(`/new?prompt=${encodeURIComponent(`${tag} untouched?`)}`)
  const editor = page.getByRole('textbox', { name: 'Entry text' })
  await expect(editor).toContainText(`${tag} untouched?`)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).not.toHaveURL(/\/new/)
  await page.goto('/drafts')
  await expect(page.getByText(`${tag} untouched?`)).toHaveCount(0)
  await user.context.close()
})

test('pick a category for three prompts from it, and add your own with a category', async ({
  request,
  browser,
}, info) => {
  const tag = uniqueTag(info)
  const categoryId = await seedSuggested(request, tag, ['unused seed?'])
  const user = await newUser(browser, request, tag)
  const { page } = user
  for (let n = 1; n <= 4; n++) await user.addPrompt(`${tag} own ${n}?`, categoryId)

  await page.goto('/prompts')
  const section = page.getByRole('region', { name: 'Pick a category' })
  await expect(section.getByText('Pick a category to see three prompts.')).toBeVisible()
  await section.getByRole('button', { name: tag, pressed: false }).click()
  await expect(section.getByRole('link')).toHaveCount(3)

  // Refresh draws from the bag again: still three, and it survives a reload.
  await section.getByRole('button', { name: 'Show new prompts from this category' }).click()
  await expect(section.getByRole('link')).toHaveCount(3)
  await page.reload()
  await expect(section.getByRole('button', { name: tag, pressed: true })).toBeVisible()
  await expect(section.getByRole('link')).toHaveCount(3)

  // The chosen chip again puts it away.
  await section.getByRole('button', { name: tag, pressed: true }).click()
  await expect(section.getByText('Pick a category to see three prompts.')).toBeVisible()

  // Add your own: the category is a chip inside the dialog, never a clipped dropdown.
  await page.getByRole('button', { name: 'Add your own prompt' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add your own prompt' })
  await dialog.getByRole('textbox', { name: 'Prompt' }).fill(`${tag} added by hand?`)
  await dialog.getByRole('group', { name: 'Category' }).getByRole('button', { name: tag }).click()
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(dialog).toBeHidden()
  const mine = (await (await user.request.get('/api/prompts/mine')).json()) as {
    prompts: { text: string; categoryId: string | null }[]
  }
  expect(mine.prompts.find((p) => p.text === `${tag} added by hand?`)?.categoryId).toBe(categoryId)
  await user.context.close()
})

test('select prompts and delete them in bulk', async ({ request, browser }, info) => {
  const tag = uniqueTag(info)
  const user = await newUser(browser, request, tag)
  const { page } = user
  for (let n = 1; n <= 5; n++) await user.addPrompt(`${tag} bulk ${n}?`)

  await page.goto('/prompts/all')
  await page.getByRole('button', { name: 'Select prompts' }).click()
  await page.getByRole('button', { name: `${tag} bulk 1?` }).click()
  await expect(page.getByText('1 of 5 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Select all 5' }).click()
  await expect(page.getByText('5 of 5 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Delete…' }).click()
  await page
    .getByRole('dialog', { name: 'Delete 5 prompts?' })
    .getByRole('button', { name: 'Delete 5' })
    .click()
  await expect(page.getByText('No prompts yet.')).toBeVisible()
  await user.context.close()
})

test('an admin imports a file, deletes its prompts in bulk, and users are refused', async ({
  page,
  request,
  browser,
}, info) => {
  const tag = uniqueTag(info)
  await page.goto('/settings/prompts')
  await page.getByRole('button', { name: 'Import JSON' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import prompts' })
  const file = {
    categories: [
      { name: tag, icon: 'star', prompts: ['a?', 'b?', 'c?', 'a?'].map((t) => `${tag} ${t}`) },
    ],
  }
  await dialog.getByRole('textbox', { name: 'Prompts JSON' }).fill(JSON.stringify(file))
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await expect(dialog.getByRole('status')).toHaveText(
    '1 new category, 3 new prompts, 1 already there',
  )
  await dialog.getByRole('button', { name: 'Import' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Edit ${tag}` })).toBeVisible()

  // Filter to the new category, select everything in it, delete.
  await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: tag }).click()
  await page.getByRole('button', { name: 'Select prompts' }).click()
  await page.getByRole('button', { name: 'Select all 3' }).click()
  await page.getByRole('button', { name: 'Delete…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete 3 prompts?' })
  await expect(confirm).toContainText('Copies people have already saved stay')
  await confirm.getByRole('button', { name: 'Delete 3' }).click()
  // Its chip is gone (the filter row itself stays while anyone else's categories have prompts).
  await expect(
    page.getByRole('group', { name: 'Category' }).getByRole('button', { name: tag, exact: true }),
  ).toHaveCount(0)

  // Remove the now-empty category too.
  await page.getByRole('button', { name: `Edit ${tag}` }).click()
  await page.getByRole('button', { name: 'Delete…' }).click()
  await page
    .getByRole('dialog', { name: `Delete “${tag}”?` })
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(page.getByRole('button', { name: `Edit ${tag}` })).toHaveCount(0)

  // A plain user gets the refusal, and the server agrees.
  const user = await newUser(browser, request, tag)
  await user.page.goto('/settings/prompts')
  await expect(user.page.getByText('Only an admin can manage suggested prompts.')).toBeVisible()
  const write = await user.request.post('/api/prompts/categories', {
    data: { name: 'nope' },
    headers,
  })
  expect(write.status()).toBe(403)
  await user.context.close()
})

test('the admin prompts page opens at the top, not where Settings was scrolled', async ({
  page,
  request,
}, info) => {
  const tag = uniqueTag(info)
  // Enough prompts that the page is longer than where Settings was scrolled to.
  await seedSuggested(
    request,
    tag,
    Array.from({ length: 60 }, (_, n) => `${tag} question ${n}?`),
  )
  await page.goto('/settings')
  const link = page.getByRole('link', { name: /Suggested prompts/ })
  await link.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => window.scrollY)
  test.skip(before < 100, 'Settings fits the screen here, so there is nothing to scroll')

  // The first visit loads the list from a short page; the second finds it cached and as tall as it
  // will get, which is when a leftover scroll offset shows.
  for (const visit of [1, 2]) {
    await link.click()
    await expect(page).toHaveURL(/\/settings\/prompts$/)
    // The list is long (and shared with the other project's seed), so only its first rows are checked.
    await expect(page.getByText(new RegExp(`${tag} question`)).first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

    // Back is where Settings was left.
    await page.goBack()
    await expect(page).toHaveURL(/\/settings$/)
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { message: `visit ${visit}` })
      .toBeGreaterThan(before - 50)
  }
})
