import { z } from 'zod'
import { MoodSchema } from './mood.ts'
import { WeatherConditionSchema, WeatherSourceSchema } from './weather.ts'
import { ATTACHMENT_KINDS } from './mediaRefs.ts'
import { isJournalIconName } from './journalIcons.ts'

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const Id = z.uuid()
const Timezone = z.string().refine(isValidTimezone, 'unknown IANA timezone')
/** Epoch ms. */
const Timestamp = z.number().int().min(0)
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb')
/** A journal's icon: a name from JOURNAL_ICONS, or one emoji (a single grapheme, so a flag or a skin-toned hand still counts). */
const JournalIcon = z
  .string()
  .refine(
    (s) =>
      isJournalIconName(s) ||
      (/\p{Extended_Pictographic}/u.test(s) && [...new Intl.Segmenter().segment(s)].length === 1),
    'expected an icon name or one emoji',
  )
const MAX_BODY = 500_000

/** A tag as typed: trimmed, no leading '#', matched case-insensitively (see `sameTag`). */
export const MAX_TAG_LENGTH = 64
export const TagNameSchema = z
  .string()
  .transform((s) => s.trim().replace(/^#+\s*/, ''))
  .pipe(z.string().min(1).max(MAX_TAG_LENGTH))
const TagList = z.array(TagNameSchema).max(50)

/** Tag names are one tag when they match ignoring case; the first spelling is the one kept. */
export const tagKey = (name: string) => name.trim().toLowerCase()

// ---- Journals ----

/** Trimmed; an empty one is stored as null. */
const JournalDescription = z
  .string()
  .trim()
  .max(1000)
  .transform((d) => d || null)

export const JournalSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  /** A Material icon name (JOURNAL_ICONS) or an emoji, shown in the journal's colour circle; null means the default book. Absent in offline copies made before it existed. */
  icon: z
    .string()
    .nullish()
    .transform((i) => i ?? null),
  /** Free text shown on the empty reading pane; null when none. Absent in offline copies made before it existed. */
  description: z
    .string()
    .nullish()
    .transform((d) => d ?? null),
  archivedAt: z.number().nullable(),
  sortOrder: z.number(),
  createdAt: z.number(),
  rev: z.number(),
  /** Live entries in the journal. */
  entryCount: z.number(),
})
export type Journal = z.infer<typeof JournalSchema>

export const CreateJournalSchema = z.object({
  id: Id.optional(),
  name: z.string().trim().min(1).max(100),
  color: Color.nullish(),
  icon: JournalIcon.nullish(),
  description: JournalDescription.nullish(),
})
export type CreateJournal = z.infer<typeof CreateJournalSchema>

export const UpdateJournalSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: Color.nullable().optional(),
  icon: JournalIcon.nullable().optional(),
  description: JournalDescription.nullable().optional(),
  archived: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})
export type UpdateJournal = z.infer<typeof UpdateJournalSchema>

/** PUT /api/journals/order: the live journals' ids in their new order (archived ones may be left out). */
export const ReorderJournalsSchema = z.object({ ids: z.array(Id).min(1).max(500) })

// ---- Entries ----

export const LocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  placeName: z.string().max(300).nullable(),
  locality: z.string().max(200).nullable(),
  region: z.string().max(200).nullable(),
  country: z.string().max(200).nullable(),
  address: z.string().max(500).nullable(),
  googlePlaceId: z.string().max(300).nullable(),
})
export type Location = z.infer<typeof LocationSchema>

export const RecentPlacesSchema = z.object({ places: z.array(LocationSchema) })

/** One row of place autocomplete; `placeId` goes to GET /api/places/details. */
export const PlaceSuggestionSchema = z.object({
  placeId: z.string(),
  name: z.string(),
  detail: z.string(),
})
export type PlaceSuggestion = z.infer<typeof PlaceSuggestionSchema>
export const PlaceSuggestionsSchema = z.object({ suggestions: z.array(PlaceSuggestionSchema) })

