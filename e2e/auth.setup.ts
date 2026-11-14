import { expect, test as setup } from '@playwright/test'
import { AUTH_STATE, E2E_PASSWORD, E2E_USER } from './env.ts'

// Signs in once through the login screen; every other test starts from this session.
setup('sign in', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill(E2E_USER)
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'All Entries' })).toBeVisible()
  await page.context().storageState({ path: AUTH_STATE })
})
