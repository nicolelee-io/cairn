import { z } from 'zod'

const nat = z.number().int().min(0)

/**
 * GET /api/storage: what the caller's journals take on the server. File sizes are measured on
 * disk, and a file shared by several photos (same bytes) counts once in the totals but in every
 * journal that uses it. `trash` is the entries in the trash: their text and the files only they
 * use. `pending` is files only deleted photos or attachments, purged entries or uploads never
 * saved into an entry still point at: the daily cleanup removes them.
 */
export const StorageUsageSchema = z.object({
  totalBytes: nat,
  textBytes: nat,
  photos: z.object({ count: nat, originalBytes: nat, copyBytes: nat }),
  attachments: z.object({ count: nat, videoBytes: nat, audioBytes: nat, pdfBytes: nat }),
  avatarBytes: nat,
  trash: z.object({ entries: nat, files: nat, bytes: nat }),
  pending: z.object({ files: nat, bytes: nat }),
  journals: z.array(
    z.object({
      journalId: z.string(),
      entries: nat,
      textBytes: nat,
      photos: nat,
      /** Originals plus the display and thumb copies. */
      photoBytes: nat,
      attachments: nat,
      attachmentBytes: nat,
    }),
  ),
})
export type StorageUsage = z.infer<typeof StorageUsageSchema>

/**
 * GET /api/admin/storage (admins only): sizes per user and for the server. Each user's totals
 * only, never anything about their journals. No free disk space: under Docker Desktop (WSL2) the
 * container sees the virtual disk's maximum size, not the host drive, so it would mislead.
 */
export const AdminStorageSchema = z.object({
  users: z.array(
    z.object({
      id: z.string(),
      username: z.string(),
      displayName: z.string(),
      totalBytes: nat,
      textBytes: nat,
      photoBytes: nat,
      attachmentBytes: nat,
      trashBytes: nat,
      pendingBytes: nat,
    }),
  ),
  server: z.object({
    /** cairn.db with its -wal and -shm files. */
    databaseBytes: nat,
    /** backups/: pre-migration snapshots and the backup status. */
    backupsBytes: nat,
  }),
})
export type AdminStorage = z.infer<typeof AdminStorageSchema>

/**
 * GET (a dry run) and POST /api/admin/cleanup (admins only): what the media cleanup would do or
 * did, server-wide. Counts and sizes only. The same cleanup runs at startup and daily, after the
 * trash's expiry (`expiredEntries`, `expiredJournals`).
 */
export const CleanupReportSchema = z.object({
  dryRun: z.boolean(),
  /** Entries and journals in the trash past the retention, now deleted for good. */
  expiredEntries: nat,
  expiredJournals: nat,
  /** Uploads never saved into an entry within a day, now deleted. */
  abandoned: nat,
  /** Photos and attachments of entries deleted for good (emptied or expired from the trash). */
  ofPurgedEntries: nat,
  /** Files of photos and attachments deleted over 30 days ago that nothing else uses. */
  files: nat,
  /** Files in a user's folders that no photo or attachment names (failed uploads, leftovers). */
  stray: nat,
  /** What removing `files` and `stray` frees. */
  bytes: nat,
  /** Photos and attachments still in use whose file is gone (the server log lists them). */
  missing: nat,
})
export type CleanupReport = z.infer<typeof CleanupReportSchema>

/**
 * How new photos are kept (a server setting, admins only). `compressed`: JPEGs and opaque PNGs
 * are stored as a JPEG of at most `COMPRESSED_EDGE` px at quality 85, with EXIF kept, when that is
 * clearly smaller. `original`: the uploaded bytes, untouched. Display and thumb copies are the
 * same either way.
 */
export const PhotoQualitySchema = z.enum(['compressed', 'original'])
export type PhotoQuality = z.infer<typeof PhotoQualitySchema>
export const COMPRESSED_EDGE = 4096

/** A run of "Compress existing photos", one file at a time in the background. */
export const CompressJobSchema = z.object({
  state: z.enum(['idle', 'running', 'done', 'failed']),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  /** Files to look at, and how many have been. */
  total: nat,
  done: nat,
  /** Files replaced by a smaller JPEG, and the bytes that saved. */
  compressed: nat,
  savedBytes: nat,
  /** Files left as they were (WebP, transparency, or not clearly smaller), or unreadable. */
  kept: nat,
  failed: nat,
  error: z.string().nullable(),
})
export type CompressJob = z.infer<typeof CompressJobSchema>

/** GET /api/admin/photos (admins only): the setting, and the compress-existing job. */
export const AdminPhotosSchema = z.object({
  quality: PhotoQualitySchema,
  /** Original JPEG and PNG files not yet compressed, server-wide: what the job would look at. */
  candidates: z.object({ files: nat, bytes: nat }),
  /** When the last backup succeeded; compressing existing photos needs one within a day. */
  lastBackupAt: z.number().nullable(),
  /** Whether that backup is recent enough to start compressing. */
  backupFresh: z.boolean(),
  job: CompressJobSchema,
})
export type AdminPhotos = z.infer<typeof AdminPhotosSchema>

export const UpdatePhotoQualitySchema = z.object({ quality: PhotoQualitySchema })
