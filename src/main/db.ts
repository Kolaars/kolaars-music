/**
 * Persistent store for the desktop app.
 *
 * Deliberately dependency-free: a single JSON document, written atomically and
 * debounced, in Electron's per-user data directory. Big enough for tens of
 * thousands of tracks while staying trivially inspectable and backup-friendly.
 */

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createDefaultDb, DB_VERSION, DEFAULT_SESSION, DEFAULT_SETTINGS } from '@shared/defaults'
import type { PersistedDb } from '@shared/types'

let dbFile = ''
let baseDir = ''
let cache: PersistedDb | null = null
let flushTimer: NodeJS.Timeout | null = null
let writeChain: Promise<void> = Promise.resolve()

/** Root directory for all of the app's mutable data. */
export function userDataDir(): string {
  if (!baseDir) baseDir = app.getPath('userData')
  return baseDir
}

export function downloadsDir(): string {
  return path.join(userDataDir(), 'downloads')
}

export function coversDir(): string {
  return path.join(userDataDir(), 'covers')
}

function dbPath(): string {
  if (!dbFile) dbFile = path.join(userDataDir(), 'kolaars.json')
  return dbFile
}

/** Merges a stored document with the current defaults (forward compatible). */
function migrate(raw: unknown): PersistedDb {
  const base = createDefaultDb()
  if (!raw || typeof raw !== 'object') return base
  const input = raw as Partial<PersistedDb>
  return {
    version: DB_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(input.settings ?? {}),
      providers: { ...DEFAULT_SETTINGS.providers, ...(input.settings?.providers ?? {}) }
    },
    tracks: input.tracks && typeof input.tracks === 'object' ? input.tracks : {},
    playlists: Array.isArray(input.playlists) ? input.playlists : [],
    favorites: Array.isArray(input.favorites) ? input.favorites : [],
    lyrics: input.lyrics && typeof input.lyrics === 'object' ? input.lyrics : {},
    history: Array.isArray(input.history) ? input.history.slice(-500) : [],
    session: { ...DEFAULT_SESSION, ...(input.session ?? {}) },
    importedPaths: Array.isArray(input.importedPaths) ? input.importedPaths : []
  }
}

export async function loadDb(): Promise<PersistedDb> {
  if (cache) return cache
  await fs.mkdir(userDataDir(), { recursive: true })
  try {
    const text = await fs.readFile(dbPath(), 'utf8')
    cache = migrate(JSON.parse(text))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      // Corrupt or unreadable: keep the bad file around so nothing is silently lost.
      try {
        await fs.rename(dbPath(), `${dbPath()}.corrupt-${Date.now()}`)
      } catch {
        /* best effort */
      }
    }
    cache = createDefaultDb()
  }
  return cache
}

/** Mutates the in-memory document and schedules a debounced write. */
export async function updateDb<T>(fn: (db: PersistedDb) => T): Promise<T> {
  const db = await loadDb()
  const result = fn(db)
  scheduleFlush()
  return result
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushNow()
  }, 400)
}

/** Writes immediately. Serialised so concurrent callers cannot interleave. */
export async function flushNow(): Promise<void> {
  if (!cache) return
  const snapshot = JSON.stringify(cache)
  writeChain = writeChain.then(async () => {
    const target = dbPath()
    const tmp = `${target}.tmp`
    await fs.writeFile(tmp, snapshot, 'utf8')
    await fs.rename(tmp, target)
  })
  return writeChain
}

/** Flush on quit; never throws. */
export async function flushAndClose(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  try {
    await flushNow()
  } catch {
    /* ignore */
  }
}
