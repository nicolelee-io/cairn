import type { EntryDetail, Journal } from '@cairn/shared'

export const journal = (id: string): Journal => ({
  id,
  name: id,
  color: null,
  icon: null,
  description: null,
  archivedAt: null,
  sortOrder: 0,
  createdAt: 0,
  rev: 1,
  entryCount: 0,
})

export const detail = (over: Partial<EntryDetail['entry']> = {}): EntryDetail => ({
  entry: {
    id: 'e1',
    journalId: 'j1',
    bodyMd: 'hello',
    createdAt: 1_700_000_000_000,
    modifiedAt: 1_700_000_000_000,
    timezone: 'America/Denver',
    starred: false,
    pinned: false,
    allDay: false,
    mood: null,
    moodSuggested: null,
    creationDevice: null,
    source: 'native',
    rev: 3,
    ...over,
  },
  location: null,
  weather: null,
  tags: [],
  photos: [],
  attachments: [],
})
