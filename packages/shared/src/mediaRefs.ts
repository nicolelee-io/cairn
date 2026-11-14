// Entry text refers to its media as `![](photo:<id>)` and `![name](attachment:<id>)`. The server
// keeps photo and attachment rows in line with those references on save; the editor uses the same
// helpers to insert, remove and reorder them.

/** Non-photo files, by what Day One accepts: PDF, MP4/MOV video, M4A audio. */
export const ATTACHMENT_KINDS = ['video', 'audio', 'pdf'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

function refHelpers(scheme: string) {
  const ref = () => new RegExp(`!\\[[^\\]]*\\]\\(${scheme}:([A-Za-z0-9-]+)\\)`, 'g')
  return {
    /** Rewrites every reference through `fn` (an empty string removes it); other text is untouched. */
    replace: (body: string, fn: (id: string) => string): string =>
      body.replace(ref(), (_m, id: string) => fn(id)),

    /** Ids a body references, in order of first appearance. */
    refs: (body: string): string[] => [...new Set([...body.matchAll(ref())].map((m) => m[1]!))],

    /**
     * The body without its references to `id`: a reference alone on its line takes the line (and
     * the blank line it leaves) with it; one inside a sentence is removed on its own.
     */
    strip(body: string, id: string): string {
      const token = `!\\[[^\\]]*\\]\\(${scheme}:${id}\\)`
      return body
        .replace(new RegExp(`^[ \\t]*${token}[ \\t]*\\n?`, 'gm'), '')
        .replace(new RegExp(token, 'g'), '')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd()
    },

    /** Swaps where two references sit in the text (their first occurrences trade places). */
    swap(body: string, a: string, b: string): string {
      const first = (id: string) => [...body.matchAll(ref())].find((m) => m[1] === id)
      const [x, y] = [first(a), first(b)]
      if (!x || !y) return body
      const [early, late] = x.index < y.index ? [x, y] : [y, x]
      return (
        body.slice(0, early.index) +
        late[0] +
        body.slice(early.index + early[0].length, late.index) +
        early[0] +
        body.slice(late.index + late[0].length)
      )
    },
  }
}

const photo = refHelpers('photo')
const attachment = refHelpers('attachment')

export const photoMarkdown = (id: string) => `![](photo:${id})`
export const replacePhotoRefs = photo.replace
export const photoRefs = photo.refs
export const stripPhotoRef = photo.strip
export const swapPhotoRefs = photo.swap

/** The file name goes in the alt text, minus what would break the markdown. */
export const attachmentMarkdown = (id: string, filename: string) =>
  `![${filename.replace(/[[\]\n\r]/g, '').trim()}](attachment:${id})`
export const replaceAttachmentRefs = attachment.replace
export const attachmentRefs = attachment.refs
export const stripAttachmentRef = attachment.strip
export const swapAttachmentRefs = attachment.swap