/** Where the Google key comes from; the key itself is never sent back to the browser. */
export const GoogleKeyStatusSchema = z.object({
  configured: z.boolean(),
  source: z.enum(['settings', 'env']).nullable(),
  /** Last four characters, to recognise the key. */
  hint: z.string().nullable(),
})
export type GoogleKeyStatus = z.infer<typeof GoogleKeyStatusSchema>
export const SetGoogleKeySchema = z.object({ key: z.string().trim().min(10).max(200) })

/**
 * What the backup sidecar last reported (docs/backup.md). `none` = it has never written a status
 * (not set up, or not run yet); `stale` = the last success is too old, though nothing failed loudly.
 */
export const BackupStatusSchema = z.object({
  state: z.enum(['none', 'ok', 'failing', 'stale']),
  /** The most recent attempt, successful or not (epoch ms). */
  lastRunAt: z.number().nullable(),
  lastRunError: z.string().nullable(),
  lastSuccessAt: z.number().nullable(),
  snapshotId: z.string().nullable(),
  /** The most recent test restore (`verify`). */
  lastVerifyAt: z.number().nullable(),
  lastVerifyOk: z.boolean().nullable(),
  lastVerifyError: z.string().nullable(),
})
export type BackupStatus = z.infer<typeof BackupStatusSchema>

/** A hand-entered weather; everything else about it is left blank. */
export const ManualWeatherSchema = z.object({
  condition: WeatherConditionSchema,
  tempC: z.number().min(-90).max(65).nullable(),
  isDay: z.boolean().nullable(),
})
export type ManualWeather = z.infer<typeof ManualWeatherSchema>

/**
 * What an edit can do to an entry's weather: set it by hand, remove it (null), or `auto` to drop it
 * and let Google fill it in again once the entry is saved.
 */
export const WeatherEditSchema = z.union([ManualWeatherSchema, z.object({ auto: z.literal(true) })])
export type WeatherEdit = z.infer<typeof WeatherEditSchema>

export const CreateEntrySchema = z.object({
  /** Client-generated (v7) so a retried create is idempotent. */
  id: Id.optional(),
  journalId: z.string(),
  bodyMd: z.string().max(MAX_BODY).optional(),
  createdAt: Timestamp.optional(),
  timezone: Timezone,
  starred: z.boolean().optional(),
  pinned: z.boolean().optional(),
  allDay: z.boolean().optional(),
  mood: MoodSchema.nullish(),
  location: LocationSchema.nullish(),
  weather: ManualWeatherSchema.nullish(),
  tags: TagList.optional(),
})
export type CreateEntry = z.infer<typeof CreateEntrySchema>

export const UpdateEntrySchema = z.object({
  journalId: z.string().optional(),
  bodyMd: z.string().max(MAX_BODY).optional(),
  createdAt: Timestamp.optional(),
  timezone: Timezone.optional(),
  starred: z.boolean().optional(),
  pinned: z.boolean().optional(),
  allDay: z.boolean().optional(),
  mood: MoodSchema.nullable().optional(),
  /** Omit to leave the place alone; null removes it. */
  location: LocationSchema.nullable().optional(),
  /** Omit to leave the weather alone; null removes it. */
  weather: WeatherEditSchema.nullable().optional(),
  /** Omit to leave the tags alone; the list replaces them (an empty one removes them all). */
  tags: TagList.optional(),
  /** The rev this edit was made against; a mismatch is a 409, never a silent overwrite (SPEC 4d). */
  baseRev: z.number().int().optional(),
  /** Attached photos or attachments the text never mentions (Day One allows that) to delete with this save. */
  removeMediaIds: z.array(z.string()).max(200).optional(),
  /** The old name of `removeMediaIds`, still accepted for saves queued in an outbox before the rename. */
  removePhotoIds: z.array(z.string()).max(200).optional(),
})
export type UpdateEntry = z.infer<typeof UpdateEntrySchema>

