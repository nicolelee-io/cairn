import { describe, expect, it } from 'vitest'
import { externalHref } from '../lib/externalHref.ts'
import { keepEmptyTasks } from './Markdown.tsx'

describe('externalHref', () => {
  it('adds https:// to a bare domain', () => {
    expect(externalHref('example.com')).toBe('https://example.com')
    expect(externalHref('www.example.co.uk/a?b=1')).toBe('https://www.example.co.uk/a?b=1')
    expect(externalHref('example.com:8080/x')).toBe('https://example.com:8080/x')
  })
  it('leaves schemes, paths, anchors and other text alone', () => {
    for (const h of [
      'https://a.com',
      'mailto:a@b.com',
      'tel:555',
      '/x',
      '#top',
      '?q=1',
      './a.b',
      'notes',
      undefined,
    ])
      expect(externalHref(h)).toBe(h)
  })
})

describe('keepEmptyTasks', () => {
  it('gives a box with no text something to hold, leaving the rest alone', () => {
    expect(keepEmptyTasks('- [ ] a\n- [x]\n  * [ ]  \n- [ ]b\ntext [ ]')).toBe(
      '- [ ] a\n- [x] \u00a0\n  * [ ] \u00a0\n- [ ]b\ntext [ ]',
    )
  })
})
