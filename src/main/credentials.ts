/**
 * Encrypted storage for external-provider credentials.
 *
 * The API keys never enter the renderer and never sit in `kolaars.json` in
 * plain text. They are encrypted with Electron's `safeStorage` (DPAPI on
 * Windows, Keychain on macOS, libsecret on Linux) and written to a separate
 * file in the user-data directory.
 *
 * This app only stores keys for *official* provider APIs. It has no facility
 * for account passwords, session cookies or tokens of private APIs.
 */

import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ExternalProvider } from '@shared/types'

const FILE_NAME = 'sources.json'
const VERSION = 1

interface StoredFile {
  version: number
  /** Provider id -> base64 of the encrypted value. */
  entries: Partial<Record<ExternalProvider, string>>
}

let cache: StoredFile | null = null
let loading: Promise<StoredFile> | null = null
/** Serialises read-modify-write cycles so two quick saves cannot lose a key. */
let mutations: Promise<unknown> = Promise.resolve()

function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = mutations.then(task, task)
  mutations = next.catch(() => undefined)
  return next
}

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function isProvider(value: unknown): value is ExternalProvider {
  return value === 'youtube' || value === 'soundcloud'
}

async function readFile(): Promise<StoredFile> {
  if (cache) return cache
  if (!loading) {
    loading = (async () => {
      try {
        const text = await fs.readFile(filePath(), 'utf8')
        const parsed = JSON.parse(text) as Partial<StoredFile>
        cache = {
          version: VERSION,
          entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
        }
      } catch {
        // Missing or unreadable file is simply "nothing is connected yet".
        cache = { version: VERSION, entries: {} }
      } finally {
        loading = null
      }
      return cache as StoredFile
    })()
  }
  return loading
}

async function writeFile(next: StoredFile): Promise<void> {
  const target = filePath()
  const temp = `${target}.tmp`
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 })
  await fs.rename(temp, target)
  cache = next
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Системное шифрование недоступно — ключ не сохранён. Проверьте настройки входа в систему.'
    )
  }
  return safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return null
  }
}

/** Reads the stored credential for one provider, or null when absent. */
export async function getCredential(provider: ExternalProvider): Promise<string | null> {
  const file = await readFile()
  const encoded = file.entries[provider]
  if (!encoded) return null
  const value = decrypt(encoded)
  return value && value.trim() ? value.trim() : null
}

/** Stores (or replaces) a credential. Empty values are rejected. */
export async function setCredential(provider: ExternalProvider, rawValue: string): Promise<void> {
  if (!isProvider(provider)) throw new Error('Неизвестный источник')
  const value = String(rawValue ?? '').trim()
  if (!value) throw new Error('Ключ не может быть пустым')
  if (value.length > 512) throw new Error('Ключ слишком длинный')

  await serial(async () => {
    const file = await readFile()
    const entries: StoredFile['entries'] = { ...file.entries, [provider]: encrypt(value) }
    await writeFile({ version: VERSION, entries })
  })
}

export async function clearCredential(provider: ExternalProvider): Promise<void> {
  if (!isProvider(provider)) throw new Error('Неизвестный источник')
  await serial(async () => {
    const file = await readFile()
    const entries = { ...file.entries }
    delete entries[provider]
    await writeFile({ version: VERSION, entries })
  })
}

/** Which providers have a usable key. Never returns the keys themselves. */
export async function credentialsStatus(): Promise<Record<ExternalProvider, boolean>> {
  const file = await readFile()
  const present = (provider: ExternalProvider): boolean => {
    const encoded = file.entries[provider]
    if (!encoded) return false
    const value = decrypt(encoded)
    return Boolean(value && value.trim())
  }
  return {
    youtube: present('youtube'),
    soundcloud: present('soundcloud')
  }
}
