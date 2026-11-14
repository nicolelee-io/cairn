import type { Page } from '@playwright/test'
import { attachmentMarkdown } from '@cairn/shared'
import { expect, test } from './helpers/test.ts'
import { entriesPane, entryPane } from './helpers/ui.ts'

// A one-line PDF made on the fly: enough for the server to recognise, never a real document.
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
)
const at = (iso: string) => Date.parse(iso)
const view = (page: Page, name: string) => page.getByRole('radio', { name, exact: true })

/** How far the Entries screen is scrolled: the pane from 840px, the window on a phone. */
const scrolled = (page: Page) =>
  entriesPane(page).evaluate((el) =>
    getComputedStyle(el).overflowY === 'auto' ? el.scrollTop : window.scrollY,
  )

test('Details shows the description and the counts, by each entry’s own day', async ({
  page,
  api,
}, info) => {
  const journal = await api.createJournal({
    name: `Details ${info.project.name} ${Date.now() % 100000}`,
    description: 'Trips and paperwork.',
  })
  const file = await api.uploadFile('Warranty card.pdf', PDF)
  // Two entries on one local day (Denver), one on another; one carries a file.
  await api.createEntry({
    journalId: journal.id,
    bodyMd: '# One',
    createdAt: at('2026-03-04T15:00:00Z'),
  })
  await api.createEntry({
    journalId: journal.id,
    bodyMd: `# Two\n\n${attachmentMarkdown(file.id, file.filename)}`,
    createdAt: at('2026-03-04T20:00:00Z'),
  })
  await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Three',
    createdAt: at('2026-03-09T15:00:00Z'),
  })

  await page.goto(`/j/${journal.id}`)
  await view(page, 'Details').click()
  const pane = entriesPane(page)
  await expect(pane.getByRole('region', { name: 'Description' })).toHaveText('Trips and paperwork.')
  const tile = (label: string) => pane.locator('dl > div').filter({ hasText: label })
  await expect(tile('Entries')).toContainText('3')
  await expect(tile('Days')).toContainText('2')
  await expect(tile('Media')).toContainText('1')
  await expect(tile('Words')).toContainText('3')
  await expect(tile('First entry')).toContainText('Mar 4, 2026')
  await expect(tile('Latest entry')).toContainText('Mar 9, 2026')

  // All Entries has a default description.
  await page.goto('/')
  await expect(pane.getByRole('region', { name: 'Description' })).toContainText('across all your')

  // The choice holds after a reload (a per-device preference).
  await page.reload()
  await expect(view(page, 'Details')).toBeChecked()
})

test('Media lists a journal’s files, narrows by type, and a tile opens its entry', async ({
  page,
  api,
  journal,
}) => {
  const file = await api.uploadFile('Lease.pdf', PDF)
  await api.createEntry({
    journalId: journal.id,
    bodyMd: `# Moving day\n\n${attachmentMarkdown(file.id, file.filename)}`,
    createdAt: at('2026-02-14T15:00:00Z'),
  })
  await api.createEntry({ journalId: journal.id, bodyMd: '# No files here' })

  await page.goto(`/j/${journal.id}`)
  await view(page, 'Media').click()
  const tile = entriesPane(page).getByRole('link', { name: /^Lease\.pdf, 14 February 2026$/ })
  await expect(tile).toBeVisible()

  // A type with nothing of it empties the grid; PDF brings it back.
  const photos = entriesPane(page).getByRole('button', { name: 'Photos' })
  await photos.click()
  await expect(photos).toHaveAttribute('aria-pressed', 'true')
  await expect(tile).toBeHidden()
  await entriesPane(page).getByRole('button', { name: 'PDF' }).click()
  await photos.click()
  await expect(tile).toBeVisible()

  await tile.click()
  await expect(entryPane(page).getByRole('heading', { name: 'Moving day' })).toBeVisible()
})

