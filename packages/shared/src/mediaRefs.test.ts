import { describe, expect, it } from 'vitest'
import {
  attachmentMarkdown,
  attachmentRefs,
  photoMarkdown,
  photoRefs,
  stripAttachmentRef,
  stripPhotoRef,
  swapPhotoRefs,
} from './mediaRefs.ts'

const body = `intro\n\n${photoMarkdown('a')}\n\ntext ${photoMarkdown('b')} more\n\n![alt](photo:c)\n\n![x](https://e.com/p.png)`

describe('photo references', () => {
  it('lists photo ids in order, once, ignoring other images', () => {
    expect(photoRefs(body + photoMarkdown('a'))).toEqual(['a', 'b', 'c'])
  })

  it('strips a photo and the blank line it leaves', () => {
    expect(stripPhotoRef(`before\n\n${photoMarkdown('a')}\n\nafter`, 'a')).toBe('before\n\nafter')
    expect(stripPhotoRef(body, 'b')).toContain('text  more')
    expect(stripPhotoRef(body, 'zzz')).toBe(body)
  })

  it('swaps two photos in the text, whichever order they are named in', () => {
    const swapped = swapPhotoRefs(body, 'c', 'a')
    expect(photoRefs(swapped)).toEqual(['c', 'b', 'a'])
    expect(swapped).toBe(swapPhotoRefs(body, 'a', 'c'))
    expect(swapPhotoRefs(body, 'a', 'missing')).toBe(body)
  })
})

describe('attachment references', () => {
  it('are told apart from photos, and keep a safe file name in the alt text', () => {
    const md = attachmentMarkdown('f', 'a [b]\nc.pdf')
    expect(md).toBe('![a bc.pdf](attachment:f)')
    const text = `${photoMarkdown('p')}\n\n${md}\n\nend`
    expect(attachmentRefs(text)).toEqual(['f'])
    expect(photoRefs(text)).toEqual(['p'])
    expect(stripAttachmentRef(text, 'f')).toBe(`${photoMarkdown('p')}\n\nend`)
  })
})
