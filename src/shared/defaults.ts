/**
 * Default values and small helpers shared by main and renderer.
 */

import type { PersistedDb, ProfilesRegistry, Settings, SessionState } from './types'

export const DB_VERSION = 1

export const PROFILES_VERSION = 1

/** Name given to the profile that adopts a pre-profiles installation. */
export const DEFAULT_PROFILE_NAME = 'Основной'

/**
 * Which local file to keep when the same song is on disk in several formats,
 * best first. Lossless containers lead, then the compact ones, roughly in the
 * order of what they carry per megabyte. The user can reorder this in Settings.
 */
export const DEFAULT_FORMAT_PRIORITY = [
  '.flac',
  '.wav',
  '.aiff',
  '.aif',
  '.ape',
  '.wv',
  '.m4a',
  '.m4b',
  '.opus',
  '.ogg',
  '.oga',
  '.mp3',
  '.aac',
  '.wma',
  '.mpc'
]

/**
 * Position of a file extension in the priority list — 0 is the best. Formats
 * the user did not list sort after every listed one, alphabetically among
 * themselves, so an unknown extension never silently outranks a known one.
 */
export function formatRank(extension: string, priority: readonly string[] = DEFAULT_FORMAT_PRIORITY): number {
  const index = priority.indexOf(extension.toLowerCase())
  return index === -1 ? priority.length : index
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#7c5cff',
  crossfade: 0,
  resumeSession: true,
  preferLossless: false,
  onlineProviders: true,
  providers: {
    archive: true,
    lrclib: true,
    wikisource: true,
    youtube: true,
    soundcloud: true
  },
  normalizeLoudness: false,
  downloadDir: '',
  volumeTrim: 0,
  notifications: true,
  formatPriority: [...DEFAULT_FORMAT_PRIORITY]
}

export const DEFAULT_SESSION: SessionState = {
  trackId: null,
  position: 0,
  volume: 0.85,
  muted: false,
  shuffle: false,
  repeat: 'off',
  queue: [],
  queueIndex: -1
}

export function createDefaultDb(): PersistedDb {
  return {
    version: DB_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    tracks: {},
    playlists: [],
    favorites: [],
    lyrics: {},
    history: [],
    session: { ...DEFAULT_SESSION },
    importedPaths: []
  }
}

/** An empty registry holding a single, freshly named profile. */
export function createDefaultRegistry(id: string, name = DEFAULT_PROFILE_NAME): ProfilesRegistry {
  return {
    version: PROFILES_VERSION,
    activeId: id,
    profiles: [{ id, name, createdAt: Date.now() }]
  }
}

/** Windows-safe, human readable file name. */
export function safeFileName(input: string, fallback = 'track'): string {
  const cleaned = input
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return (cleaned || fallback).slice(0, 120)
}

/** mm:ss (or h:mm:ss) from a number of seconds. */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Stable id generator that works in main and renderer. */
export function makeId(prefix = 'id'): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  const uuid = g.crypto?.randomUUID?.()
  if (uuid) return `${prefix}_${uuid.replace(/-/g, '').slice(0, 20)}`
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