export const PhotoSchema = z.object({
  id: z.string(),
  position: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  takenAt: z.number().nullable(),
  /** From the photo's EXIF, for "use this photo's location". */
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
})
export type Photo = z.infer<typeof PhotoSchema>

/** A non-photo file (PDF, video, audio), served at /api/attachments/:id. */
export const AttachmentSchema = z.object({
  id: z.string(),
  kind: z.enum(ATTACHMENT_KINDS),
  position: z.number(),
  filename: z.string(),
  mime: z.string(),
  bytes: z.number(),
})
export type Attachment = z.infer<typeof AttachmentSchema>

/** What the Entries screen's Media view can show: photos, plus the attachment kinds. */
export const MEDIA_KINDS = ['photo', ...ATTACHMENT_KINDS] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

/** One photo or file in the Media view, with the entry it belongs to (its date, in its own zone). */
export const MediaItemSchema = z.object({
  id: z.string(),
  kind: z.enum(MEDIA_KINDS),
  entryId: z.string(),
  journalId: z.string(),
  /** The entry's time and zone: the tile shows the entry's day. */
  createdAt: z.number(),
  timezone: z.string(),
  /** The uploaded file name; null for photos. */
  filename: z.string().nullable(),
})
export type MediaItem = z.infer<typeof MediaItemSchema>

export const MediaPageSchema = z.object({
  items: z.array(MediaItemSchema),
  nextCursor: z.string().nullable(),
})
export type MediaPage = z.infer<typeof MediaPageSchema>

/** Uploads are capped below Cloudflare's 100 MB request limit; Settings can only lower it. */
export const ATTACHMENT_MAX_MB = 95
/** GET/PUT /api/attachments/limit: the largest attachment upload, instance-wide. */
export const AttachmentLimitSchema = z.object({
  maxMb: z.number().int().min(1).max(ATTACHMENT_MAX_MB),
})
export type AttachmentLimit = z.infer<typeof AttachmentLimitSchema>

export const WeatherSchema = z.object({
  condition: WeatherConditionSchema,
  isDay: z.boolean().nullable(),
  tempC: z.number().nullable(),
  description: z.string().nullable(),
  pressureMb: z.number().nullable(),
  humidityPct: z.number().nullable(),
  windKph: z.number().nullable(),
  source: WeatherSourceSchema,
})
export type Weather = z.infer<typeof WeatherSchema>

export const EntrySchema = z.object({
  id: z.string(),
  journalId: z.string(),
  bodyMd: z.string(),
  /** The entry's own dates (editable); display them in `timezone`, never the viewer's. */
  createdAt: z.number(),
  modifiedAt: z.number(),
  timezone: z.string(),
  starred: z.boolean(),
  pinned: z.boolean(),
  allDay: z.boolean(),
  mood: MoodSchema.nullable(),
  /** A machine suggestion, kept apart from `mood` (SPEC 4a). */
  moodSuggested: z.number().nullable(),
  creationDevice: z.string().nullable(),
  source: z.enum(['native', 'dayone']),
  rev: z.number(),
})
export type Entry = z.infer<typeof EntrySchema>

/** One of the user's tags with the live entries that carry it. */
export const TagCountSchema = z.object({ name: z.string(), count: z.number() })
export type TagCount = z.infer<typeof TagCountSchema>
/** GET /api/tags: most used first, then by name. */
/** PATCH /api/tags: rename a tag (a different spelling of the same tag is fine). */
export const RenameTagSchema = z.object({ name: TagNameSchema, newName: TagNameSchema })
/** POST /api/tags/merge: move every entry of `from` to `into`, then drop `from`. */
export const MergeTagsSchema = z.object({ from: TagNameSchema, into: TagNameSchema })
/** The reply to a rename, merge or delete: how many entries it touched. */
export const TagChangeSchema = z.object({ entries: z.number() })
export type TagChange = z.infer<typeof TagChangeSchema>

export const TagListSchema = z.object({ tags: z.array(TagCountSchema) })
export type TagListResponse = z.infer<typeof TagListSchema>

