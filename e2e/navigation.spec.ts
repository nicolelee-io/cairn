import type { Page } from '@playwright/test'
import { expect, isPhone, test } from './helpers/test.ts'
import { entriesPane, entryPane, fab, openNav } from './helpers/ui.ts'

test('phone: one pane at a time, and Back keeps the list position', async ({
  page,
  api,
  journal,
}, info) => {
  test.skip(!isPhone(info.project.name), 'phone layout')
  for (let i = 1; i <= 25; i++) {
    await api.createEntry({
      journalId: journal.id,
      bodyMd: `# Day ${i}\n\nA few lines so the card has an excerpt.`,
      createdAt: Date.UTC(2026, 5, i, 18),
    })
  }
  await page.goto(`/j/${journal.id}`)
  const bottomBar = page.getByRole('navigation', { name: 'Primary' })
  await expect(bottomBar).toBeVisible()
  await expect(fab(page)).toBeVisible()

  const card = entriesPane(page).getByRole('link', { name: /^Day 5 / })
  await card.scrollIntoViewIfNeeded()
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(500)

  // The reader replaces the list, and the bar and FAB step aside.
  await card.click()
  await expect(entryPane(page).getByRole('heading', { name: 'Day 5' })).toBeVisible()
  await expect(entriesPane(page)).toBeHidden()
  await expect(bottomBar).toBeHidden()
  await expect(fab(page)).toBeHidden()

  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(card).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled - 50)
})

test('phone: the drawer opens a journal', async ({ page, journal }, info) => {
  test.skip(!isPhone(info.project.name), 'phone layout')
  await page.goto('/')
  const drawer = await openNav(page)
  await drawer.getByRole('link', { name: journal.name }).click()
  await expect(page.getByRole('heading', { level: 1, name: journal.name })).toBeVisible()
  await expect(drawer).toBeHidden()
})

test('phone: reopening the drawer the instant its slide-out ends keeps it open', async ({
  page,
}, info) => {
  test.skip(!isPhone(info.project.name), 'phone layout')
  await page.goto('/')
  const drawer = await openNav(page)
  // The drawer's d.close() queues a `close` event for later. Reopening inside the animationend
  // that triggers it puts that event after the reopen; it used to shut the new drawer at once.
  // (On `document`, so it runs after the drawer's own listener has closed the dialog.)
  await page.evaluate(() => {
    document.addEventListener(
      'animationend',
      () => document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]')?.click(),
      { once: true },
    )
  })
  await page.keyboard.press('Escape')
  await expect(drawer).toBeVisible()
  await page.waitForTimeout(300)
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Insights' })).toBeVisible()
})

test('desktop: sidebar, list and reader side by side', async ({ page, api, journal }, info) => {
  test.skip(isPhone(info.project.name), 'desktop layout')
  await api.createEntry({ journalId: journal.id, bodyMd: '# Side by side' })
  await page.goto('/')

  const sidebar = page.getByRole('navigation', { name: 'Main' })
  await sidebar.getByRole('link', { name: journal.name }).click()
  await expect(page.getByRole('heading', { level: 1, name: journal.name })).toBeVisible()
  await expect(entryPane(page)).toContainText('Select an entry to read it.')

  await entriesPane(page)
    .getByRole('link', { name: /Side by side/ })
    .click()
  await expect(entryPane(page).getByRole('heading', { name: 'Side by side' })).toBeVisible()
  await expect(entriesPane(page)).toBeVisible()
  await expect(sidebar).toBeVisible()
})

test('a deep link to an entry survives a reload', async ({ page, api, journal }) => {
  const { entry } = await api.createEntry({ journalId: journal.id, bodyMd: '# Deep link' })
  // The server answers the SPA's routes with the app shell (no client-side redirect involved).
  await page.goto(`/j/${journal.id}/entry/${entry.id}`)
  await expect(entryPane(page).getByRole('heading', { name: 'Deep link' })).toBeVisible()
  await page.reload()
  await expect(entryPane(page).getByRole('heading', { name: 'Deep link' })).toBeVisible()
})

test('desktop: zen mode hides the list and sidebar, and sticks', async ({
  page,
  journal,
}, info) => {
  test.skip(isPhone(info.project.name), 'needs two panes')
  await page.goto(`/j/${journal.id}/new`)
  const list = entriesPane(page)
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(list).toBeVisible()
  await expect(nav).toBeVisible()

  await page.getByRole('button', { name: 'Zen mode' }).click()
  await expect(list).toBeHidden()
  await expect(nav).toBeHidden()

  // Per device: still on after a reload, and gone again outside the editor.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Zen mode' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(list).toBeHidden()
  await page.goto(`/j/${journal.id}`)
  await expect(list).toBeVisible()
  await expect(nav).toBeVisible()

  await page.goto(`/j/${journal.id}/new`)
  await page.getByRole('button', { name: 'Zen mode' }).click()
  await expect(list).toBeVisible()
})

test('desktop: reader zen mode lasts for the entry on screen, and X leaves it', async ({
  page,
  api,
  journal,
}, info) => {
  test.skip(isPhone(info.project.name), 'needs two panes')
  const { entry } = await api.createEntry({ journalId: journal.id, bodyMd: '# Zen reading' })
  await page.goto(`/j/${journal.id}/entry/${entry.id}`)
  const list = entriesPane(page)
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(list).toBeVisible()

  await page.getByRole('button', { name: 'Zen mode' }).click()
  await expect(list).toBeHidden()
  await expect(nav).toBeHidden()

  // The X puts the list back; a reload also starts with zen off (it is not remembered).
  await page.getByRole('button', { name: 'Leave zen mode' }).click()
  await expect(list).toBeVisible()

  // Edit from zen opens the editor in zen too (its own, remembered setting; put it back after).
  await page.getByRole('button', { name: 'Zen mode' }).click()
  await page.getByRole('link', { name: 'Edit' }).click()
  await expect(list).toBeHidden()
  await page.getByRole('button', { name: 'Zen mode' }).click() // the editor's: off again
  await expect(list).toBeVisible()

  await page.goto(`/j/${journal.id}/entry/${entry.id}`)
  await page.getByRole('button', { name: 'Zen mode' }).click()
  await page.reload()
  await expect(list).toBeVisible()
})

