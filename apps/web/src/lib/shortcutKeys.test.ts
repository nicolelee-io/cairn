import { describe, expect, it } from 'vitest'
import { keyCaps, matchStep, parseSequence, parseStep, type KeyEventLike } from './shortcutKeys.ts'

const ev = (over: Partial<KeyEventLike>): KeyEventLike => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
})

describe('parseStep', () => {
  it('reads modifiers and the key', () => {
    expect(parseStep('Mod+Shift+F')).toEqual({ mod: true, alt: false, shift: true, key: 'F' })
    expect(parseStep('ArrowLeft')).toEqual({
      mod: false,
      alt: false,
      shift: false,
      key: 'ArrowLeft',
    })
    expect(parseStep('Mod++')).toEqual({ mod: true, alt: false, shift: false, key: '+' })
  })
  it('splits a chord into steps', () => {
    expect(parseSequence('g e').map((s) => s.key)).toEqual(['g', 'e'])
  })
})

describe('matchStep', () => {
  it('matches a bare letter, but not with a modifier held', () => {
    const n = parseStep('n')
    expect(matchStep(n, ev({ key: 'n', code: 'KeyN' }))).toBe(true)
    expect(matchStep(n, ev({ key: 'n', code: 'KeyN', ctrlKey: true }))).toBe(false)
    expect(matchStep(n, ev({ key: 'N', code: 'KeyN', shiftKey: true }))).toBe(false)
    expect(matchStep(n, ev({ key: 'n', code: 'KeyN', altKey: true }))).toBe(false)
  })
  it('matches ? whatever the layout needs for it', () => {
    const q = parseStep('?')
    expect(matchStep(q, ev({ key: '?', code: 'Slash', shiftKey: true }))).toBe(true)
    expect(matchStep(q, ev({ key: '?', code: 'Minus', shiftKey: true }))).toBe(true)
  })
  it('keeps Shift+/ apart from a plain /', () => {
    const s = parseStep('Shift+/')
    expect(matchStep(s, ev({ key: '/', code: 'Slash', shiftKey: true }))).toBe(true)
    expect(matchStep(s, ev({ key: '/', code: 'Slash' }))).toBe(false)
    expect(matchStep(parseStep('/'), ev({ key: '/', code: 'Slash' }))).toBe(true)
  })
  it('treats Ctrl and Cmd as Mod', () => {
    const s = parseStep('Mod+S')
    expect(matchStep(s, ev({ key: 's', code: 'KeyS', ctrlKey: true }))).toBe(true)
    expect(matchStep(s, ev({ key: 's', code: 'KeyS', metaKey: true }))).toBe(true)
    expect(matchStep(s, ev({ key: 's', code: 'KeyS' }))).toBe(false)
    expect(matchStep(s, ev({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true }))).toBe(false)
  })
  it('matches Alt and digit combos on the physical key', () => {
    expect(
      matchStep(
        parseStep('Alt+Shift+D'),
        ev({ key: '∂', code: 'KeyD', altKey: true, shiftKey: true }),
      ),
    ).toBe(true)
    expect(
      matchStep(
        parseStep('Mod+Shift+8'),
        ev({ key: '*', code: 'Digit8', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true)
    expect(
      matchStep(
        parseStep('Mod+Alt+1'),
        ev({ key: '1', code: 'Digit1', ctrlKey: true, altKey: true }),
      ),
    ).toBe(true)
  })
  it('matches named keys, and Shift must agree', () => {
    expect(matchStep(parseStep('ArrowLeft'), ev({ key: 'ArrowLeft' }))).toBe(true)
    expect(matchStep(parseStep('ArrowLeft'), ev({ key: 'ArrowLeft', shiftKey: true }))).toBe(false)
    expect(matchStep(parseStep('Escape'), ev({ key: 'Escape' }))).toBe(true)
    expect(matchStep(parseStep('Mod+Enter'), ev({ key: 'Enter', ctrlKey: true }))).toBe(true)
  })
})

describe('keyCaps', () => {
  it('draws Mod as Ctrl or Cmd', () => {
    expect(keyCaps('Mod+Shift+F', false)).toEqual([['Ctrl', 'Shift', 'F']])
    expect(keyCaps('Mod+Shift+F', true)).toEqual([['⌘', '⇧', 'F']])
  })
  it('draws a chord as separate steps and arrows as arrows', () => {
    expect(keyCaps('g e', false)).toEqual([['g'], ['e']])
    expect(keyCaps('ArrowRight', false)).toEqual([['→']])
  })
})