test('Calendar fills in the days with entries; a day opens its entry', async ({
  page,
  api,
  journal,
}) => {
  await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Long ago',
    createdAt: at('2026-01-20T15:00:00Z'),
  })

  await page.goto(`/j/${journal.id}`)
  await view(page, 'Calendar').click()
  // A month fetches its days only once it is near the screen: go to January first.
  await entriesPane(page).getByRole('region', { name: 'January 2026' }).scrollIntoViewIfNeeded()
  const day = entriesPane(page).getByRole('button', {
    name: 'Tuesday, January 20, 2026: 1 entry',
  })
  await day.scrollIntoViewIfNeeded()
  await expect(day).toBeVisible()
  await day.click()
  await expect(entryPane(page).getByRole('heading', { name: 'Long ago' })).toBeVisible()
})

test('each view keeps its own scroll position', async ({ page, api, journal }) => {
  // An old entry makes the calendar long, and it opens scrolled to the current month.
  await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Oldest',
    createdAt: at('2024-01-10T15:00:00Z'),
  })

  // A list taller than the screen, or a stale offset from the calendar would just be clamped to 0.
  for (let i = 1; i <= 15; i++)
    await api.createEntry({
      journalId: journal.id,
      bodyMd: `# Filler ${i}`,
      createdAt: at(`2026-10-${String(i).padStart(2, '0')}T15:00:00Z`),
    })

  await page.goto(`/j/${journal.id}`)
  await expect(entriesPane(page).getByText('Oldest')).toBeVisible()
  expect(await scrolled(page)).toBe(0)

  await view(page, 'Calendar').click()
  await expect.poll(() => scrolled(page)).toBeGreaterThan(500)
  await view(page, 'List').click()
  await expect.poll(() => scrolled(page)).toBe(0)

  // And back: the calendar is where it was left, not at the top.
  await view(page, 'Calendar').click()
  await expect.poll(() => scrolled(page)).toBeGreaterThan(500)
})

test('the calendar opens on the current month when reached from a scrolled list', async ({
  page,
  api,
  journal,
}) => {
  await api.createEntry({
    journalId: journal.id,
    bodyMd: '# Oldest',
    createdAt: at('2024-01-10T15:00:00Z'),
  })
  for (let i = 1; i <= 15; i++)
    await api.createEntry({
      journalId: journal.id,
      bodyMd: `# Filler ${i}`,
      createdAt: at(`2026-10-${String(i).padStart(2, '0')}T15:00:00Z`),
    })

  // A fresh load has no calendar months cached, so the page is short while they load: the scroll
  // the list left behind is clamped to nothing there, and that must not count as a place to return to.
  await page.goto(`/j/${journal.id}`)
  await view(page, 'List').click()
  await entriesPane(page).getByText('Filler 1', { exact: true }).scrollIntoViewIfNeeded()
  await expect.poll(() => scrolled(page)).toBeGreaterThan(200)
  await view(page, 'Calendar').click()
  await expect.poll(() => scrolled(page)).toBeGreaterThan(500)
})

/** A one-finger drag across the Entries screen, as touch pointer events (what a phone sends). */
const swipe = (page: Page, dx: number, fromX = 200, y = 400) =>
  page.evaluate(
    ({ dx, fromX, y }) => {
      const target = document.elementFromPoint(fromX, y) ?? document.body
      const fire = (type: string, x: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
          }),
        )
      fire('pointerdown', fromX)
      fire('pointerup', fromX + dx)
    },
    { dx, fromX, y },
  )

test('swiping the Entries screen steps through the views; the map is entered but not left', async ({
  page,
  journal,
  isMobile,
}) => {
  test.skip(!isMobile, 'a touch gesture')
  await page.goto(`/j/${journal.id}`)
  await view(page, 'List').click()

  await swipe(page, -120) // finger moves left: the next view
  await expect(view(page, 'Calendar')).toBeChecked()
  await swipe(page, 120)
  await expect(view(page, 'List')).toBeChecked()
  await swipe(page, 120) // Details
  await expect(view(page, 'Details')).toBeChecked()
  await swipe(page, 120) // the first view: nowhere further
  await expect(view(page, 'Details')).toBeChecked()

  await swipe(page, 20, 200) // too short
  await expect(view(page, 'Details')).toBeChecked()
  await swipe(page, -120, 8) // starts at the screen's edge
  await expect(view(page, 'Details')).toBeChecked()

  await view(page, 'Media').click()
  await swipe(page, -120)
  await expect(view(page, 'Map')).toBeChecked()
  await swipe(page, 120) // the map keeps its own gestures
  await expect(view(page, 'Map')).toBeChecked()
})
