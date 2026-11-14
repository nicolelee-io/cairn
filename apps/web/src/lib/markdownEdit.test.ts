import { describe, expect, it } from 'vitest'
import {
  bold,
  checklist,
  clearHeading,
  divider,
  italic,
  strikethrough,
  diffEdit,
  headingLevelAt,
  insertBlock,
  insertSnippet,
  link,
  moveBlock,
  prefixLines,
  wrap,
  type Edit,
} from './markdownEdit.ts'

/** Applies an edit the way the browser would, returning the text and the selected slice. */
function run(value: string, e: Edit) {
  const next = value.slice(0, e.from) + e.insert + value.slice(e.to)
  return { next, sel: next.slice(e.selStart, e.selEnd) }
}

describe('wrap', () => {
  it('wraps a selection and keeps it selected', () => {
    const r = run('a word b', wrap('a word b', 2, 6, '**', 'bold'))
    expect(r).toEqual({ next: 'a **word** b', sel: 'word' })
  })

  it('inserts a placeholder for a bare caret', () => {
    const r = run('', wrap('', 0, 0, '*', 'italic'))
    expect(r).toEqual({ next: '*italic*', sel: 'italic' })
  })

  it('unwraps an already wrapped selection', () => {
    const r = run('a **word** b', wrap('a **word** b', 4, 8, '**', 'bold'))
    expect(r).toEqual({ next: 'a word b', sel: 'word' })
  })
})

describe('italic, bold and strikethrough', () => {
  it('italicises with asterisks, which also work in the middle of a word', () => {
    expect(run('Acatmeow', italic('Acatmeow', 1, 4)).next).toBe('A*cat*meow')
  })
  it('takes apart the older underscore italic', () => {
    expect(run('a _word_ b', italic('a _word_ b', 3, 7))).toEqual({ next: 'a word b', sel: 'word' })
  })
  it('does not mistake half of a bold pair for italic', () => {
    // The inner asterisk of **word** is not an italic: italic on top makes it bold italic.
    expect(run('**word**', italic('**word**', 2, 6)).next).toBe('***word***')
    // And italic comes off bold italic, leaving the bold.
    expect(run('***word***', italic('***word***', 3, 7)).next).toBe('**word**')
    expect(run('***word***', bold('***word***', 3, 7)).next).toBe('*word*')
  })
  it('strikes through and back', () => {
    const struck = run('a word b', strikethrough('a word b', 2, 6))
    expect(struck).toEqual({ next: 'a ~~word~~ b', sel: 'word' })
    expect(run(struck.next, strikethrough(struck.next, 4, 8)).next).toBe('a word b')
  })
})

describe('divider', () => {
  it('is its own block after the line, never directly under text', () => {
    expect(run('line one', divider('line one', 0, 8)).next).toBe('line one\n\n---\n')
    expect(run('a\n\nb', divider('a\n\nb', 0, 1)).next.startsWith('a\n\n---')).toBe(true)
  })
  it('goes after the line, not into the middle of markup the selection is inside', () => {
    const v = 'x ~~old news~~'
    expect(run(v, divider(v, 4, 12)).next).toBe('x ~~old news~~\n\n---\n')
    const mid = 'first line\nsecond'
    expect(run(mid, divider(mid, 3, 3)).next).toBe('first line\n\n---\n\nsecond')
  })
})

describe('link', () => {
  it('selects the url placeholder after wrapping the selection', () => {
    expect(run('see this', link('see this', 4, 8))).toEqual({ next: 'see [this](url)', sel: 'url' })
  })
  it('inserts a template for a bare caret', () => {
    expect(run('', link('', 0, 0))).toEqual({ next: '[text](url)', sel: 'text' })
  })
})

