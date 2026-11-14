import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Sizes of data-dir-relative files, each stat'd once. Missing files (a deleted photo whose file
 * was already removed) are left out of the map. A couple of hundred at a time, so a big library
 * doesn't open thousands of files at once.
 */
export async function fileSizes(dataDir: string, paths: Iterable<string | null | undefined>) {
  const unique = [...new Set([...paths].filter((p): p is string => !!p))]
  const sizes = new Map<string, number>()
  for (let i = 0; i < unique.length; i += 200) {
    await Promise.all(
      unique.slice(i, i + 200).map(async (rel) => {
        try {
          sizes.set(rel, (await stat(join(dataDir, rel))).size)
        } catch {
          // missing: not counted
        }
      }),
    )
  }
  return sizes
}

/** Total size of the files under a directory (0 if it doesn't exist). */
export async function dirSize(dir: string): Promise<number> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true })
  } catch {
    return 0
  }
  let total = 0
  for (const e of entries) {
    if (!e.isFile()) continue
    try {
      total += (await stat(join(e.parentPath, e.name))).size
    } catch {
      // removed while we looked
    }
  }
  return total
}
