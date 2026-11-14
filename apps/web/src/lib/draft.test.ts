import { describe, expect, it } from 'vitest'
import { clearDraft, listDrafts, loadDraft, sameFields, saveDraft } from './draft.ts'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

const fields = {
  newId: null,
  journalId: 'j1',
  bodyMd: 'hello',
  createdAt: 1_000,
  timezone: 'UTC',
  allDay: false,
  starred: false,
  pinned: false,
  mood: null,
  location: null,
  weather: null,
  tags: [],
  baseRev: 3,
}

describe('drafts', () => {
  it("lists one user's drafts, newest first, ignoring other keys and junk", () => {
    const s = fakeStorage()
    saveDraft('u1', 'new', { ...fields, baseRev: null }, s)
    saveDraft('u1', 'e1', fields, s)
    saveDraft('u2', 'e9', fields, s)
    s.setItem('cairn:draft:u1:bad', '{nope')
    s.setItem('other', 'x')
    const got = listDrafts('u1', s)
    expect(got.map((d) => d.target).sort()).toEqual(['e1', 'new'])
    expect(got[0]!.draft.savedAt).toBeGreaterThanOrEqual(got[1]!.draft.savedAt)
  })

  it('round-trips a draft', () => {
    const s = fakeStorage()
    expect(saveDraft('u1', 'e1', fields, s)).toBe(true)
    expect(loadDraft('u1', 'e1', s)).toMatchObject({ ...fields, v: 1 })
  })

  it('keeps users and targets apart', () => {
    const s = fakeStorage()
    saveDraft('u1', 'new', fields, s)
    expect(loadDraft('u2', 'new', s)).toBeNull()
    expect(loadDraft('u1', 'e1', s)).toBeNull()
  })

  it('clears', () => {
    const s = fakeStorage()
    saveDraft('u1', 'new', fields, s)
    clearDraft('u1', 'new', s)
    expect(loadDraft('u1', 'new', s)).toBeNull()
  })

  it('ignores corrupt or foreign data instead of throwing', () => {
    const s = fakeStorage()
    s.setItem('cairn:draft:u1:new', '{not json')
    expect(loadDraft('u1', 'new', s)).toBeNull()
    s.setItem('cairn:draft:u1:new', JSON.stringify({ v: 2 }))
    expect(loadDraft('u1', 'new', s)).toBeNull()
  })

  it('degrades quietly with no storage', () => {
    expect(saveDraft('u1', 'new', fields, null)).toBe(false)
    expect(loadDraft('u1', 'new', null)).toBeNull()
  })
})

describe('sameFields', () => {
  it('compares every editable field', () => {
    expect(sameFields(fields, { ...fields })).toBe(true)
    expect(sameFields(fields, { ...fields, mood: 'calm' })).toBe(false)
    expect(sameFields(fields, { ...fields, pinned: true })).toBe(false)
  })
})