describe('prefixLines', () => {
  it('adds a list marker to each non-empty selected line', () => {
    const v = 'one\ntwo\n\nthree'
    expect(run(v, prefixLines(v, 0, 8, '- ')).next).toBe('- one\n- two\n\nthree')
  })

  it('removes the marker when every line already has it', () => {
    const v = '- one\n- two'
    expect(run(v, prefixLines(v, 0, v.length, '- ')).next).toBe('one\ntwo')
  })

  it('works on the line holding a bare caret and keeps the caret in its text', () => {
    const v = 'first\nsecond'
    const e = prefixLines(v, 9, 9, '> ')
    const r = run(v, e)
    expect(r.next).toBe('first\n> second')
    expect(e.selStart).toBe(11)
  })

  it('replaces another heading level instead of stacking', () => {
    const v = '# Title'
    expect(run(v, prefixLines(v, 2, 2, '## ')).next).toBe('## Title')
  })

  it('does not touch the line a selection merely ends at the start of', () => {
    const v = 'one\ntwo'
    expect(run(v, prefixLines(v, 0, 4, '- ')).next).toBe('- one\ntwo')
  })
})

describe('headings', () => {
  it('reads the level of the caret line', () => {
    expect(headingLevelAt('# One\n## Two\nplain', 2)).toBe(1)
    expect(headingLevelAt('# One\n## Two\nplain', 8)).toBe(2)
    expect(headingLevelAt('# One\n## Two\nplain', 15)).toBe(0)
    expect(headingLevelAt('#hashtag', 0)).toBe(0)
  })
  it('clears the marker from every touched line and keeps the caret in place', () => {
    const e = clearHeading('## Two', 4, 4)
    expect(e.insert).toBe('Two')
    expect(e.selStart).toBe(1)
    expect(clearHeading('# A\n### B\nplain', 0, 14).insert).toBe('A\nB\nplain')
    expect(clearHeading('plain', 2, 2).insert).toBe('plain')
  })
})

describe('insertBlock', () => {
  const ref = '![](photo:a)'
  it('sets the photo apart on its own paragraph', () => {
    expect(insertBlock('hello world', 5, 5, ref).insert).toBe(`\n\n${ref}\n\n`)
    expect(insertBlock('', 0, 0, ref).insert).toBe(`${ref}\n`)
    expect(insertBlock('hi\n\nnext', 4, 4, ref)).toMatchObject({ insert: `${ref}\n\n` })
    expect(insertBlock('hi\n', 3, 3, ref).insert).toBe(`\n${ref}\n`)
  })
  it('replaces a selection and puts the caret after the photo', () => {
    const e = insertBlock('a SEL b', 2, 5, ref)
    expect(e).toMatchObject({ from: 2, to: 5 })
    expect(e.selStart).toBe(2 + e.insert.length)
  })
})

describe('insertSnippet', () => {
  const snippet = 'Best of:\n- \n- \n\nAs of: 3:28 PM'

  it('puts a one-line snippet in as typed, replacing a selection', () => {
    const r = run('Today: XX, done', insertSnippet('Today: XX, done', 7, 9, 'Friday'))
    expect(r.next).toBe('Today: Friday, done')
    const e = insertSnippet('Today: XX, done', 7, 9, 'Friday')
    expect([e.selStart, e.selEnd]).toEqual([13, 13])
  })

  it('does not glue a block onto the heading that follows it (the entry starts with the caret)', () => {
    const doc = '# Template test\n\nBody'
    const e = insertSnippet(doc, 0, 0, snippet)
    expect(run(doc, e).next).toBe(`${snippet}\n\n# Template test\n\nBody`)
    // The caret stays after the snippet, before the separating line breaks.
    expect(run(doc, e).next.slice(0, e.selStart)).toBe(snippet)
  })

  it('sets a block apart from the text before it, mid-line or at the end of a line', () => {
    expect(run('Hello', insertSnippet('Hello', 5, 5, '# Daily\n\nx')).next).toBe(
      'Hello\n\n# Daily\n\nx',
    )
    const doc = 'Hello world'
    expect(run(doc, insertSnippet(doc, 5, 5, '# Daily\n\nx')).next).toBe(
      'Hello\n\n# Daily\n\nx\n\n world',
    )
  })

  it('counts the line breaks already there: one before makes one more, a blank line none', () => {
    expect(run('Hello\n', insertSnippet('Hello\n', 6, 6, '- a\n- b')).next).toBe(
      'Hello\n\n- a\n- b',
    )
    expect(run('Hello\n\n', insertSnippet('Hello\n\n', 7, 7, '- a\n- b')).next).toBe(
      'Hello\n\n- a\n- b',
    )
    // The snippet's own edges count too.
    expect(run('Hello', insertSnippet('Hello', 5, 5, '\n\n- a\n- b\n\n')).next).toBe(
      'Hello\n\n- a\n- b\n\n',
    )
    expect(run('Hello\nWorld', insertSnippet('Hello\nWorld', 6, 6, '- a\n- b\n')).next).toBe(
      'Hello\n\n- a\n- b\n\nWorld',
    )
  })

  it('adds nothing at the start or end of an empty entry, keeping the snippet exactly', () => {
    const body = '# {{weekday}}\n\n'
    const e = insertSnippet('', 0, 0, body)
    expect(e.insert).toBe(body)
    expect(e.selStart).toBe(body.length)
  })

  it('treats a one-line heading, list item, quote, fence or table row as a block', () => {
    for (const s of ['# Title', '- item', '1. step', '> quote', '```js', '| a | b |'])
      expect(run('Hi', insertSnippet('Hi', 2, 2, s)).next).toBe(`Hi\n\n${s}`)
    expect(run('Hi', insertSnippet('Hi', 2, 2, 'plain words')).next).toBe('Hiplain words')
  })
})

