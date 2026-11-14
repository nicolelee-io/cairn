import { createReadStream, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import yauzl from 'yauzl'

/** A Day One export, either the zip or the folder it unpacks to. Paths use forward slashes. */
export interface ExportSource {
  /** Root-level `*.json` files: one per journal. */
  journalFiles(): string[]
  readJson(file: string): Promise<unknown>
  /** The file's (uncompressed) size in bytes, or null if it isn't there; nothing is read. */
  fileSize(path: string): number | null
  /** Null if the file isn't in the export. */
  readFileBytes(path: string): Promise<Buffer | null>
  /** The file as a stream, for ones too big to hold in memory (videos). Null if it isn't there. */
  openFile(path: string): Promise<Readable | null>
  close(): Promise<void>
}

export function openDirSource(dir: string): ExportSource {
  return {
    journalFiles: () => readdirSync(dir).filter((f) => f.endsWith('.json')),
    async readJson(file) {
      return JSON.parse(await readFile(join(dir, file), 'utf8'))
    },
    fileSize(path) {
      try {
        const s = statSync(join(dir, path))
        return s.isFile() ? s.size : null
      } catch {
        return null
      }
    },
    async readFileBytes(path) {
      try {
        return await readFile(join(dir, path))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
    },
    async openFile(path) {
      const full = join(dir, path)
      try {
        if (!statSync(full).isFile()) return null
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
      return createReadStream(full)
    },
    close: async () => {},
  }
}

/** A zip also knows what it unpacks to, from its directory alone (see `fileSize`). */
export type ZipSource = ExportSource & { unpackedBytes: number }

export async function openZipSource(file: string): Promise<ZipSource> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, z) =>
      err ? reject(err) : resolve(z),
    ),
  )
  // Index the central directory once; file bodies are read on demand, so a 200MB zip never sits
  // in memory.
  const index = new Map<string, yauzl.Entry>()
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (e: yauzl.Entry) => {
      if (!e.fileName.endsWith('/')) index.set(e.fileName, e)
      zip.readEntry()
    })
    zip.on('end', resolve)
    zip.on('error', reject)
    zip.readEntry()
  })

  const open = (e: yauzl.Entry) =>
    new Promise<Readable>((resolve, reject) =>
      zip.openReadStream(e, (err, stream) => (err ? reject(err) : resolve(stream))),
    )
  const read = (e: yauzl.Entry) =>
    new Promise<Buffer>((resolve, reject) =>
      zip.openReadStream(e, (err, stream) => {
        if (err) return reject(err)
        const chunks: Buffer[] = []
        stream.on('data', (c: Buffer) => chunks.push(c))
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', reject)
      }),
    )

  return {
    unpackedBytes: [...index.values()].reduce((n, e) => n + e.uncompressedSize, 0),
    journalFiles: () => [...index.keys()].filter((n) => !n.includes('/') && n.endsWith('.json')),
    async readJson(name) {
      const e = index.get(name)
      if (!e) throw new Error(`${name} not in export`)
      return JSON.parse((await read(e)).toString('utf8'))
    },
    // yauzl checks the bytes it inflates against this (validateEntrySizes), so a zip can't lie.
    fileSize: (path) => index.get(path)?.uncompressedSize ?? null,
    async readFileBytes(path) {
      const e = index.get(path)
      return e ? read(e) : null
    },
    async openFile(path) {
      const e = index.get(path)
      return e ? open(e) : null
    },
    close: async () => zip.close(),
  }
}

export async function openExport(path: string): Promise<ExportSource> {
  return statSync(path).isDirectory() ? openDirSource(path) : openZipSource(path)
}
