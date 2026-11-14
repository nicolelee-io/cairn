import { z } from 'zod'
import {
  attachmentMarkdown,
  mapDayOneWeather,
  MoodSchema,
  WeatherConditionSchema,
  WeatherSourceSchema,
  type AttachmentKind,
} from '@cairn/shared'
import type { NewLocation, NewWeather } from '../../repo/imports.ts'

// Shapes come from a real export (docs/dayone-export-format.md). Everything beyond the keys we
// need is optional and passed through, since the whole entry is kept in source_raw regardless.
const num = z.number()
// The `cairn` objects our own export adds (docs/export-format.md). Every field is optional and a
// malformed one is dropped rather than failing the entry, so a hand-edited export still imports.
const extra = <T extends z.ZodTypeAny>(t: T) => t.optional().catch(undefined)
const lenient = <S extends z.ZodRawShape>(shape: S) => extra(z.looseObject(shape))
const nullableNum = extra(z.number().nullable())
const nullableStr = extra(z.string().nullable())

const MediaSchema = z.looseObject({
  cairn: lenient({
    takenAt: nullableNum,
    latitude: nullableNum,
    longitude: nullableNum,
    filename: extra(z.string().min(1)),
  }),
  identifier: z.string(),
  md5: z.string(),
  type: z.string(),
  width: num.optional(),
  height: num.optional(),
  date: z.string().optional(),
  orderInEntry: num.optional(),
  /** PDFs only: the name without its extension. */
  pdfName: z.string().optional(),
})
export type DayOneMedia = z.infer<typeof MediaSchema>

const LocationSchema = z.looseObject({
  cairn: lenient({ userLabel: nullableStr, googlePlaceId: nullableStr }),
  latitude: num,
  longitude: num,
  placeName: z.string().optional(),
  localityName: z.string().optional(),
  administrativeArea: z.string().optional(),
  country: z.string().optional(),
  address: z.string().optional(),
  fullAddress: z.string().optional(),
  userLabel: z.string().optional(),
})

const WeatherSchema = z.looseObject({
  cairn: lenient({
    source: extra(WeatherSourceSchema),
    condition: extra(WeatherConditionSchema),
    isDay: extra(z.boolean().nullable()),
    feelsLikeC: nullableNum,
    sourceCode: nullableStr,
    fetchedAt: nullableNum,
  }),
  weatherCode: z.string(),
  temperatureCelsius: num.optional(),
  pressureMB: num.optional(),
  relativeHumidity: num.optional(),
  windSpeedKPH: num.optional(),
  windBearing: num.optional(),
  visibilityKM: num.optional(),
  conditionsDescription: z.string().optional(),
  sunriseDate: z.string().optional(),
  sunsetDate: z.string().optional(),
})

export const DayOneEntrySchema = z.looseObject({
  cairn: lenient({
    id: extra(z.string()),
    source: extra(z.enum(['native', 'dayone'])),
    mood: extra(MoodSchema.nullable()),
    moodSuggested: extra(z.number().int().min(1).max(5).nullable()),
    moodSuggestedBy: nullableStr,
    createdAt: extra(z.number()),
    modifiedAt: extra(z.number()),
  }),
  uuid: z.string().min(1),
  creationDate: z.string(),
  modifiedDate: z.string().optional(),
  timeZone: z.string().optional(),
  text: z.string().optional(),
  starred: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  isAllDay: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  creationDevice: z.string().optional(),
  location: LocationSchema.optional(),
  weather: WeatherSchema.optional(),
  photos: z.array(MediaSchema).optional(),
  videos: z.array(MediaSchema).optional(),
  audios: z.array(MediaSchema).optional(),
  pdfAttachments: z.array(MediaSchema).optional(),
})
export type DayOneEntry = z.infer<typeof DayOneEntrySchema>

/** The top-level `cairn` object our own export puts in a journal file. */
export const JournalExtrasSchema = z.looseObject({
  journal: lenient({
    name: extra(z.string().min(1)),
    color: nullableStr,
    icon: nullableStr,
    description: nullableStr,
    archivedAt: nullableNum,
    sortOrder: extra(z.number().int()),
  }),
})

/** Entry keys we map or knowingly drop. Anything else is listed in the report as unmapped. */
export const KNOWN_ENTRY_KEYS = new Set([
  ...Object.keys(DayOneEntrySchema.shape),
  // Kept only in source_raw:
  'richText',
  'duration',
  'editingTime',
  'promptID',
  'userActivity',
  'creationDeviceModel',
  'creationDeviceType',
  'creationOSName',
  'creationOSVersion',
])

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
}

