import { sql } from 'drizzle-orm'
import {
  ATTACHMENT_KINDS,
  USER_ROLES,
  WEATHER_CONDITIONS,
  WEATHER_SOURCES,
  type MoodKey,
} from '@cairn/shared'
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// Timestamps are epoch milliseconds (UTC). Entries also carry their own IANA timezone.
//
// Sync columns (SPEC 4d) on every syncable table: updated_at, deleted_at (tombstone) and rev, a
// per-user counter bumped on every write (see repo/rev.ts). All queries must exclude deleted rows.
const sync = {
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
  rev: integer('rev').notNull(),
}

export const users = sqliteTable('user', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(), // stored lowercased
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  defaultTimezone: text('default_timezone').notNull().default('UTC'),
  // Journal the New entry button targets. No FK (users and journals reference each other); the
  // journal repo validates it and falls back when it is archived or deleted.
  defaultJournalId: text('default_journal_id'),
  tempUnit: text('temp_unit', { enum: ['F', 'C'] })
    .notNull()
    .default('F'),
  autoLocation: integer('auto_location', { mode: 'boolean' }).notNull().default(false),
  // Whether the nav lists archived journals (an Archived fold); off leaves them to Manage journals.
  showArchivedInMenu: integer('show_archived_in_menu', { mode: 'boolean' }).notNull().default(true),
  // Insights and the Details view: the writing streak stat, and the best streak under it (which
  // only shows while the first is on).
  showStreak: integer('show_streak', { mode: 'boolean' }).notNull().default(true),
  showBestStreak: integer('show_best_streak', { mode: 'boolean' }).notNull().default(true),
  // When the avatar picture (photos/<user_id>/avatar.webp) was set; null = none. Versions its URL.
  avatarUpdatedAt: integer('avatar_updated_at'),
  // Admins manage the server-wide settings and other users' accounts, never their journals.
  role: text('role', { enum: USER_ROLES }).notNull().default('user'),
  // A disabled user can't sign in and has no sessions; null = active. Nothing is deleted.
  disabledAt: integer('disabled_at'),
  lastRev: integer('last_rev').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

// `id` is the sha256 of the cookie token, so a leaked DB can't be replayed as sessions.
export const sessions = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('session_user_idx').on(t.userId), index('session_expires_idx').on(t.expiresAt)],
)

export const journals = sqliteTable(
  'journal',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    color: text('color'),
    icon: text('icon'),
    description: text('description'),
    createdAt: integer('created_at').notNull(),
    archivedAt: integer('archived_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    // Set when a deleted journal leaves the trash (deleted forever, or past the retention): the row
    // stays as a scrubbed tombstone for sync. Deleted with null here = in the trash.
    purgedAt: integer('purged_at'),
    ...sync,
  },
  (t) => [index('journal_user_idx').on(t.userId, t.sortOrder)],
)

// created_at / modified_at are the entry's own dates (what Day One calls creationDate and
// modifiedDate; the user can edit them). updated_at is the row's server write time for sync.
export const entries = sqliteTable(
  'entry',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id'), // Day One uuid on import
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    journalId: text('journal_id')
      .notNull()
      .references(() => journals.id),
    bodyMd: text('body_md').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    modifiedAt: integer('modified_at').notNull(),
    timezone: text('timezone').notNull(),
    starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    // Mood key from MOODS in @cairn/shared ('happy', 'anxious'...), null = unrated. Validated by Zod, not
    // a CHECK: adding one would rebuild this table, and dropping it cascades to every child row.
    moodKey: text('mood_key').$type<MoodKey>(),
    // The old 1-5 rating. Unused since mood_key (migration 0013 copied it over); SQLite can't drop
    // it while its CHECK exists, so it goes with a future rebuild of this table.
    legacyMood: integer('mood'),
    moodSuggested: integer('mood_suggested'), // machine suggestion, never shown as my rating
    moodSuggestedBy: text('mood_suggested_by'),
    creationDevice: text('creation_device'),
    source: text('source', { enum: ['native', 'dayone'] })
      .notNull()
      .default('native'),
    sourceRaw: text('source_raw'), // JSON of the original Day One entry
    // Set when weather is fetched in the background. That write must not bump `rev` (it would make
    // the editor's baseRev stale), so the change feed reads max(rev, weather_rev) instead.
    weatherRev: integer('weather_rev'),
    // Set when a deleted entry leaves the trash; its content is scrubbed, the tombstone stays for
    // sync. Deleted with null here = in the trash (restorable).
    purgedAt: integer('purged_at'),
    ...sync,
  },
  (t) => [
    check('entry_mood_range', sql`${t.legacyMood} IS NULL OR ${t.legacyMood} BETWEEN 1 AND 5`),
    check(
      'entry_mood_suggested_range',
      sql`${t.moodSuggested} IS NULL OR ${t.moodSuggested} BETWEEN 1 AND 5`,
    ),
    // NULL source_ids don't collide in SQLite, so native entries are unaffected.
    uniqueIndex('entry_user_source_uq').on(t.userId, t.sourceId),
    index('entry_timeline_idx').on(t.userId, t.journalId, t.createdAt),
    // The all-journals timeline (ORDER BY created_at DESC, id DESC per user).
    index('entry_all_timeline_idx').on(t.userId, t.createdAt, t.id),
    index('entry_rev_idx').on(t.userId, t.rev),
    index('entry_trash_idx')
      .on(t.userId, t.deletedAt)
      .where(sql`${t.deletedAt} IS NOT NULL AND ${t.purgedAt} IS NULL`),
  ],
)

