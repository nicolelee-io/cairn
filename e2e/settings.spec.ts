import { expect, isPhone, test } from './helpers/test.ts'
import { openNav } from './helpers/ui.ts'
import { goOffline, goOnline, serverUnreachable } from './helpers/offline.ts'

test('a forced theme applies and survives a reload', async ({ page }) => {
  await page.goto('/settings/appearance')
  const html = page.locator('html')
  await page.getByRole('button', { name: 'Dark' }).click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'System' }).click()
  await expect(html).not.toHaveAttribute('data-theme')
})

test('the entry font and size are per device and survive a reload', async ({ page }) => {
  await page.goto('/settings/appearance')
  await page.getByRole('link', { name: /^Entry text/ }).click()
  const html = page.locator('html')
  await page.getByRole('button', { name: 'Lora' }).click()
  await page.getByRole('button', { name: 'Larger' }).click()
  await expect(html).toHaveCSS('--font-entry', /Lora/)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Lora' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Larger' })).toHaveAttribute('aria-pressed', 'true')
  await expect(html).toHaveCSS('--font-entry', /Lora/)
  await page.getByRole('button', { name: 'Literata' }).click()
  await page.getByRole('button', { name: 'Default' }).click()
  // Back stays even beside the Settings list (from 840px), since this page sits under Appearance.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page).toHaveURL(/\/settings\/appearance$/)
})

test('phone: the bottom bar can be switched off', async ({ page }, info) => {
  test.skip(!isPhone(info.project.name), 'the bottom bar is a phone/tablet thing')
  await page.goto('/')
  const bar = page.getByRole('navigation', { name: 'Primary' })
  await expect(bar).toBeVisible()

  await page.goto('/settings/appearance')
  await page.getByRole('switch', { name: 'Show the bottom bar' }).click()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'All Entries' })).toBeVisible()
  await expect(bar).toBeHidden()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'All Entries' })).toBeVisible()
  await expect(bar).toBeHidden()
})

// Desktop only: it flips an account setting, and the phone project signs in as the same user.
test('the Archived fold in the menu can be switched off', async ({ page, journal }, info) => {
  test.skip(isPhone(info.project.name), 'shares the account with the desktop project')
  await page.goto('/journals')
  await page.getByRole('button', { name: `Edit ${journal.name}` }).click()
  await page
    .getByRole('dialog', { name: 'Edit journal' })
    .getByRole('button', { name: 'Archive' })
    .click()
  await page.goto('/search')
  const fold = (await openNav(page)).getByText(/^Archived \(/)
  await expect(fold).toBeVisible()

  const sw = () => page.getByRole('switch', { name: 'Show archived journals in the menu' })
  await page.goto('/settings/appearance')
  await sw().click()
  try {
    await page.goto('/search')
    await expect(fold).toBeHidden()
  } finally {
    await page.goto('/settings/appearance')
    if ((await sw().getAttribute('aria-checked')) !== 'true') await sw().click()
  }
})

test('offline, a banner explains; name and password lock and server settings hide', async ({
  page,
  context,
}, info) => {
  // On a phone the list and each page take turns on screen; from 840px they sit side by side.
  const phone = isPhone(info.project.name)
  const toList = async () => {
    if (phone) await page.getByRole('button', { name: 'Back', exact: true }).click()
  }
  await page.goto('/settings')
  const server = page.getByRole('heading', { name: 'Server', exact: true })
  const users = page.getByRole('link', { name: /^Manage users/ })
  await expect(server).toBeVisible()
  await expect(users).toBeVisible()

  await goOffline(context)
  expect(await serverUnreachable(page)).toBe(true)
  // The page notices the server is gone on its next request: coming back to the tab makes one.
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  const banner = page.getByRole('status').filter({ hasText: 'You’re offline' })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('Some settings need a connection')
  // Everything under Server is read from the server, its links' pages included.
  await expect(server).toHaveCount(0)
  await expect(users).toHaveCount(0)

  // The name and Sign out need the server (App settings queue: offline-settings.spec.ts).
  await page.getByRole('link', { name: 'Account' }).click()
  await expect(page.getByRole('button', { name: 'Display name' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /^Sign out/ })).toBeDisabled()
  await expect(banner).toBeVisible()

  await toList()
  await page.getByRole('link', { name: /^Export/ }).click()
  await expect(page.getByRole('link', { name: 'Export', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()

  // Going back online re-reads the account, which clears the offline state by itself.
  await goOnline(context)
  await expect(banner).toBeHidden()
  await expect(page.getByRole('link', { name: 'Export', exact: true })).toBeVisible()
  await toList()
  await expect(server).toBeVisible()
})
