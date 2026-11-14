// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadDraft, saveDraft } from '../../lib/draft.ts'
import { detail, journal } from './testFixtures.ts'
import { fieldsOf, useEntryDraft, type EditorSource } from './useEntryDraft.ts'

const USER = 'u1'
const journals = [journal('j1'), journal('j2')]
const edit = (d = detail()): EditorSource => ({ kind: 'edit', detail: d })
const open = (source: EditorSource, js = journals) =>
  renderHook(() => useEntryDraft({ userId: USER, journals: js, source }))

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('restoring a draft', () => {
  it('starts from the entry when there is no draft', () => {
    const { result } = open(edit())
    expect(result.current.fields).toEqual(fieldsOf(detail()))
    expect(result.current.dirty).toBe(false)
    expect(result.current.wasRestored).toBe(false)
    expect(result.current.baseRev).toBe(3)
  })

  it('lays a saved draft over the entry, keeping its base revision', () => {
    const base = fieldsOf(detail())
    saveDraft(USER, 'e1', { ...base, bodyMd: 'typed offline', newId: null, baseRev: 2 })
    const { result } = open(edit())
    expect(result.current.fields.bodyMd).toBe('typed offline')
    expect(result.current.baseline.bodyMd).toBe('hello')
    expect(result.current.baseRev).toBe(2)
    expect(result.current.wasRestored).toBe(true)
    expect(result.current.dirty).toBe(true)
  })

  it('ignores a draft identical to the entry', () => {
    saveDraft(USER, 'e1', { ...fieldsOf(detail()), newId: null, baseRev: 3 })
    expect(open(edit()).result.current.wasRestored).toBe(false)
  })

  it('falls back to the entry’s journal when the draft’s journal is gone', () => {
    saveDraft(USER, 'e1', {
      ...fieldsOf(detail()),
      bodyMd: 'edited',
      journalId: 'archived-journal',
      newId: null,
      baseRev: 3,
    })
    const { result } = open(edit())
    expect(result.current.fields.journalId).toBe('j1')
    expect(result.current.fields.bodyMd).toBe('edited')
  })

  it('keeps the draft’s journal while it is still active', () => {
    saveDraft(USER, 'e1', {
      ...fieldsOf(detail()),
      bodyMd: 'edited',
      journalId: 'j2',
      newId: null,
      baseRev: 3,
    })
    expect(open(edit()).result.current.fields.journalId).toBe('j2')
  })
})

describe('a new entry', () => {
  it('mints an id and has no base revision', () => {
    const { result } = open({ kind: 'new', journalId: 'j1' })
    expect(result.current.isNew).toBe(true)
    expect(result.current.newId).toBeTruthy()
    expect(result.current.baseRev).toBeNull()
  })

  it('resumes the draft kept under its id', () => {
    const first = open({ kind: 'new', journalId: 'j1', draftId: 'slot-1' })
    act(() => first.result.current.set({ bodyMd: 'half written' }))
    first.unmount() // leaving keeps what was typed
    expect(loadDraft(USER, 'slot-1')?.bodyMd).toBe('half written')

    const again = open({ kind: 'new', journalId: 'j1', draftId: 'slot-1' })
    expect(again.result.current.fields.bodyMd).toBe('half written')
    expect(again.result.current.newId).toBe('slot-1')
  })

  it('starts from the prompt heading without being dirty', () => {
    const { result } = open({ kind: 'new', journalId: 'j1', prompt: 'What went well?' })
    expect(result.current.fields.bodyMd).toBe('# What went well?\n\n')
    expect(result.current.dirty).toBe(false)
  })
})

describe('settling and adopting', () => {
  it('settle drops the draft and a later unmount does not bring it back', () => {
    const { result, unmount } = open(edit())
    act(() => result.current.set({ bodyMd: 'changed' }))
    act(() => result.current.settle())
    unmount()
    expect(loadDraft(USER, 'e1')).toBeNull()
  })

  it('adoptTheirs makes the server’s copy both baseline and text', () => {
    const { result } = open(edit())
    act(() => result.current.set({ bodyMd: 'mine' }))
    act(() => result.current.adoptTheirs(detail({ bodyMd: 'theirs', rev: 7 })))
    expect(result.current.fields.bodyMd).toBe('theirs')
    expect(result.current.baseline.bodyMd).toBe('theirs')
    expect(result.current.baseRev).toBe(7)
    expect(result.current.dirty).toBe(false)
  })

  it('adoptSaved keeps newer typing but moves the baseline', () => {
    const { result } = open(edit())
    const sent = { ...result.current.fields, bodyMd: 'sent' }
    act(() => result.current.set({ bodyMd: 'sent and then some' }))
    act(() => result.current.adoptSaved(detail({ bodyMd: 'sent', rev: 4 }), sent))
    expect(result.current.baseline.bodyMd).toBe('sent')
    expect(result.current.fields.bodyMd).toBe('sent and then some')
    expect(result.current.baseRev).toBe(4)
  })

  it('resetToBaseline discards edits', () => {
    const { result } = open(edit())
    act(() => result.current.set({ bodyMd: 'oops' }))
    act(() => result.current.resetToBaseline())
    expect(result.current.fields.bodyMd).toBe('hello')
    expect(result.current.dirty).toBe(false)
  })
})