// Back works like an app's: up through the screens, not through every page visited.
const title = (page: Page, name: string) => page.getByRole('heading', { level: 1, name })

test('the journals manager, opened from the menu, goes back to the list it came from', async ({
  page,
  journal,
}) => {
  await page.goto(`/j/${journal.id}`)
  await expect(title(page, journal.name)).toBeVisible()
  const nav = await openNav(page)
  await nav.getByRole('link', { name: 'Manage journals', exact: true }).click()
  await expect(title(page, 'Manage journals')).toBeVisible()

  // From 840px the Settings list sits beside the page instead of an arrow; Esc is the same Back.
  const arrow = page.getByRole('button', { name: 'Back', exact: true })
  if (await arrow.isVisible()) await arrow.click()
  else await page.keyboard.press('Escape')
  await expect(title(page, journal.name)).toBeVisible()
  // The arrow stepped back rather than stacking another page: the next Back is All Entries.
  await page.goBack()
  await expect(title(page, 'All Entries')).toBeVisible()
})

test('switching journals does not pile up history', async ({ page, api, journal }, info) => {
  const other = await api.createJournal({
    name: `Second ${info.project.name} ${Date.now() % 100000}`,
  })
  await page.goto('/')
  for (const j of [journal, other, journal]) {
    const nav = await openNav(page)
    await nav.getByRole('link', { name: j.name }).click()
    await expect(title(page, j.name)).toBeVisible()
    if (isPhone(info.project.name)) await expect(nav).toBeHidden() // let the drawer finish closing
  }
  await page.goBack()
  await expect(title(page, 'All Entries')).toBeVisible()
})

test('a deep link to an entry goes Back to its journal, then All Entries', async ({
  page,
  api,
  journal,
}, info) => {
  const { entry } = await api.createEntry({ journalId: journal.id, bodyMd: '# Linked in' })
  await page.goto(`/j/${journal.id}/entry/${entry.id}`)
  await expect(entryPane(page).getByRole('heading', { name: 'Linked in' })).toBeVisible()

  if (isPhone(info.project.name))
    await page.getByRole('button', { name: 'Back', exact: true }).click()
  else await page.goBack()
  await expect(title(page, journal.name)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/j/${journal.id}$`))
  await page.goBack()
  await expect(title(page, 'All Entries')).toBeVisible()
})

test('desktop: the Settings list swaps the page beside it without stacking', async ({
  page,
}, info) => {
  test.skip(isPhone(info.project.name), 'needs two panes')
  await page.goto('/settings')
  await expect(title(page, 'Account')).toBeVisible()
  const list = page.getByRole('region', { name: 'Settings' })
  await list.getByRole('link', { name: /^Appearance/ }).click()
  await expect(title(page, 'Appearance')).toBeVisible()
  await expect(list.getByRole('link', { name: /^Appearance/ })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await list.getByRole('link', { name: /^Manage tags/ }).click()
  await expect(title(page, 'Manage tags')).toBeVisible()
  // Each row replaced the page, so one Back leaves Settings.
  await page.goBack()
  await expect(title(page, 'All Entries')).toBeVisible()
})

test('a Settings subpage arrow returns to Settings without stacking', async ({ page }, info) => {
  test.skip(!isPhone(info.project.name), 'the list and the page take turns only on a phone')
  await page.goto('/settings')
  await page
    .getByRole('main')
    .getByRole('link', { name: /Manage tags/ })
    .click()
  await expect(title(page, 'Manage tags')).toBeVisible()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(title(page, 'Settings')).toBeVisible()
  await page.goBack()
  await expect(title(page, 'All Entries')).toBeVisible()
})

test('desktop: reading entries one after another keeps one Back to the list', async ({
  page,
  api,
  journal,
}, info) => {
  test.skip(isPhone(info.project.name), 'needs two panes')
  await api.createEntry({ journalId: journal.id, bodyMd: '# First read' })
  await api.createEntry({ journalId: journal.id, bodyMd: '# Second read' })
  await page.goto(`/j/${journal.id}`)
  for (const name of ['First read', 'Second read']) {
    await entriesPane(page)
      .getByRole('link', { name: new RegExp(name) })
      .click()
    await expect(entryPane(page).getByRole('heading', { name })).toBeVisible()
  }
  await page.goBack()
  await expect(entryPane(page)).toContainText('Select an entry to read it.')
})

test('the sidebar’s journal list does not scroll when it fits', async ({
  page,
  journal,
  isMobile,
}) => {
  test.skip(isMobile, 'the sidebar is desktop only')
  await page.goto(`/j/${journal.id}`)
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav).toBeVisible()
  // The tap targets' invisible hit areas once stuck out of the list and gave it a scrollbar.
  const overflowing = await nav.evaluate(
    (root) =>
      [...root.querySelectorAll<HTMLElement>('*')].filter(
        (el) =>
          /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
          el.scrollHeight - el.clientHeight > 0 &&
          el.scrollHeight - el.clientHeight <= 8,
      ).length,
  )
  expect(overflowing).toBe(0)
})
