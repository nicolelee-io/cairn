import { expect, test } from './helpers/test.ts'
import { E2E_PASSWORD, E2E_USER } from './env.ts'
import type { Page } from '@playwright/test'

// These start signed out and sign out at the end, so they use their own session, never the
// shared one the other specs run on.
test.use({ storageState: { cookies: [], origins: [] } })

async function signIn(page: Page, password = E2E_PASSWORD) {
  await page.getByLabel('Username').fill(E2E_USER)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('a wrong password is refused', async ({ page }) => {
  await page.goto('/')
  await signIn(page, 'not-the-password')
  await expect(page.getByRole('alert')).toHaveText('Wrong username or password.')
  await expect(page.getByRole('heading', { name: 'All Entries' })).toBeHidden()
})

test('a deep link signed out shows the login, then the page asked for', async ({ page }) => {
  await page.goto('/journals')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Manage journals' })).toBeVisible()
})

test('sign out asks first, then ends the session', async ({ page }) => {
  await page.goto('/settings/account')
  await signIn(page)
  await page.getByRole('button', { name: 'Sign out' }).click()

  const confirm = page.getByRole('dialog', { name: 'Sign out?' })
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await confirm.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

  // The session is gone on the server too, not just hidden.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  expect((await page.request.get('/api/auth/me')).status()).toBe(401)
})
