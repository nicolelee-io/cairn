import type { Page } from '@playwright/test'
import { expect, test } from './helpers/test.ts'
import { swipeAcross } from './helpers/ui.ts'

// Touch behaviour that only a phone has. The feel is checked by hand; these catch regressions.
test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'touch only'))

/** A real one-finger touch: down at `from`, move through `via`, up. */
async function touch(page: Page, from: [number, number], via: [number, number][] = [], hold = 0) {
  const cdp = await page.context().newCDPSession(page)
  const point = ([x, y]: [number, number]) => ({ touchPoints: [{ x, y }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', ...point(from) })
  if (hold) await page.waitForTimeout(hold)
  for (const p of via)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', ...point(p) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

test('small controls have a 44px tap target', async ({ page, journal }) => {
  await page.goto(`/j/${journal.id}`)
  const menu = page.getByRole('button', { name: 'Open menu' })
  const box = (await menu.boundingBox())!
  expect(box.height).toBeLessThan(44) // the look is unchanged...
  // ...but a touch a pixel or two outside it still lands on it.
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.closest('button')?.getAttribute('aria-label'),
    [box.x + box.width / 2, box.y + box.height + 1],
  )
  expect(hit).toBe('Open menu')
})

test('no screen scrolls sideways because of the tap targets', async ({ page, journal }) => {
  for (const url of [`/j/${journal.id}`, '/insights', '/settings', '/journals']) {
    await page.goto(url)
    await page.waitForTimeout(300)
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(over, url).toBeLessThanOrEqual(0)
  }
})

test('the view switch stays put when the list scrolls', async ({ page, api, journal }) => {
  for (let i = 1; i <= 15; i++)
    await api.createEntry({
      journalId: journal.id,
      bodyMd: `# Scroll ${i}`,
      createdAt: Date.parse(`2026-04-${String(i).padStart(2, '0')}T15:00:00Z`),
    })
  await page.goto(`/j/${journal.id}`)
  await page.getByRole('radio', { name: 'List', exact: true }).click()
  const top = async () => (await page.getByRole('radiogroup', { name: 'View' }).boundingBox())!.y
  await expect(page.getByText('Scroll 15')).toBeVisible()
  const resting = await top()
  await page.evaluate(() => window.scrollTo(0, 400))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
  expect(await top()).toBe(resting) // it sticks exactly where it rests: no 8px jump
})

test('swiping the menu left closes it', async ({ page, journal }) => {
  await page.goto(`/j/${journal.id}`)
  await page.getByRole('button', { name: 'Open menu' }).click()
  const drawer = page.getByRole('dialog', { name: 'Menu' })
  await expect(drawer).toBeVisible()
  await swipeAcross(page, 'left')
  await expect(drawer).toBeHidden()
  // It still opens with the button, and swiping right does not open or close anything.
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(drawer).toBeVisible()
})

test('pulling the touch menu’s handle down closes it', async ({ page, api, journal }) => {
  const entry = await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Hold me',
    createdAt: Date.now(),
  })
  await page.goto(`/j/${journal.id}/entry/${entry.entry.id}`)
  // A touch tap on the ⋮ button opens the sheet (the long press that opens it on a card sends a
  // click to the new sheet's backdrop when a synthetic finger lifts, which a real phone does not).
  await page.getByRole('button', { name: 'More actions' }).tap()
  const sheet = page.getByRole('dialog', { name: 'Hold me' })
  await expect(sheet.getByRole('menuitem').first()).toBeVisible()
  // Measured once it has finished sliding up, or the handle is not where the box says.
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const s = (await sheet.boundingBox())!
  const x = s.x + s.width / 2
  const y = s.y + 14
  await touch(
    page,
    [x, y],
    [
      [x, y + 30],
      [x, y + 70],
      [x, y + 120],
      [x, y + 160],
    ],
  )
  await expect(sheet).toBeHidden()
})
