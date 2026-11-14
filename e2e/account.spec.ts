import { ACCOUNT_PASSWORD, accountUser } from './env.ts'
import { expect, test } from './helpers/test.ts'
import type { Page } from '@playwright/test'

// Each project has its own account (see env.ts), signed in here with a fresh session, so changing
// the password or username never touches the shared `e2e` user the other specs run on.
test.use({ storageState: { cookies: [], origins: [] } })
// The tests of a project share its account, so they take turns.
test.describe.configure({ mode: 'serial' })

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/settings/account')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
}

test('the account card edits the display name and the default timezone', async ({ page }, info) => {
  await signIn(page, accountUser(info.project.name), ACCOUNT_PASSWORD)
  const nameRow = page.getByRole('button', { name: /^Display name/ })
  await nameRow.click()
  const nameDialog = page.getByRole('dialog', { name: 'Display name' })
  await nameDialog.getByLabel('Display name').fill('  Renamed Person ')
  await nameDialog.getByRole('button', { name: 'Save' }).click()
  await expect(nameDialog).toBeHidden()
  await expect(nameRow).toContainText('Renamed Person')
  await page.reload()
  await expect(nameRow).toContainText('Renamed Person')

  const zoneRow = page.getByRole('button', { name: /^Default timezone/ })
  await zoneRow.click()
  const dialog = page.getByRole('dialog', { name: 'Default timezone' })
  await dialog.getByLabel('Search timezones').fill('Tokyo')
  await dialog.getByRole('button', { name: /Asia\/Tokyo/ }).click()
  await expect(zoneRow).toContainText('Asia/Tokyo')
  await page.reload()
  await expect(zoneRow).toContainText('Asia/Tokyo')
})

test('a picture can be added and removed', async ({ page }, info) => {
  await signIn(page, accountUser(info.project.name), ACCOUNT_PASSWORD)
  // A 2x2 PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGM4YWMDRAwQCgAlPgUBdJmUYAAAAABJRU5ErkJggg==',
    'base64',
  )
  await page.getByLabel('Choose a picture').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: png,
  })
  await expect(page.getByRole('button', { name: 'Remove picture' })).toBeVisible()
  const picture = page
    .getByRole('button', { name: 'Change picture' })
    .locator('img[src^="/api/avatar?v="]')
  await expect(picture).toBeVisible()
  await page.getByRole('button', { name: 'Remove picture' }).click()
  await expect(page.getByRole('button', { name: 'Add a picture' })).toBeVisible()
  await expect(picture).toHaveCount(0)
})

test('changing the password asks for the current one and ends other sessions', async ({
  page,
  browser,
}, info) => {
  const user = accountUser(info.project.name)
  await signIn(page, user, ACCOUNT_PASSWORD)
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await signIn(otherPage, user, ACCOUNT_PASSWORD)

  await page.getByRole('button', { name: /^Password/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Change password' })
  await dialog.getByLabel('Current password').fill('not-the-password')
  await dialog.getByLabel('New password', { exact: true }).fill('a-brand-new-password')
  await dialog.getByLabel('Repeat the new password').fill('a-brand-new-password')
  await dialog.getByRole('button', { name: 'Change password' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('That isn’t your current password.')

  await dialog.getByLabel('Current password').fill(ACCOUNT_PASSWORD)
  await dialog.getByRole('button', { name: 'Change password' }).click()
  await expect(dialog).toBeHidden()

  // This session stays; the other one is gone.
  expect((await page.request.get('/api/auth/me')).status()).toBe(200)
  expect((await otherPage.request.get('/api/auth/me')).status()).toBe(401)
  await other.close()

  // Back to the original, so a rerun against the same data still signs in.
  await page.getByRole('button', { name: /^Password/ }).click()
  await dialog.getByLabel('Current password').fill('a-brand-new-password')
  await dialog.getByLabel('New password', { exact: true }).fill(ACCOUNT_PASSWORD)
  await dialog.getByLabel('Repeat the new password').fill(ACCOUNT_PASSWORD)
  await dialog.getByRole('button', { name: 'Change password' }).click()
  await expect(dialog).toBeHidden()
})

test('the username changes and the new name signs in', async ({ page, browser }, info) => {
  const user = accountUser(info.project.name)
  await signIn(page, user, ACCOUNT_PASSWORD)
  await page.getByRole('button', { name: /^Username/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Change username' })
  await dialog.getByLabel('New username').fill(`${user}-NEW`)
  await dialog.getByLabel('Current password').fill(ACCOUNT_PASSWORD)
  await dialog.getByRole('button', { name: 'Change username' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(`Signs in as ${user}-new`)).toBeVisible()

  const fresh = await browser.newContext()
  await signIn(await fresh.newPage(), `${user}-new`, ACCOUNT_PASSWORD)
  await fresh.close()

  // Restore.
  await page.getByRole('button', { name: /^Username/ }).click()
  await dialog.getByLabel('New username').fill(user)
  await dialog.getByLabel('Current password').fill(ACCOUNT_PASSWORD)
  await dialog.getByRole('button', { name: 'Change username' }).click()
  await expect(dialog).toBeHidden()
})
