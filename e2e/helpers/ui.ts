// Small page helpers that hide the differences between the phone and desktop layouts.
import { expect, type Page } from '@playwright/test'

/** The floating New entry button (the sidebar's + is also labelled "New entry"). */
export const fab = (page: Page) => page.locator('a[aria-label="New entry"]:not(nav a)')

/** The full nav: the sidebar on desktop, the drawer (opened here) on a phone. */
export async function openNav(page: Page) {
  const menu = page.getByRole('button', { name: 'Open menu' })
  if (await menu.isVisible()) {
    await menu.click()
    const drawer = page.getByRole('dialog', { name: 'Menu' })
    // Open for real (its slide-in has begun): a click on a link mid-open can miss.
    await expect(drawer).toBeVisible()
    return drawer
  }
  return page.getByRole('navigation', { name: 'Main' })
}

/**
 * Types into the CodeMirror editor at the end of the text. Full speed on purpose: keys arriving
 * faster than React renders once dropped characters (MarkdownEditor's `reported` guard).
 */
export async function typeInEditor(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Entry text' }).click()
  await page.keyboard.press('ControlOrMeta+End')
  // With an Android user agent CodeMirror leaves Enter to the IME, so a bare Enter keypress does
  // nothing in the phone project; line breaks go in as text input there, as a real keyboard's do.
  const android = await page.evaluate(() => /Android/.test(navigator.userAgent))
  const lines = text.split('\n')
  for (const [i, line] of lines.entries()) {
    if (i > 0) {
      if (android) await page.keyboard.insertText('\n')
      else await page.keyboard.press('Enter')
    }
    await page.keyboard.type(line)
  }
}

export const entriesPane = (page: Page) =>
  page.getByRole('region', { name: 'Entries', exact: true })
export const entryPane = (page: Page) => page.getByRole('region', { name: 'Entry', exact: true })

/**
 * A real one-finger touch swipe across the middle of the screen (CDP touch events, which is what a
 * phone sends): `left` moves the finger from the right of the screen to the left.
 */
export async function swipeAcross(page: Page, direction: 'left' | 'right') {
  const cdp = await page.context().newCDPSession(page)
  const { width, height } = page.viewportSize()!
  const y = height / 2
  const [from, to] = direction === 'left' ? [0.8, 0.2] : [0.2, 0.8]
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    })
  await touch('touchStart', width * from)
  for (const k of [0.25, 0.5, 0.75]) await touch('touchMove', width * (from + (to - from) * k))
  await touch('touchEnd', width * to)
  await cdp.detach()
}