describe('moveBlock', () => {
  const P = '![](photo:a)'
  const at = (v: string) => v.indexOf(P)
  const moved = (v: string, dir: -1 | 1) => {
    const e = moveBlock(v, at(v), dir)
    return e && run(v, e)
  }

  it('moves a photo above the paragraph before it', () => {
    expect(moved(`one\ntwo\n\n${P}\n\nthree`, -1)).toEqual({
      next: `${P}\n\none\ntwo\n\nthree`,
      sel: P,
    })
  })
  it('moves a photo below the paragraph after it', () => {
    expect(moved(`one\n\n${P}\n\ntwo\nmore\n\nthree`, 1)).toEqual({
      next: `one\n\ntwo\nmore\n\n${P}\n\nthree`,
      sel: P,
    })
  })
  it('skips over another photo as a block', () => {
    expect(moved(`![](photo:b)\n\n${P}\n`, -1)?.next).toBe(`${P}\n\n![](photo:b)\n`)
  })
  it('does nothing at the ends', () => {
    expect(moved(`${P}\n\nafter`, -1)).toBeNull()
    expect(moved(`before\n\n${P}\n`, 1)).toBeNull()
  })
  it('keeps a trailing newline when moving to the end', () => {
    expect(moved(`${P}\n\nlast\n`, 1)?.next).toBe(`last\n\n${P}\n`)
  })
})

describe('diffEdit', () => {
  it('finds the changed middle', () => {
    expect(diffEdit('abcXYZdef', 'abcdef')).toEqual({ from: 3, to: 6, insert: '' })
    expect(diffEdit('abc', 'abXc')).toEqual({ from: 2, to: 2, insert: 'X' })
  })
})

describe('checklist', () => {
  it('turns each non-empty line into an unticked item', () => {
    const v = 'one\ntwo\n\nthree'
    expect(run(v, checklist(v, 0, 8)).next).toBe('- [ ] one\n- [ ] two\n\nthree')
  })

  it('converts bullets and numbers instead of stacking markers, and keeps ticks', () => {
    const v = '- one\n2. two\n- [x] done'
    expect(run(v, checklist(v, 0, v.length)).next).toBe('- [ ] one\n- [ ] two\n- [x] done')
  })

  it('takes the marker off when every line is already an item', () => {
    const v = '- [ ] one\n- [X] two'
    expect(run(v, checklist(v, 0, v.length)).next).toBe('one\ntwo')
  })

  it('works on a bare caret and keeps it in its text', () => {
    const v = 'first\nsecond'
    const e = checklist(v, 9, 9)
    expect(run(v, e).next).toBe('first\n- [ ] second')
    expect(e.selStart).toBe(15)
  })
})
