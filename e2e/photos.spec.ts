import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, isPhone, test } from './helpers/test.ts'
import { entriesPane, entryPane, fab, typeInEditor } from './helpers/ui.ts'

// sharp is native CommonJS; a static import trips Playwright's ESM loader.
const sharp = createRequire(import.meta.url)('sharp') as typeof import('sharp').default

// Plain coloured squares made on the fly: never a real photo in the repo or the test data.
async function makePhoto(path: string, color: string) {
  await sharp({ create: { width: 1200, height: 900, channels: 3, background: color } })
    .jpeg()
    .toFile(path)
  return path
}

/** A real touch double tap whose second touch stays down and moves down the screen. */
async function dragZoom(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const { width, height } = page.viewportSize()!
  const x = width / 2
  const y = height / 2
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at = y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y: at }],
    })
  await touch('touchStart')
  await touch('touchEnd')
  await touch('touchStart')
  for (const d of [20, 60, 110, 160]) await touch('touchMove', y + d)
  await touch('touchEnd')
  await cdp.detach()
}

/** A real touch swipe from right to left across the middle of the screen. */
async function swipeLeft(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const { width, height } = page.viewportSize()!
  const y = height / 2
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    })
  await touch('touchStart', width * 0.8)
  for (const f of [0.65, 0.5, 0.35]) await touch('touchMove', width * f)
  await touch('touchEnd', width * 0.2)
  await cdp.detach()
}

test('upload photos; they show in the reader, the lightbox and the card', async ({
  page,
  journal,
}, info) => {
  const files = [
    await makePhoto(info.outputPath('green.jpg'), '#5f7f5a'),
    await makePhoto(info.outputPath('blue.jpg'), '#5d7592'),
  ]
  await page.goto(`/j/${journal.id}`)
  await fab(page).click()
  await typeInEditor(page, 'Photo day')
  await page.getByLabel('Choose photos').setInputFiles(files)

  // Each upload becomes a photo widget in the text; Save waits for them.
  await expect(page.locator('.cm-content img')).toHaveCount(2)
  await page.getByRole('button', { name: 'Save' }).click()

  const reader = entryPane(page).getByRole('article')
  const photos = reader.locator('img[src^="/api/photos/"][src$="/display"]')
  await expect(photos).toHaveCount(2)
  await expect(photos.first()).toHaveJSProperty('complete', true)
  expect(
    await photos.first().evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0)

  await photos.first().click()
  const viewer = page.getByRole('dialog', { name: 'Photo viewer' })
  await expect(viewer).toContainText('1 of 2')
  // A double tap zooms in on the photo and a second one puts it back (a double click here).
  const shown = viewer.locator('[data-current] img')
  await shown.dblclick()
  await expect.poll(() => shown.evaluate((img) => img.style.transform)).toMatch(/scale\(\d/)
  await shown.dblclick()
  await expect.poll(() => shown.evaluate((img) => img.style.transform)).toBe('')
  if (isPhone(info.project.name)) {
    // Double tap, hold on the second touch and drag down: the zoom follows the finger.
    await dragZoom(page)
    await expect.poll(() => shown.evaluate((img) => img.style.transform)).toMatch(/scale\(\d/)
    await shown.dblclick() // zoomed: a double tap puts it back
    await expect.poll(() => shown.evaluate((img) => img.style.transform)).toBe('')
  }
  // The arrow buttons are for wide screens; a phone swipes.
  if (isPhone(info.project.name)) await swipeLeft(page)
  else await viewer.getByRole('button', { name: 'Next photo' }).click()
  await expect(viewer).toContainText('2 of 2')
  await viewer.getByRole('button', { name: 'Close' }).click()
  await expect(viewer).toBeHidden()

  if (isPhone(info.project.name)) await page.getByRole('button', { name: 'Back' }).click()
  const card = entriesPane(page).getByRole('link', { name: /Photo day/ })
  await expect(card.locator('img[src$="/thumb"]')).toBeVisible()
  await expect(card).toContainText('+1')
})
