import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadAttachment } from './upload.ts'

/** Answers every request with the given status and body as soon as it is sent. */
function fakeXhr(status: number, responseText: string) {
  vi.stubGlobal(
    'XMLHttpRequest',
    class {
      status = status
      responseText = responseText
      upload = {}
      onload: (() => void) | null = null
      open() {}
      send() {
        this.onload?.()
      }
    },
  )
}

const failure = () => uploadAttachment(new File(['x'], 'a.pdf')).catch((e: Error) => e.message)

afterEach(() => vi.unstubAllGlobals())

describe('upload errors', () => {
  it.each([502, 503, 504, 521, 530])('a gateway %i reads as unreachable', async (status) => {
    fakeXhr(status, '<html>Bad gateway</html>')
    expect(await failure()).toBe('Couldn’t reach the server. Check your connection.')
  })

  it('keeps the message the server gives', async () => {
    fakeXhr(415, JSON.stringify({ message: 'Only JPEG, PNG and so on.' }))
    expect(await failure()).toBe('Only JPEG, PNG and so on.')
  })

  it('still says the upload failed on other errors', async () => {
    fakeXhr(500, 'oops')
    expect(await failure()).toBe('The upload failed. Try again.')
  })
})
