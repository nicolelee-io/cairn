import { useMemo, useSyncExternalStore } from 'react'
import { draftsVersion, listDrafts, subscribeDrafts } from './draft.ts'

/** This user's drafts on this device, kept current as they are saved, discarded or sent. */
export function useDrafts(userId: string | undefined) {
  const version = useSyncExternalStore(subscribeDrafts, draftsVersion)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is what says storage changed
  return useMemo(() => (userId ? listDrafts(userId) : []), [userId, version])
}
