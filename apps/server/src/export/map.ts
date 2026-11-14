import { replaceAttachmentRefs, replacePhotoRefs, toDayOneWeatherCode } from '@cairn/shared'
import { ATTACHMENT_LISTS } from '../import/dayone/map.ts'
import type { journals } from '../db/schema.ts'
import type { ExportedEntry } from '../repo/export.ts'

type ExportedJournal = typeof journals.$inferSelect

/** An original photo or attachment file as it will appear in the archive (see `hashMediaFiles`). */
export interface MediaFile {
  /** Path inside the archive: `photos/<md5>.<ext>`, or `videos/`, `audios/`, `pdfs/`. */
  path: string
  md5: string
  bytes: number
  ext: string
}

type Json = Record<string, unknown>

/** ISO 8601 UTC with second precision, as Day One writes it. */
export const dayOneDate = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Day One's 32 uppercase hex ids, from one of ours (dashes dropped). */
export const hexId = (id: string) => id.replaceAll('-', '').toUpperCase()

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The entry as Day One first exported it, for entries that came from an import (else empty). */
function rawEntry(entry: ExportedEntry['entry']): Json {
  if (entry.source !== 'dayone' || !entry.sourceRaw) return {}
  try {
    const raw: unknown = JSON.parse(entry.sourceRaw)
    return isObject(raw) ? raw : {}
  } catch {
    return {}
  }
}

/** Carried-over Day One keys, minus our own extras from an earlier export (they're rewritten below). */
const withoutCairn = (o: Json): Json =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'cairn'))

const present = (o: Json): Json =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined))

function locationJson(x: NonNullable<ExportedEntry['location']>, raw: Json) {
  // Keep what Day One sent that Cairn has no column for (altitude, region, ...) while the place
  // is still the one that was imported.
  const base = isObject(raw.location) ? withoutCairn(raw.location) : {}
  const same = base.latitude === x.latitude && base.longitude === x.longitude
  const out: Json = {
    ...(same ? base : {}),
    ...present({
      latitude: x.latitude,
      longitude: x.longitude,
      placeName: x.placeName,
      localityName: x.locality,
      administrativeArea: x.region,
      country: x.country,
      address: x.address,
    }),
  }
  if (x.userLabel || x.googlePlaceId) {
    out.cairn = present({ userLabel: x.userLabel, googlePlaceId: x.googlePlaceId })
  }
  return out
}

function weatherJson(x: NonNullable<ExportedEntry['weather']>, raw: Json) {
  const base = x.source === 'dayone' && isObject(raw.weather) ? withoutCairn(raw.weather) : {}
  // Day One's own code when we have it; otherwise our condition in WeatherKit's wording. A
  // condition with no Day One equivalent keeps the provider's code, else "Unknown".
  const code =
    (x.source === 'dayone' ? x.sourceCode : null) ??
    toDayOneWeatherCode(x.condition) ??
    x.sourceCode ??
    'Unknown'
  const out: Json = {
    ...base,
    ...present({
      temperatureCelsius: x.tempC,
      pressureMB: x.pressureMb,
      relativeHumidity: x.humidityPct,
      windSpeedKPH: x.windKph,
      windBearing: x.windBearing,
      visibilityKM: x.visibilityKm,
      conditionsDescription: x.description,
      sunriseDate: x.sunrise === null ? null : dayOneDate(x.sunrise),
      sunsetDate: x.sunset === null ? null : dayOneDate(x.sunset),
    }),
    weatherCode: code,
  }
  out.cairn = {
    source: x.source,
    condition: x.condition,
    isDay: x.isDay,
    feelsLikeC: x.feelsLikeC,
    sourceCode: x.sourceCode,
    fetchedAt: x.fetchedAt,
  }
  return out
}

const REBUILT_KEYS = new Set([
  'richText',
  'photos',
  ...ATTACHMENT_LISTS.map((l) => l.key),
  'text',
  'location',
  'weather',
])

/**
 * One entry as a Day One entry. `files` maps a photo or attachment row id to its file; one that
 * has none (missing on disk) is left out of its list and its reference out of the text.
 */
