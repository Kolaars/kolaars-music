/**
 * JSON store for the Android build.
 *
 * The desktop app keeps `kolaars.json` inside Electron's `userData`. On Android
 * the same document lives in the app's private `Directory.Data` folder, which is
 * the closest equivalent: invisible to other apps and removed on uninstall.
 * Profiles keep the same on-disk shape (`profiles/<id>/kolaars.json`) so an
 * exported profile can move between the two builds.
 */

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { App } from '@capacitor/app'
import {
  createDefaultDb,
  createDefaultRegistry,
  DB_VERSION,
  DEFAULT_SESSION,
  DEFAULT_SETTINGS,
  PROFILES_VERSION,
  makeId
} from '@shared/defaults'
import type { PersistedDb, Profile, ProfilesRegistry, Settings, SessionState } from '@shared/types'

const ROOT = ''
const REGISTRY_FILE = 'profiles.json'
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i

let registry: ProfilesRegistry | null = null
let cache: PersistedDb | null = null
let activeDir = ''
let flushTimer: number | null = null
let writeChain: Promise<void> = Promise.resolve()

/* ------------------------------------------------------------------ */
/* Small filesystem helpers                                            */
/* ------------------------------------------------------------------ */

function isMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /not exist|enoent|no such file|does not exist/i.test(message)
}

async function readText(path: string): Promise<string | null> {
  try {
    const file = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8
    })
    return typeof file.data === 'string' ? file.data : null
  } catch (error) {
    if (isMissing(error)) return null
    console.warn(`[storage] не удалось прочитать ${path}: ${String(error)}`)
    return null
  }
}

async function ensureDir(path: string): Promise<void> {
  if (!path) return
  try {
    await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true })
  } catch (error) {
    // Already existing is reported as an error by some plugins.
    if (!/exist/i.test(String(error))) throw error
  }
}

async function writeText(path: string, text: string): Promise<void> {
  await Filesystem.writeFile({ path, directory: Directory.Data, data: text, encoding: Encoding.UTF8 })
}