export const EntryDetailSchema = z.object({
  entry: EntrySchema,
  location: LocationSchema.nullable(),
  weather: WeatherSchema.nullable(),
  tags: z.array(z.string()),
  photos: z.array(PhotoSchema),
  // Defaulted: replies cached by the service worker before attachments existed don't have it.
  attachments: z.array(AttachmentSchema).default([]),
})
export type EntryDetail = z.infer<typeof EntryDetailSchema>

export const TimelineItemSchema = z.object({
  id: z.string(),
  journalId: z.string(),
  createdAt: z.number(),
  timezone: z.string(),
  starred: z.boolean(),
  pinned: z.boolean(),
  allDay: z.boolean(),
  mood: MoodSchema.nullable(),
  /** The first line when it reads like a title (a heading, or short); otherwise empty. */
  title: z.string(),
  /** Plain text after the title (markdown and images stripped), clipped. */
  excerpt: z.string(),
  photoCount: z.number(),
  /** The first few photos, for card thumbnails. */
  photos: z.array(PhotoSchema),
  /** Has a PDF, video or audio file (photos show as thumbnails). Defaulted for older cached replies. */
  hasAttachments: z.boolean().default(false),
  placeName: z.string().nullable(),
  weather: z.object({ condition: WeatherConditionSchema, tempC: z.number().nullable() }).nullable(),
})
export type TimelineItem = z.infer<typeof TimelineItemSchema>

/** One entry with a place, for the map view. */
export const MapPointSchema = z.object({
  id: z.string(),
  journalId: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  createdAt: z.number(),
  timezone: z.string(),
  /** The card title, or the start of the text when the entry has none. */
  title: z.string(),
  placeName: z.string().nullable(),
})
export type MapPoint = z.infer<typeof MapPointSchema>

export const MapDataSchema = z.object({
  points: z.array(MapPointSchema),
  /** Entries in the same scope with or without a place, for "N of M have a place". */
  total: z.number(),
})
export type MapData = z.infer<typeof MapDataSchema>

export const TimelinePageSchema = z.object({
  items: z.array(TimelineItemSchema),
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
})
export type TimelinePage = z.infer<typeof TimelinePageSchema>

// ---- Search ----

/** A calendar day, 'YYYY-MM-DD' (a real one: 2026-02-31 is refused). */
const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'Not a real day')

/** Wrap the matched words in a result's `snippet` (private-use characters, so they can't clash with text). */
export const SNIPPET_OPEN = '\uE000'
export const SNIPPET_CLOSE = '\uE001'

export const SEARCH_SORTS = ['newest', 'relevance'] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

/** Query string of GET /api/search. */
export const SearchQuerySchema = z
  .object({
    /** May be empty when a filter (starred, attachments, tag, mood, a date) is on: that lists every such entry. */
    q: z.string().trim().max(200).default(''),
    sort: z.enum(SEARCH_SORTS).default('newest'),
    journalId: z.string().min(1).optional(),
    starred: z.stringbool().default(false),
    /** Only entries with a PDF, video or audio file (not photos). */
    attachments: z.stringbool().default(false),
    /** Only entries carrying this tag (matched ignoring case). */
    tag: z.string().trim().min(1).max(MAX_TAG_LENGTH).optional(),
    /** Only entries with this mood. */
    mood: MoodSchema.optional(),
    /** Only entries written on or after / on or before this day, read in each entry's own timezone. */
    from: DaySchema.optional(),
    to: DaySchema.optional(),
    /** Archived journals are left out unless this is set or `journalId` names one. */
    includeArchived: z.stringbool().default(false),
    cursor: z.string().max(32).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .refine((v) => v.q !== '' || v.starred || v.attachments || v.tag || v.mood || v.from || v.to, {
    message: 'q is required unless a filter is set',
  })
export type SearchQuery = z.input<typeof SearchQuerySchema>

export const SearchResultSchema = TimelineItemSchema.extend({
  /** Text around the match with SNIPPET_OPEN/SNIPPET_CLOSE around the matched words. */
  snippet: z.string(),
  /** The card title with the matched words marked the same way ('' when the card has no title). */
  titleMarked: z.string(),
  /** Which part of the entry `snippet` is from, so the card can say when it isn't the text. */
  snippetField: z.enum(['body', 'tags', 'place']).default('body'),
})
export type SearchResult = z.infer<typeof SearchResultSchema>

export const SearchPageSchema = z.object({
  items: z.array(SearchResultSchema),
  nextCursor: z.string().nullable(),
})
export type SearchPage = z.infer<typeof SearchPageSchema>

/** Query string of GET /api/search/matches: which words of one entry the search matched. */
export const SearchMatchesQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  entryId: z.string().min(1).max(64),
})
export const SearchMatchesSchema = z.object({ words: z.array(z.string()) })
export type SearchMatches = z.infer<typeof SearchMatchesSchema>

