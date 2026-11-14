import { expect, test } from './helpers/test.ts'
import { goOffline, goOnline, serverUnreachable } from './helpers/offline.ts'
import { newUser } from './helpers/users.ts'

// Runs as a user of its own: account-wide settings are flipped, and the shared e2e user is shared.

test('account settings changed offline stick, then reach the server once back online', async ({
  browser,
  request,
}, info) => {
  const tag = `os${info.project.name}${Date.now() % 1000000}`
  const { page, context, request: mine } = await newUser(browser, request, tag)
  const me = async () => (await (await mine.get('/api/auth/me')).json()) as Record<string, unknown>
  const before = await me()

  await page.goto('/settings')
  const unit = page.getByRole('group', { name: 'Temperature unit' })
  const archived = page.getByRole('switch', { name: 'Show archived journals in the menu' })

  await goOffline(context)
  expect(await serverUnreachable(page)).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('status').filter({ hasText: 'You’re offline' })).toBeVisible()

  // The two settings are on different pages, reached by the app's own links while offline.
  await page.getByRole('link', { name: /^Appearance/ }).click()
  await expect(archived).toBeChecked()
  await archived.click()
  await expect(archived).not.toBeChecked()
  // On a phone the list and the page take turns; from 840px the list stays beside it.
  const back = page.getByRole('button', { name: 'Back', exact: true })
  if (await back.isVisible()) await back.click()
  await page.getByRole('link', { name: /^Location & weather/ }).click()
  const other = before.tempUnit === 'F' ? 'C' : 'F'
  await unit.getByRole('button', { name: `°${other}` }).click()
  await expect(unit.getByRole('button', { name: `°${other}` })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await me()).toMatchObject({ tempUnit: before.tempUnit, showArchivedInMenu: true })

  await goOnline(context)
  await expect.poll(me).toMatchObject({ tempUnit: other, showArchivedInMenu: false })
  await expect(unit.getByRole('button', { name: `°${other}` })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await context.close()
})