/**
 * Day One's non-photo media: the entry key, the export folder, our kind, and the placeholder's
 * path segment. Videos and PDFs match real exports (2026-10-28, 2026-10-31); audio is unverified.
 */
export const ATTACHMENT_LISTS = [
  { key: 'videos', folder: 'videos', kind: 'video', segment: 'video' },
  { key: 'audios', folder: 'audios', kind: 'audio', segment: 'audio' },
  { key: 'pdfAttachments', folder: 'pdfs', kind: 'pdf', segment: 'pdfAttachment' },
] as const satisfies readonly {
  key: keyof DayOneEntry
  folder: string
  kind: AttachmentKind
  segment: string
}[]
export const mimeFor = (type: string) => MIME[type.toLowerCase()] ?? 'application/octet-stream'

export const parseDate = (iso: string | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

export function validTimezone(tz: string | undefined): tz is string {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function mapLocation(l: NonNullable<DayOneEntry['location']>): NewLocation {
  return {
    latitude: l.latitude,
    longitude: l.longitude,
    placeName: l.placeName ?? null,
    locality: l.localityName ?? null,
    region: l.administrativeArea ?? null,
    country: l.country ?? null,
    address: l.address ?? l.fullAddress ?? null,
    userLabel: l.userLabel ?? l.cairn?.userLabel ?? null,
    googlePlaceId: l.cairn?.googlePlaceId ?? null,
  }
}

export function mapWeather(w: NonNullable<DayOneEntry['weather']>): {
  row: NewWeather
  unmappedCode: string | null
} {
  const { condition: mapped, isDay: suffixDay } = mapDayOneWeather(w.weatherCode)
  const x = w.cairn
  // Our own export says exactly where the weather came from and what it was; Day One's wording
  // (weatherCode) is then only a rendering of that. Without it, it is Day One's, as imported.
  const source = x?.source ?? 'dayone'
  const condition = x?.condition ?? mapped
  return {
    unmappedCode: !x?.condition && mapped === 'unknown' ? w.weatherCode : null,
    row: {
      tempC: w.temperatureCelsius ?? null,
      feelsLikeC: x?.feelsLikeC ?? null,
      condition,
      isDay: x ? (x.isDay ?? null) : suffixDay,
      description: w.conditionsDescription ?? null,
      pressureMb: w.pressureMB ?? null,
      humidityPct: w.relativeHumidity ?? null,
      windKph: w.windSpeedKPH ?? null,
      windBearing: w.windBearing ?? null,
      visibilityKm: w.visibilityKM ?? null,
      sunrise: parseDate(w.sunriseDate),
      sunset: parseDate(w.sunsetDate),
      source,
      sourceCode: x?.source ? (x.sourceCode ?? null) : w.weatherCode,
      fetchedAt: x?.fetchedAt ?? null,
      raw: source === 'dayone' ? JSON.stringify(w) : null,
    },
  }
}

// ![](dayone-moment://ID) for photos; ![](dayone-moment:/video/ID), /audio/ and /pdfAttachment/
// for the rest.
const PLACEHOLDER = /!\[[^\]]*\]\(dayone-moment:\/(?:\/|([A-Za-z]+)\/)([^)\s]*)\)/g

export interface RewriteResult {
  text: string
  /** Placeholders with no matching media (e.g. the literal "undefined"); removed from the text. */
  broken: number
}

/**
 * Photos become `![](photo:<id>)` and other media `![name](attachment:<id>)`, the schemes the
 * renderer resolves. A placeholder whose media wasn't imported is removed.
 */
export function rewritePlaceholders(
  text: string,
  photoIdBySource: Map<string, string>,
  attachmentBySource: Map<string, { id: string; filename: string }> = new Map(),
): RewriteResult {
  let broken = 0
  const out = text.replace(PLACEHOLDER, (_m, segment: string | undefined, id: string) => {
    if (segment) {
      const a = attachmentBySource.get(id)
      if (a) return attachmentMarkdown(a.id, a.filename)
    } else {
      const photoId = photoIdBySource.get(id)
      if (photoId) return `![](photo:${photoId})`
    }
    broken++
    return ''
  })
  return { text: out, broken }
}
