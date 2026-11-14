import { describe, expect, it } from 'vitest'
import type { Template } from '@cairn/shared'
import { matchItems, type InsertContext, type InsertItem } from './insertItems.ts'
import { expandTemplate, suggestedName, templateItems, withoutMedia } from './templateText.ts'

// 2026-11-06 23:30 in New York (already the 7th in UTC and in Tokyo).
const NY: InsertContext = { now: Date.UTC(2026, 10, 7, 4, 30), timezone: 'America/New_York' }

describe('expandTemplate', () => {
  it('fills each placeholder from the moment, on the entry timezone’s clock', () => {
    expect(expandTemplate('{{date}}', NY)).toBe('11/6/2026')
    expect(expandTemplate('{{time}}', NY)).toBe('11:30 PM')
    expect(expandTemplate('{{datetime}}', NY)).toBe('11/6/2026, 11:30 PM')
    expect(expandTemplate('{{weekday}}', NY)).toBe('Friday')
    const tokyo = { ...NY, timezone: 'Asia/Tokyo' }
    expect(expandTemplate('{{weekday}} {{date}}', tokyo)).toBe('Saturday 11/7/2026')
  })

  it('works inside a longer text and fills every occurrence', () => {
    expect(expandTemplate('# {{weekday}}, {{date}}\n\nSlept well.\n\n{{date}}', NY)).toBe(
      '# Friday, 11/6/2026\n\nSlept well.\n\n11/6/2026',
    )
  })

  it('ignores case and spaces inside the braces', () => {
    expect(expandTemplate('{{ Date }} {{WEEKDAY}}', NY)).toBe('11/6/2026 Friday')
  })

  it('leaves anything it does not know as typed', () => {
    const text = '{{name}} {{ date }}} {date} {{}} {{ 1 }} {{date'
    expect(expandTemplate(text, NY)).toBe('{{name}} 11/6/2026} {date} {{}} {{ 1 }} {{date')
  })

  it('leaves a text with no placeholder exactly as it was', () => {
    const body = '  # Title\n\n- [ ] one\n\n```\ncode {{x}}\n```\n\n'
    expect(expandTemplate(body, NY)).toBe(body)
  })
})

describe('withoutMedia', () => {
  const photo = '![](photo:0194f2c8-1111-7222-8333-444455556666)'
  const file = '![Report.pdf](attachment:0194f2c8-aaaa-7bbb-8ccc-ddddeeeeffff)'

  it('takes out photos and files, with the line and blank line a lone reference leaves', () => {
    const body = `# Trip\n\n${photo}\n\nWe walked.\n\n${file}\n\nHome.`
    expect(withoutMedia(body)).toBe('# Trip\n\nWe walked.\n\nHome.')
  })

  it('removes one inside a sentence on its own, and leaves other images and text alone', () => {
    const body = `Look ${photo} here, and ![a cat](https://example.com/c.png) too.`
    expect(withoutMedia(body)).toBe('Look  here, and ![a cat](https://example.com/c.png) too.')
  })

  it('leaves a text with no media exactly as it was, placeholders included', () => {
    const body = '# {{weekday}}\n\n- one\n\n'
    expect(withoutMedia(body)).toBe(body)
  })

  it('is blank when the entry was only media', () => {
    expect(withoutMedia(`${photo}\n\n${file}`).trim()).toBe('')
  })
})

describe('suggestedName', () => {
  it('is the entry title, empty without one, and never past the name limit', () => {
    expect(suggestedName('# Daily log\n\nBody')).toBe('Daily log')
    expect(suggestedName('')).toBe('')
    expect(suggestedName(`# ${'x'.repeat(200)}\n\nBody`).length).toBeLessThanOrEqual(80)
  })
})

describe('templateItems', () => {
  const list: Template[] = [
    { id: 'a', name: 'Daily log', bodyMd: '# {{date}}\n\n', createdAt: 1, updatedAt: 1 },
    { id: 'b', name: 'Gratitude', bodyMd: '1. \n2. \n3. ', createdAt: 2, updatedAt: 2 },
  ]
  const items = templateItems(list)

  it('is one item per template, in its own group, found by name or by "template"', () => {
    expect(items.map((i) => [i.id, i.label, i.group])).toEqual([
      ['template:a', 'Daily log', 'Templates'],
      ['template:b', 'Gratitude', 'Templates'],
    ])
    expect(matchItems(items, 'grat').map((i) => i.id)).toEqual(['template:b'])
    expect(matchItems(items, 'dailylog').map((i) => i.id)).toEqual(['template:a'])
    expect(matchItems(items, 'template')).toHaveLength(2)
  })

  const apply = (item: InsertItem, value: string, start: number, end = start) => {
    const e = item.build(value, start, end, NY)
    return { next: value.slice(0, e.from) + e.insert + value.slice(e.to), e }
  }

  it('inserts the expanded text at the caret, replacing a selection, caret after it', () => {
    const inline: Template = {
      id: 'c',
      name: 'Sign-off',
      bodyMd: 'Until {{weekday}}',
      createdAt: 3,
      updatedAt: 3,
    }
    const { next, e } = apply(templateItems([inline])[0]!, 'Bye XX now', 4, 6)
    expect(next).toBe('Bye Until Friday now')
    expect([e.from, e.to]).toEqual([4, 6])
    expect([e.selStart, e.selEnd]).toEqual([4 + 'Until Friday'.length, 4 + 'Until Friday'.length])
  })

  it('sets a multi-line template apart from the text around it, never gluing onto the next line', () => {
    // The caret at the very start, above a title: the case that used to turn "# Title" into text.
    const top = apply(items[0]!, '# Title\n\nBody', 0)
    expect(top.next).toBe('# 11/6/2026\n\n# Title\n\nBody')
    // In the middle of a line, a blank line each side.
    expect(apply(items[0]!, 'Before after', 7).next).toBe('Before \n\n# 11/6/2026\n\nafter')
  })
})
