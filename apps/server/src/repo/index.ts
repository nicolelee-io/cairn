import type { Db } from '../db/index.ts'
import { attachmentRepo } from './attachments.ts'
import { entryRepo } from './entries.ts'
import { exportRepo } from './export.ts'
import { photoRepo } from './photos.ts'
import { galleryRepo } from './gallery.ts'
import { importRepo } from './imports.ts'
import { insightsRepo } from './insights.ts'
import { journalRepo } from './journals.ts'
import { userPromptRepo } from './prompts.ts'
import { searchRepo } from './search.ts'
import { syncRepo } from './sync.ts'
import { tagRepo } from './tags.ts'
import { templateRepo } from './templates.ts'
import { trashRepo } from './trash.ts'

/**
 * The only way route handlers touch user data: construct with the authenticated userId and every
 * call is scoped to it. Handlers must not import the schema or query tables directly.
 */
export function createRepos(db: Db, userId: string) {
  return {
    attachments: attachmentRepo(db, userId),
    journals: journalRepo(db, userId),
    entries: entryRepo(db, userId),
    export: exportRepo(db, userId),
    gallery: galleryRepo(db, userId),
    imports: importRepo(db, userId),
    insights: insightsRepo(db, userId),
    photos: photoRepo(db, userId),
    prompts: userPromptRepo(db, userId),
    search: searchRepo(db, userId),
    sync: syncRepo(db, userId),
    tags: tagRepo(db, userId),
    templates: templateRepo(db, userId),
    trash: trashRepo(db, userId),
  }
}