export const ConflictSchema = z.object({ error: z.literal('conflict'), current: EntryDetailSchema })
export type Conflict = z.infer<typeof ConflictSchema>

/** Photo variants served at /api/photos/:id/:variant. `display` and `thumb` fall back to the original. */
export const PHOTO_VARIANTS = ['original', 'display', 'thumb'] as const
export type PhotoVariant = (typeof PHOTO_VARIANTS)[number]

// ---- Sync (Phase 7.4) ----

/** A journal as the sync feed sends it (no live entry count: the client counts its own copy). */
export const SyncJournalSchema = JournalSchema.omit({ entryCount: true })
export type SyncJournal = z.infer<typeof SyncJournalSchema>

/** An entry without its photos and attachments, which arrive (and change) as their own records. */
export const SyncEntrySchema = EntryDetailSchema.omit({ photos: true, attachments: true })
export type SyncEntry = z.infer<typeof SyncEntrySchema>

export const SyncPhotoSchema = PhotoSchema.extend({ entryId: z.string(), rev: z.number() })
export type SyncPhoto = z.infer<typeof SyncPhotoSchema>

export const SyncAttachmentSchema = AttachmentSchema.extend({
  entryId: z.string(),
  rev: z.number(),
})
export type SyncAttachment = z.infer<typeof SyncAttachmentSchema>

/**
 * GET /api/sync/changes?since=<cursor>&limit=&journalIds=a,b: everything that changed after
 * `since`, oldest first, across journals, entries, photos and attachments (one revision counter
 * covers all of them). Journals are always sent. Entries and their media are limited to `journalIds` when given; once
 * `since` is past 0, a change to something outside them arrives as a deleted id, so an entry moved
 * out of a synced journal disappears from the copy. Deleted ids are tombstones. Keep asking while
 * `hasMore`, passing `cursor` back as `since`. `reset` means the server's history is behind the
 * client's cursor (a restore from an older backup): drop the local copy and start again from 0.
 */
export const SyncChangesSchema = z.object({
  cursor: z.number(),
  hasMore: z.boolean(),
  reset: z.boolean(),
  journals: z.array(SyncJournalSchema),
  deletedJournalIds: z.array(z.string()),
  entries: z.array(SyncEntrySchema),
  deletedEntryIds: z.array(z.string()),
  photos: z.array(SyncPhotoSchema),
  deletedPhotoIds: z.array(z.string()),
  attachments: z.array(SyncAttachmentSchema),
  deletedAttachmentIds: z.array(z.string()),
})
export type SyncChanges = z.infer<typeof SyncChangesSchema>

/**
 * GET /api/sync/estimate: what keeping each journal on a device would download, before the user
 * agrees to it. `photoBytes` is the display and thumb files (never originals); text is UTF-8 bytes.
 */
export const SyncEstimateSchema = z.object({
  journals: z.array(
    z.object({
      journalId: z.string(),
      entries: z.number(),
      textBytes: z.number(),
      photos: z.number(),
      photoBytes: z.number(),
    }),
  ),
})
export type SyncEstimate = z.infer<typeof SyncEstimateSchema>
