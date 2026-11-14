import type { Browser, Page } from '@playwright/test'
import { expect, test } from './helpers/test.ts'

// Runs as the shared `e2e` user, the seeded first user and so an admin. Each test makes its own
// users with unique names, so projects running in parallel never touch each other's.

async function signInFresh(browser: Browser, username: string, password: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await page.goto('/settings/account')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  return { page, close: () => context.close() }
}

async function addUser(page: Page, displayName: string, username: string, password: string) {
  await page.goto('/users')
  await page.getByRole('button', { name: 'Add user' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add user' })
  await dialog.getByLabel('Display name').fill(displayName)
  await dialog.getByLabel('Username').fill(username)
  await dialog.getByLabel('Temporary password').fill(password)
  await dialog.getByRole('button', { name: 'Add user' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Manage ${displayName}` })).toBeVisible()
}

test('an admin adds a user, who signs in and sees no Server settings', async ({
  page,
  browser,
}, info) => {
  const username = `fam-${info.project.name}-${Date.now()}`
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Server' })).toBeVisible()
  await page.getByRole('link', { name: /Manage users/ }).click()
  await expect(page.getByRole('heading', { name: 'Manage users' })).toBeVisible()
  await addUser(page, `Fam ${username}`, username, 'temporary-123')

  const fam = await signInFresh(browser, username, 'temporary-123')
  await expect(fam.page.getByRole('heading', { name: 'Account' })).toBeVisible()
  await expect(fam.page.getByText(/^User$/)).toBeVisible()
  await expect(fam.page.getByRole('heading', { name: 'Server' })).toHaveCount(0)
  await fam.page.goto('/users')
  await expect(fam.page.getByText('Only an admin can manage users.')).toBeVisible()
  await fam.close()
})

test('a disabled user is told so at sign-in, and a reset password works', async ({
  page,
  browser,
}, info) => {
  const username = `paused-${info.project.name}-${Date.now()}`
  const name = `Paused ${username}`
  await addUser(page, name, username, 'temporary-123')

  await page.getByRole('button', { name: `Manage ${name}` }).click()
  await page.getByRole('button', { name: 'Disable…' }).click()
  await page
    .getByRole('dialog', { name: `Disable ${name}?` })
    .getByRole('button', { name: 'Disable' })
    .click()
  await expect(page.getByRole('button', { name: 'Enable' })).toBeVisible()

  const refused = await signInFresh(browser, username, 'temporary-123')
  await expect(refused.page.getByRole('alert')).toHaveText(
    'This account is turned off. Ask an admin.',
  )
  await refused.close()

  await page.getByRole('button', { name: 'Enable' }).click()
  await page.getByRole('button', { name: 'Reset password' }).click()
  const reset = page.getByRole('dialog', { name: `Reset ${name}’s password` })
  await reset.getByLabel('New temporary password').fill('another-temp-456')
  await reset.getByRole('button', { name: 'Reset password' }).click()
  await expect(reset).toBeHidden()

  const back = await signInFresh(browser, username, 'another-temp-456')
  await expect(back.page.getByRole('heading', { name: 'Account' })).toBeVisible()
  await back.close()
})