/** Writes through a temp file so a kill mid-write cannot truncate the store. */
async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`
  await writeText(tmp, text)
  try {
    await Filesystem.rename({ from: tmp, to: path, directory: Directory.Data })
  } catch {
    // Some Android filesystems refuse rename when the target exists.
    try {
      await Filesystem.deleteFile({ path, directory: Directory.Data })
    } catch {
      /* nothing to delete */
    }
    await Filesystem.rename({ from: tmp, to: path, directory: Directory.Data })
  }
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

function profileDir(id: string): string {
  return `profiles/${id}`
}

function dbPath(): string {
  return `${activeDir}/kolaars.json`
}

function safeProfileId(id: string): string {
  const value = String(id ?? '').trim()
  if (!PROFILE_ID.test(value)) throw new Error('Некорректный идентификатор профиля')
  return value
}

async function readRegistry(): Promise<ProfilesRegistry | null> {
  const text = await readText(REGISTRY_FILE)
  if (!text) return null
  try {
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
  } catch {
    await Filesystem.rename({
      from: REGISTRY_FILE,
      to: `${REGISTRY_FILE}.corrupt-${Date.now()}`,
      directory: Directory.Data
    }).catch(() => undefined)
    return null
  }
}

async function saveRegistry(next: ProfilesRegistry): Promise<void> {
  await ensureDir(ROOT)
  await writeAtomic(REGISTRY_FILE, JSON.stringify(next, null, 2))
}

export async function ensureProfiles(): Promise<ProfilesRegistry> {
  if (registry) return registry
  await ensureDir(ROOT)

  let found = await readRegistry()
  if (!found) {
    const id = 'default'
    await ensureDir(profileDir(id))
    found = createDefaultRegistry(id)
    await saveRegistry(found)
  }

  registry = found
  activeDir = profileDir(found.activeId)
  cache = null
  await ensureDir(activeDir)
  return found
}

export async function listProfiles(): Promise<ProfilesRegistry> {
  return ensureProfiles()
}

export function activeProfile(): Profile | null {
  if (!registry) return null
  return registry.profiles.find((profile) => profile.id === registry?.activeId) ?? null
}

export async function setActiveProfile(rawId: string): Promise<ProfilesRegistry> {
  const current = await ensureProfiles()
  const id = safeProfileId(rawId)
  if (!current.profiles.some((profile) => profile.id === id)) throw new Error('Профиль не найден')
  if (current.activeId === id) return current

  await flushNow()
  current.activeId = id
  await saveRegistry(current)
  registry = current
  activeDir = profileDir(id)
  cache = null
  await ensureDir(activeDir)
  return current
}

export async function createProfile(rawName: string): Promise<ProfilesRegistry> {
  const current = await ensureProfiles()
  const name = String(rawName ?? '').trim() || 'Новый профиль'
  const id = makeId('pf').replace(/[^a-z0-9_-]/gi, '').slice(0, 32)
  await ensureDir(profileDir(id))
  current.profiles.push({ id, name: name.slice(0, 60), createdAt: Date.now() })
  await saveRegistry(current)
  return current
}

export async function renameProfile(rawId: string, rawName: string): Promise<ProfilesRegistry> {
  const current = await ensureProfiles()
  const target = current.profiles.find((profile) => profile.id === safeProfileId(rawId))
  if (!target) throw new Error('Профиль не найден')
  const name = String(rawName ?? '').trim()
  if (!name) throw new Error('Название профиля не может быть пустым')
  target.name = name.slice(0, 60)
  await saveRegistry(current)
  return current
}

export async function deleteProfile(rawId: string): Promise<ProfilesRegistry> {
  const current = await ensureProfiles()
  const id = safeProfileId(rawId)
  if (!current.profiles.some((profile) => profile.id === id)) throw new Error('Профиль не найден')
  if (current.profiles.length <= 1) throw new Error('Нельзя удалить единственный профиль')

  if (current.activeId === id) {
    const fallback = current.profiles.find((profile) => profile.id !== id)
    if (fallback) await setActiveProfile(fallback.id)
  }

  const next = await ensureProfiles()
  next.profiles = next.profiles.filter((profile) => profile.id !== id)
  await saveRegistry(next)
  registry = next
  await Filesystem.rmdir({ path: profileDir(id), directory: Directory.Data, recursive: true }).catch(
    () => undefined
  )
  return next
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
  await ensureDir(activeDir)
  const text = await readText(dbPath())
  if (!text) {
    cache = createDefaultDb()
    return cache
  }
  try {
    cache = migrate(JSON.parse(text))
  } catch {
    await Filesystem.rename({
      from: dbPath(),
      to: `${dbPath()}.corrupt-${Date.now()}`,
      directory: Directory.Data
    }).catch(() => undefined)
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
  if (flushTimer !== null) window.clearTimeout(flushTimer)
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flushNow()
  }, 400)
}

/** Writes immediately. Serialised so concurrent callers cannot interleave. */
export async function flushNow(): Promise<void> {
  if (!cache) return
  const snapshot = JSON.stringify(cache)
  const target = dbPath()
  writeChain = writeChain.then(async () => {
    await ensureDir(activeDir)
    await writeAtomic(target, snapshot)
  })
  return writeChain
}

export async function flushAndClose(): Promise<void> {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
  try {
    await flushNow()
  } catch {
    /* ignore */
  }
}

/** Android may freeze the WebView at any moment; flush when it goes to background. */
export function installLifecycleFlush(): void {
  void App.addListener('pause', () => {
    void flushAndClose()
  })
  void App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) void flushAndClose()
  })
}

export function userDataLabel(): string {
  return activeDir || 'files/profiles/default'
}

export function downloadsLabel(): string {
  return `${userDataLabel()}/downloads`
}

export function setSettings(patch: Partial<Settings>): Promise<Settings> {
  return updateDb((db) => {
    db.settings = {
      ...db.settings,
      ...patch,
      providers: { ...db.settings.providers, ...(patch.providers ?? {}) }
    }
    return db.settings
  })
}

export function setSession(patch: Partial<SessionState>): Promise<SessionState> {
  return updateDb((db) => {
    db.session = { ...db.session, ...patch }
    return db.session
  })
}

export function profileId(): string {
  return registry?.activeId ?? 'default'
}
