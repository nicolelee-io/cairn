import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { clearLocalCopy, deleteLocalDb, localDb, type LocalEntry } from './localDb.ts'

afterEach(async () => {
  await Promise.all(['u1', 'u2'].map(deleteLocalDb))
})

const entry = (id: string, journalId: string, createdAt: number): LocalEntry => ({
  id,
  journalId,
  createdAt,
  entry: {
    id,
    journalId,
    bodyMd: id,
    createdAt,
    modifiedAt: createdAt,
    timezone: 'UTC',
    starred: false,
    pinned: false,
    allDay: false,
    mood: null,
    moodSuggested: null,
    creationDevice: null,
    source: 'native',
    rev: 1,
  },
  location: null,
  weather: null,
  tags: [],
})

describe('local database', () => {
  it('keeps each user in their own database', async () => {
    await localDb('u1').entries.put(entry('e1', 'j1', 1))
    expect(await localDb('u2').entries.count()).toBe(0)
    expect(localDb('u1').name).not.toBe(localDb('u2').name)
  })

  it('lists a journal newest first through the compound index', async () => {
    const db = localDb('u1')
    await db.entries.bulkPut([entry('a', 'j1', 1), entry('b', 'j1', 3), entry('c', 'j2', 2)])
    const rows = await db.entries
      .where('[journalId+createdAt]')
      .between(['j1', -Infinity], ['j1', Infinity])
      .reverse()
      .toArray()
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('signing out drops the synced copy but keeps saves waiting to be sent', async () => {
    const db = localDb('u1')
    await db.entries.put(entry('e1', 'j1', 1))
    await db.meta.put({ key: 'cursor', value: 5 })
    await db.outbox.add({
      target: 'new',
      entryId: 'n1',
      method: 'POST',
      path: '/entries',
      body: {},
      queuedAt: 1,
      draft: {},
    })
    await clearLocalCopy('u1')
    expect(await db.entries.count()).toBe(0)
    expect(await db.meta.count()).toBe(0)
    expect(await db.outbox.count()).toBe(1)
  })
})
