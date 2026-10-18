/**
 * Default values and small helpers shared by main and renderer.
 */

import type { PersistedDb, Settings, SessionState } from './types'

export const DB_VERSION = 1

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
    wikisource: true
  },
  normalizeLoudness: false,
  downloadDir: '',
  volumeTrim: 0,
  notifications: true
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
