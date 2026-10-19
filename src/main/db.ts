/**
 * Persistent store for the desktop app.
 *
 * Deliberately dependency-free: a single JSON document, written atomically and
 * debounced, in Electron's per-user data directory. Big enough for tens of
 * thousands of tracks while staying trivially inspectable and backup-friendly.
 *
 * The document lives inside a *profile* directory —
 * `userData/profiles/<id>/kolaars.json` — so several independent libraries can
 * coexist on one machine. Covers and offline downloads sit next to it, which
 * means switching a profile switches the whole library, not just the metadata.
 * `userData/profiles.json` is the small registry listing the profiles and
 * remembering which one is active.
 */

import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  createDefaultDb,
  createDefaultRegistry,
  DB_VERSION,
  DEFAULT_SESSION,
  DEFAULT_SETTINGS,
  PROFILES_VERSION,
  makeId
} from '@shared/defaults'
import type { PersistedDb, Profile, ProfilesRegistry } from '@shared/types'
import { allowMediaPathsOfTracks } from './media'

let registry: ProfilesRegistry | null = null
let activeDir = ''
let dbFile = ''
let cache: PersistedDb | null = null
let flushTimer: NodeJS.Timeout | null = null
let writeChain: Promise<void> = Promise.resolve()

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

function rootDir(): string {
  return app.getPath('userData')
}

function profilesRoot(): string {
  return path.join(rootDir(), 'profiles')
}

function registryFile(): string {
  return path.join(rootDir(), 'profiles.json')
}

function profileDir(id: string): string {
  return path.join(profilesRoot(), id)
}

/** Ids end up as directory names, so keep them to a strict, traversal-proof set. */
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i

function safeProfileId(id: string): string {
  const value = String(id ?? '').trim()
  if (!PROFILE_ID.test(value)) throw new Error('Некорректный идентификатор профиля')
  return value
}

/** Root directory of the active profile — all of the app's mutable data. */
export function userDataDir(): string {
  if (!activeDir) activeDir = profileDir(activeIdOrDefault())
  return activeDir
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

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

const LEGACY_ENTRIES = ['kolaars.json', 'covers', 'downloads']

/** Moves a pre-profiles installation into the first profile directory. */
async function adoptLegacyFiles(from: string, to: string): Promise<void> {
  for (const entry of LEGACY_ENTRIES) {
    const source = path.join(from, entry)
    const target = path.join(to, entry)
    try {
      await fs.access(source)
    } catch {
      continue // nothing to adopt
    }
    try {
      await fs.rename(source, target)
    } catch (error) {
      console.warn(`[profiles] не удалось перенести ${entry}: ${(error as Error).message}`)
    }
  }
}

async function readRegistry(): Promise<ProfilesRegistry | null> {
  try {
    const text = await fs.readFile(registryFile(), 'utf8')
    const raw = JSON.parse(text) as Partial<ProfilesRegistry>
    const profiles = Array.isArray(raw.profiles)
      ? raw.profiles.filter(
          (profile): profile is Profile =>
            Boolean(profile) && typeof profile.id === 'string' && PROFILE_ID.test(profile.id)
        )
      : []
    if (profiles.length === 0) return null
    const activeId = profiles.some((profile) => profile.id === raw.activeId)
      ? String(raw.activeId)
      : profiles[0].id
    return { version: PROFILES_VERSION, activeId, profiles }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      try {
        await fs.rename(registryFile(), `${registryFile()}.corrupt-${Date.now()}`)
      } catch {
        /* best effort */
      }
    }
    return null
  }
}

