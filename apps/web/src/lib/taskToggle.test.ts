import { describe, expect, it } from 'vitest'
import { toggleTaskLine } from './taskToggle.ts'

describe('toggleTaskLine', () => {
  const body =
    'Shopping\n\n- [ ] milk\n- [x] eggs\n  - [ ] free range\n1. [X] numbered\n> - [ ] quoted'
  it('ticks and unticks one box and nothing else', () => {
    expect(toggleTaskLine(body, 3)).toBe(body.replace('- [ ] milk', '- [x] milk'))
    expect(toggleTaskLine(body, 4)).toBe(body.replace('- [x] eggs', '- [ ] eggs'))
    expect(toggleTaskLine(body, 5)).toBe(body.replace('[ ] free', '[x] free'))
    expect(toggleTaskLine(body, 6)).toBe(body.replace('[X]', '[ ]'))
    expect(toggleTaskLine(body, 7)).toBe(body.replace('> - [ ]', '> - [x]'))
  })
  it('refuses a line without a box', () => {
    expect(toggleTaskLine(body, 1)).toBeNull()
    expect(toggleTaskLine(body, 99)).toBeNull()
    expect(toggleTaskLine('- [ ]', 1)).toBe('- [x]')
  })
})