export const tags = sqliteTable(
  'tag',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull(),
    ...sync,
  },
  (t) => [
    // Partial, so a deleted tag's name can be reused. Case-insensitive (SQLite's lower() is ASCII
    // only; resolveTags in repo/tags.ts does the full-Unicode match before it ever inserts).
    uniqueIndex('tag_user_name_uq')
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
)

// Plain join rows (hard-deleted); changing an entry's tags bumps the entry's rev.
export const entryTags = sqliteTable(
  'entry_tag',
  {
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.tagId] }), index('entry_tag_tag_idx').on(t.tagId)],
)

// 0..1 per entry. Not syncable on their own: changing one bumps the entry's rev (like entry_tag).
export const entryLocations = sqliteTable('entry_location', {
  entryId: text('entry_id')
    .primaryKey()
    .references(() => entries.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  placeName: text('place_name'),
  locality: text('locality'),
  region: text('region'), // administrative area (state/province)
  country: text('country'),
  address: text('address'),
  userLabel: text('user_label'),
  googlePlaceId: text('google_place_id'),
})

export const entryWeather = sqliteTable('entry_weather', {
  entryId: text('entry_id')
    .primaryKey()
    .references(() => entries.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  tempC: real('temp_c'),
  feelsLikeC: real('feels_like_c'),
  condition: text('condition', { enum: WEATHER_CONDITIONS }).notNull(),
  isDay: integer('is_day', { mode: 'boolean' }),
  description: text('description'), // provider wording
  pressureMb: real('pressure_mb'),
  humidityPct: real('humidity_pct'),
  windKph: real('wind_kph'),
  windBearing: real('wind_bearing'),
  visibilityKm: real('visibility_km'),
  sunrise: integer('sunrise'), // epoch ms
  sunset: integer('sunset'),
  source: text('source', { enum: WEATHER_SOURCES }).notNull(),
  sourceCode: text('source_code'), // raw provider code, kept even when mapped
  fetchedAt: integer('fetched_at'),
  raw: text('raw'), // JSON
})

// Paths are relative to the data dir. Only the original exists until the Phase 4 pipeline fills in
// display/thumb. A file is content-addressed (sha256), so rows with the same bytes share it.
export const photos = sqliteTable(
  'photo',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    // Null while an uploaded photo waits for its entry to be saved; the entry's create/update
    // attaches it once the body references it.
    entryId: text('entry_id').references(() => entries.id),
    position: integer('position').notNull(),
    originalPath: text('original_path').notNull(),
    displayPath: text('display_path'),
    thumbPath: text('thumb_path'),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    takenAt: integer('taken_at'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    sourceRef: text('source_ref'), // Day One photo identifier
    createdAt: integer('created_at').notNull(),
    ...sync,
  },
  (t) => [
    index('photo_entry_idx').on(t.userId, t.entryId, t.position),
    index('photo_sha_idx').on(t.userId, t.sha256),
    index('photo_rev_idx').on(t.userId, t.rev),
  ],
)

// Files that aren't photos: the types Day One accepts (PDF, MP4, MOV, M4A). Like photos: null
// entry until saved, kept in line with `![name](attachment:<id>)` references in the body, files
// content-addressed by sha256. No derivatives (nothing is transcoded).
export const attachments = sqliteTable(
  'attachment',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    entryId: text('entry_id').references(() => entries.id),
    kind: text('kind', { enum: ATTACHMENT_KINDS }).notNull(),
    position: integer('position').notNull(),
    path: text('path').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    filename: text('filename').notNull(), // as uploaded, for display and download
    sourceRef: text('source_ref'), // Day One media identifier
    createdAt: integer('created_at').notNull(),
    ...sync,
  },
  (t) => [
    index('attachment_entry_idx').on(t.userId, t.entryId, t.position),
    index('attachment_sha_idx').on(t.userId, t.sha256),
    index('attachment_rev_idx').on(t.userId, t.rev),
  ],
)

// Server-wide, so no user_id (like app_setting: not user content). Admins manage them; both a user's
// own prompts and the suggested ones may carry one. Settings-like: rows are deleted outright.
export const promptCategories = sqliteTable(
  'prompt_category',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    icon: text('icon').notNull(),
    position: integer('position').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('prompt_category_name_uq').on(sql`lower(${t.name})`)],
)

// A writing prompt. user_id null = a suggested prompt (server-wide, admin-managed, readable by
// everyone); otherwise it is that user's own. Always read through repo/prompts.ts, which keeps the
// two scopes apart. Settings-like: no rev or tombstones.
export const prompts = sqliteTable(
  'prompt',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id),
    text: text('text').notNull(),
    // Set null when the category is deleted; deleting a category never touches the prompt's text.
    categoryId: text('category_id').references(() => promptCategories.id, { onDelete: 'set null' }),
    // The suggested prompt a user's copy was saved from. No FK: deleting the suggestion leaves the copy.
    sourcePromptId: text('source_prompt_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('prompt_user_idx').on(t.userId, t.createdAt)],
)

// An entry template: a user's saved text, inserted into the editor at the caret. Always read through
// repo/templates.ts. Settings-like (like prompts): no rev or tombstones, rows are deleted outright.
export const templates = sqliteTable(
  'template',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    bodyMd: text('body_md').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('template_user_idx').on(t.userId, t.createdAt)],
)

// Instance-wide configuration set from the Settings screen (not user data, so no user_id): today
// only the Google API key. Included in backups with the rest of the DB.
export const appSettings = sqliteTable('app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
