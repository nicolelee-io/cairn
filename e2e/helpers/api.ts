// Seeds and inspects data through the real API, so tests set up their state without clicking
// through the UI. Every call carries the session from storageState.
import { expect, type APIRequestContext } from '@playwright/test'
import {
  uuidv7,
  type CreateEntry,
  type CreateJournal,
  type CreateTemplate,
  type Template,
  type Attachment,
  type EntryDetail,
  type Journal,
  type TimelinePage,
  type UpdateEntry,
} from '@cairn/shared'
import { BASE_URL } from '../env.ts'

// The server's CSRF guard wants an Origin matching the Host on writes, as a browser sends.
const headers = { Origin: BASE_URL }

export class Api {
  constructor(private request: APIRequestContext) {}

  async createJournal(body: CreateJournal): Promise<Journal> {
    const res = await this.request.post('/api/journals', { data: body, headers })
    expect(res.status(), await res.text()).toBe(201)
    return (await res.json()) as Journal
  }

  async createTemplate(body: CreateTemplate): Promise<Template> {
    const res = await this.request.post('/api/templates', { data: body, headers })
    expect(res.status(), await res.text()).toBe(201)
    return (await res.json()) as Template
  }

  /** Templates belong to the shared user, not a journal: a test deletes what it made. */
  async deleteTemplate(id: string) {
    await this.request.delete(`/api/templates/${id}`, { headers })
  }

  async listJournals(): Promise<Journal[]> {
    const res = await this.request.get('/api/journals')
    expect(res.status(), await res.text()).toBe(200)
    return (await res.json()) as Journal[]
  }

  async createEntry(body: Omit<CreateEntry, 'timezone'> & { timezone?: string }) {
    const data = { id: uuidv7(), timezone: 'America/Denver', ...body }
    const res = await this.request.post('/api/entries', { data, headers })
    expect(res.status(), await res.text()).toBe(201)
    return (await res.json()) as EntryDetail
  }

  /** Titles of a journal's entries as the server has them, newest first. */
  async timelineTitles(journalId: string): Promise<string[]> {
    const res = await this.request.get(`/api/entries?journalId=${journalId}`)
    expect(res.status(), await res.text()).toBe(200)
    const page = (await res.json()) as TimelinePage
    return page.items.map((i) => i.title)
  }

  async getEntry(id: string): Promise<EntryDetail> {
    const res = await this.request.get(`/api/entries/${id}`)
    expect(res.status(), await res.text()).toBe(200)
    return (await res.json()) as EntryDetail
  }

  /** Uploads a file (PDF bytes) as an attachment; an entry attaches it by naming its id in the text. */
  async uploadFile(name: string, bytes: Buffer): Promise<Attachment> {
    const res = await this.request.put(`/api/attachments?name=${encodeURIComponent(name)}`, {
      data: bytes,
      headers: { ...headers, 'Content-Type': 'application/pdf' },
    })
    expect(res.status(), await res.text()).toBe(201)
    return (await res.json()) as Attachment
  }

  /** Deletes an entry (it goes to the trash). */
  async deleteEntry(id: string) {
    const res = await this.request.delete(`/api/entries/${id}`, { headers })
    expect(res.status(), await res.text()).toBe(204)
  }

  /** Deletes a journal and its entries (to the trash). */
  async deleteJournal(id: string) {
    const res = await this.request.delete(`/api/journals/${id}`, { headers })
    expect(res.status(), await res.text()).toBe(204)
  }

  /** Status of restoring an entry from the trash (404 once it is gone for good). */
  async restoreEntryStatus(id: string): Promise<number> {
    return (await this.request.post(`/api/trash/entries/${id}/restore`, { headers })).status()
  }

  async updateEntry(id: string, body: UpdateEntry): Promise<EntryDetail> {
    const res = await this.request.patch(`/api/entries/${id}`, { data: body, headers })
    expect(res.status(), await res.text()).toBe(200)
    return (await res.json()) as EntryDetail
  }
}