async function saveRegistry(next: ProfilesRegistry): Promise<void> {
  const target = registryFile()
  const tmp = `${target}.tmp`
  await fs.mkdir(rootDir(), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
  await fs.rename(tmp, target)
}

function activeIdOrDefault(): string {
  return registry?.activeId ?? 'default'
}

/**
 * Creates the profile registry on first run (adopting any pre-profiles files)
 * and makes sure the active profile directory exists. Safe to call repeatedly.
 */
export async function ensureProfiles(): Promise<ProfilesRegistry> {
  if (registry) return registry

  await fs.mkdir(rootDir(), { recursive: true })

  let found = await readRegistry()
  if (!found) {
    const id = 'default'
    const dir = profileDir(id)
    await fs.mkdir(dir, { recursive: true })
    await adoptLegacyFiles(rootDir(), dir)
    found = createDefaultRegistry(id)
    await saveRegistry(found)
  }

  registry = found
  activeDir = profileDir(found.activeId)
  dbFile = ''
  await fs.mkdir(activeDir, { recursive: true })
  return found
}

export async function listProfiles(): Promise<ProfilesRegistry> {
  return ensureProfiles()
}

export function activeProfile(): Profile | null {
  if (!registry) return null
  return registry.profiles.find((profile) => profile.id === registry?.activeId) ?? null
}

/** Flushes the current document and starts using another profile. */
async function switchTo(id: string): Promise<ProfilesRegistry> {
  const current = await ensureProfiles()
  const target = current.profiles.find((profile) => profile.id === id)
  if (!target) throw new Error('Профиль не найден')
  if (current.activeId === id) return current

  await flushAndClose()
  current.activeId = id
  await saveRegistry(current)
  registry = current
  activeDir = profileDir(id)
  dbFile = ''
  cache = null
  await fs.mkdir(activeDir, { recursive: true })
  return current
}

export async function createProfile(rawName: string): Promise<ProfilesRegistry> {
  const current = await ensureProfiles()
  const name = String(rawName ?? '').trim() || 'Новый профиль'
  const id = makeId('pf').replace(/[^a-z0-9_-]/gi, '').slice(0, 32)
  await fs.mkdir(profileDir(id), { recursive: true })
  current.profiles.push({ id, name: name.slice(0, 60), createdAt: Date.now() })
  await saveRegistry(current)
  return current
}

export async function renameProfile(id: string, rawName: string): Promise<ProfilesRegistry> {
  const current = await ensureProfiles()
  const target = current.profiles.find((profile) => profile.id === safeProfileId(id))
  if (!target) throw new Error('Профиль не найден')
  const name = String(rawName ?? '').trim()
  if (!name) throw new Error('Название профиля не может быть пустым')
  target.name = name.slice(0, 60)
  await saveRegistry(current)
  return current
}

/**
 * Removes a profile and its data. Deleting the active profile first switches to
 * another one; the last remaining profile can never be deleted.
 */
export async function deleteProfile(rawId: string): Promise<ProfilesRegistry> {
  const current = await ensureProfiles()
  const id = safeProfileId(rawId)
  if (!current.profiles.some((profile) => profile.id === id)) throw new Error('Профиль не найден')
  if (current.profiles.length <= 1) throw new Error('Нельзя удалить единственный профиль')

  if (current.activeId === id) {
    const fallback = current.profiles.find((profile) => profile.id !== id)
    if (fallback) await switchTo(fallback.id)
  }

  const next = await ensureProfiles()
  next.profiles = next.profiles.filter((profile) => profile.id !== id)
  await saveRegistry(next)
  registry = next
  try {
    await fs.rm(profileDir(id), { recursive: true, force: true })
  } catch (error) {
    console.warn(`[profiles] каталог ${id} не удалён: ${(error as Error).message}`)
  }
  return next
}

export async function setActiveProfile(id: string): Promise<ProfilesRegistry> {
  return switchTo(safeProfileId(id))
}

/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

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
  await ensureProfiles()
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
  // The media allowlist lives in memory, so it has to be rebuilt from the
  // document it just read: without this, covers and audio of files imported in
  // an earlier session would be refused after a restart or a profile switch.
  allowMediaPathsOfTracks(Object.values(cache.tracks))
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
