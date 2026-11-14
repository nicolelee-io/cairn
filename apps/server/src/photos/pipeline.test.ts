import sharp from 'sharp'
import exifReader from 'exif-reader'
import { describe, expect, it } from 'vitest'
import { DISPLAY_EDGE, THUMB_EDGE, processImage } from './pipeline.ts'

const solid = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#7b7b45' } })

describe('processImage', () => {
  it('resizes to the display and thumb edges and outputs WebP', async () => {
    const jpeg = await solid(3000, 2000).jpeg().toBuffer()
    const r = await processImage(jpeg)
    expect(r).toMatchObject({ width: 3000, height: 2000 })
    const d = await sharp(r.display).metadata()
    const t = await sharp(r.thumb).metadata()
    expect(d).toMatchObject({
      format: 'webp',
      width: DISPLAY_EDGE,
      height: Math.round((2000 * DISPLAY_EDGE) / 3000),
    })
    expect(t).toMatchObject({ format: 'webp', width: THUMB_EDGE })
  })

  it('never upscales a small image', async () => {
    const r = await processImage(await solid(300, 200).png().toBuffer())
    expect(await sharp(r.display).metadata()).toMatchObject({ width: 300, height: 200 })
    expect(await sharp(r.thumb).metadata()).toMatchObject({ width: 300, height: 200 })
  })

  it('applies EXIF orientation and reports the displayed size', async () => {
    // Orientation 6 = stored landscape, displayed portrait.
    const jpeg = await solid(3000, 2000).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    const r = await processImage(jpeg)
    expect(r).toMatchObject({ width: 2000, height: 3000 })
    const d = await sharp(r.display).metadata()
    expect(d.width).toBeLessThan(d.height!)
    expect(d.height).toBe(DISPLAY_EDGE)
  })

  it('reads GPS and a UTC-corrected date from EXIF, and strips both from derivatives', async () => {
    const jpeg = await solid(800, 600)
      .withExif({
        IFD0: { Orientation: '1' },
        IFD2: { DateTimeOriginal: '2024:06:01 12:30:00', OffsetTimeOriginal: '-06:00' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '47/1 36/1 0/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '122/1 18/1 0/1',
        },
      })
      .jpeg()
      .toBuffer()
    const r = await processImage(jpeg)
    expect(r.takenAt).toBe(Date.parse('2024-06-01T18:30:00Z'))
    expect(r.latitude).toBeCloseTo(47.6, 5)
    expect(r.longitude).toBeCloseTo(-122.3, 5)

    for (const derivative of [r.display, r.thumb]) {
      const m = await sharp(derivative).metadata()
      expect(m.exif).toBeUndefined()
    }
    // Sanity: the source really did carry GPS, so the assertion above is meaningful.
    expect(exifReader((await sharp(jpeg).metadata()).exif!).GPSInfo?.GPSLatitude).toBeDefined()
  })

  it('leaves takenAt null when the file does not record its UTC offset', async () => {
    const jpeg = await solid(100, 100)
      .withExif({ IFD2: { DateTimeOriginal: '2024:06:01 12:30:00' } })
      .jpeg()
      .toBuffer()
    expect((await processImage(jpeg)).takenAt).toBeNull()
  })

  it('returns nulls for an image with no EXIF', async () => {
    const r = await processImage(await solid(100, 100).png().toBuffer())
    expect(r).toMatchObject({ takenAt: null, latitude: null, longitude: null })
  })

  it('rejects bytes that are not an image', async () => {
    await expect(processImage(Buffer.from('not an image'))).rejects.toThrow()
  })
})