export function entryJson(x: ExportedEntry, files: ReadonlyMap<string, MediaFile>): Json {
  const { entry } = x
  const raw = rawEntry(entry)
  // richText is Day One's own rendering of the text we have since edited; the media lists are
  // rebuilt below.
  const kept = Object.fromEntries(Object.entries(raw).filter(([k]) => !REBUILT_KEYS.has(k)))

  const identifier = new Map(
    [...x.photos, ...x.attachments].map((p) => [p.id, p.sourceRef ?? hexId(p.id)]),
  )
  const segment = new Map(
    x.attachments.map((a) => [a.id, ATTACHMENT_LISTS.find((l) => l.kind === a.kind)!.segment]),
  )
  const photoText = replacePhotoRefs(entry.bodyMd, (id) => {
    const ident = identifier.get(id)
    return ident && files.has(id) ? `![](dayone-moment://${ident})` : ''
  })
  const text = replaceAttachmentRefs(photoText, (id) => {
    const ident = identifier.get(id)
    const seg = segment.get(id)
    return ident && seg && files.has(id) ? `![](dayone-moment:/${seg}/${ident})` : ''
  })

  const rawPhotos = Array.isArray(raw.photos) ? raw.photos.filter(isObject) : []
  const photoList = x.photos.flatMap((p, i) => {
    const file = files.get(p.id)
    if (!file) return []
    const ident = identifier.get(p.id)!
    const out: Json = {
      ...withoutCairn(rawPhotos.find((r) => r.identifier === ident) ?? {}),
      identifier: ident,
      md5: file.md5,
      type: file.ext,
      width: p.width ?? 0,
      height: p.height ?? 0,
      fileSize: file.bytes,
      // Not the row's createdAt: that is when the photo was uploaded or imported.
      date: dayOneDate(p.takenAt ?? entry.createdAt),
      orderInEntry: i,
      isSketch: false,
      favorite: false,
      duration: null,
    }
    out.cairn = {
      takenAt: p.takenAt,
      latitude: p.latitude,
      longitude: p.longitude,
    }
    return [out]
  })

  const attachmentLists = ATTACHMENT_LISTS.map((list) => {
    const rawList = Array.isArray(raw[list.key])
      ? (raw[list.key] as unknown[]).filter(isObject)
      : []
    const items = x.attachments
      .filter((a) => a.kind === list.kind && files.has(a.id))
      .map((a, i) => {
        const file = files.get(a.id)!
        const ident = identifier.get(a.id)!
        const item: Json = {
          width: 0,
          height: 0,
          creationDevice: '',
          ...withoutCairn(rawList.find((r) => r.identifier === ident) ?? {}),
          identifier: ident,
          md5: file.md5,
          type: file.ext,
          fileSize: file.bytes,
          orderInEntry: i,
          favorite: false,
          duration: null,
        }
        if (list.kind === 'pdf') item.pdfName = a.filename.replace(/\.pdf$/i, '')
        item.cairn = { filename: a.filename }
        return item
      })
    return [list.key, items] as const
  })

  const out: Json = {
    ...kept,
    uuid: entry.sourceId ?? hexId(entry.id),
    creationDate: dayOneDate(entry.createdAt),
    modifiedDate: dayOneDate(entry.modifiedAt),
    timeZone: entry.timezone,
    text,
    starred: entry.starred,
    isPinned: entry.pinned,
    isAllDay: entry.allDay,
    tags: x.tags,
  }
  if (entry.creationDevice) out.creationDevice = entry.creationDevice
  if (x.location) out.location = locationJson(x.location, raw)
  if (x.weather) out.weather = weatherJson(x.weather, raw)
  if (photoList.length) out.photos = photoList
  for (const [key, items] of attachmentLists) if (items.length) out[key] = items
  out.cairn = {
    id: entry.id,
    source: entry.source,
    mood: entry.moodKey,
    moodSuggested: entry.moodSuggested,
    moodSuggestedBy: entry.moodSuggestedBy,
    createdAt: entry.createdAt,
    modifiedAt: entry.modifiedAt,
  }
  return out
}

/** Characters that can't go in a file name on Windows, macOS or Linux. */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g

/** `<Journal name>.json`, unique within the archive (journal names needn't be). */
export function journalFileNames(journals: { name: string }[]): string[] {
  const used = new Set<string>()
  return journals.map(({ name }) => {
    const stem = name.replace(UNSAFE_NAME, '-').replace(/^[. ]+|[. ]+$/g, '') || 'Journal'
    let file = `${stem}.json`
    for (let n = 2; used.has(file.toLowerCase()); n++) file = `${stem} (${n}).json`
    used.add(file.toLowerCase())
    return file
  })
}

/** A journal's file with its `entries` left empty: `export/run.ts` streams them in, a batch at a time. */
export function journalShell(journal: ExportedJournal): Json {
  return {
    metadata: { version: '1.0' },
    entries: [],
    cairn: {
      journal: {
        name: journal.name,
        color: journal.color,
        icon: journal.icon,
        description: journal.description,
        archivedAt: journal.archivedAt,
        sortOrder: journal.sortOrder,
      },
    },
  }
}
