/**
 * Offline downloads.
 *
 * Streams a remote track to disk (by default `<userData>/downloads`, or the
 * folder chosen in Settings) so it can be played without a connection. Along
 * with the audio we drop a small `<name>.kolaars.json` sidecar containing the
 * provenance (original URL, license, artist) — that keeps downloaded files
 * self-describing and attributable if the user moves them elsewhere.
 */

import { app } from 'electron'
import { createWriteStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { allowMediaPath, encodeMediaUrl } from './media'
import { downloadsDir } from './db'
import { fetchRaw } from './http'
import { safeFileName } from '@shared/defaults'
import type { Track } from '@shared/types'

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'error' | 'cancelled'

export interface DownloadRecord {
  trackId: string
  title: string
  artist: string
  filePath: string
  bytesTotal: number
  bytesDone: number
  status: DownloadStatus
  error?: string
  startedAt: number
  finishedAt?: number
}

const records = new Map<string, DownloadRecord>()
const controllers = new Map<string, AbortController>()
const pending = new Map<string, Track>()

type ProgressSink = (record: DownloadRecord) => void
let sink: ProgressSink = () => {}

export function setProgressSink(fn: ProgressSink): void {
  sink = fn
}

export function listDownloads(): DownloadRecord[] {
  return Array.from(records.values())
}

export function getDownload(trackId: string): DownloadRecord | undefined {
  return records.get(trackId)
}

/**
 * Forgets every download record without touching the files on disk. Used when
 * switching profiles: the records and their paths belong to the profile that
 * started them, and the next profile must not see them.
 */
export function forgetDownloads(): void {
  for (const controller of controllers.values()) controller.abort()
  controllers.clear()
  pending.clear()
  records.clear()
}

function fileExtensionFor(track: Track): string {
  const fromUrl = track.streamUrl.split('?')[0].match(/\.([a-z0-9]{2,4})$/i)
  if (fromUrl) return `.${fromUrl[1].toLowerCase()}`
  return '.mp3'
}

export function downloadTargetPath(track: Track, dir: string): string {
  const base = safeFileName(`${track.artist} - ${track.title}`, 'track')
  const ext = fileExtensionFor(track)
  // Bounded, deterministic name; collisions get a numeric suffix.
  return path.join(dir, `${base}${ext}`)
}

async function uniquePath(target: string): Promise<string> {
  try {
    await fs.access(target)
  } catch {
    return target
  }
  const ext = path.extname(target)
  const stem = target.slice(0, -ext.length)
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`
    try {
      await fs.access(candidate)
    } catch {
      return candidate
    }
  }
  return `${stem} (${Date.now()})${ext}`
}

function emit(record: DownloadRecord): void {
  sink(record)
}

/** Starts (or returns the existing) download for a track. */
export function startDownload(track: Track, dir: string): DownloadRecord {
  const existing = records.get(track.id)
  if (existing && (existing.status === 'downloading' || existing.status === 'done')) {
    return existing
  }

  const record: DownloadRecord = {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    filePath: '',
    bytesTotal: 0,
    bytesDone: 0,
    status: 'queued',
    startedAt: Date.now()
  }
  records.set(track.id, record)
  pending.set(track.id, track)
  emit({ ...record })

  void run(track, dir, record)
  return record
}

async function run(track: Track, dir: string, record: DownloadRecord): Promise<void> {
  const controller = new AbortController()
  controllers.set(track.id, controller)

  try {
    await fs.mkdir(dir, { recursive: true })
    const target = await uniquePath(downloadTargetPath(track, dir))
    const partial = `${target}.part`

    const response = await fetchRaw(track.streamUrl, {
      timeoutMs: 120_000,
      signal: controller.signal
    })
    const total = Number(response.headers.get('content-length') ?? 0)
    if (!response.body) throw new Error('Empty response body')

    record.status = 'downloading'
    record.bytesTotal = Number.isFinite(total) ? total : 0
    record.filePath = target
    emit({ ...record })

    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    let written = 0
    let lastEmit = 0
    source.on('data', (chunk: Buffer) => {
      written += chunk.length
      record.bytesDone = written
      const now = Date.now()
      if (now - lastEmit > 250) {
        lastEmit = now
        emit({ ...record })
      }
    })

    await pipeline(source, createWriteStream(partial))
    await fs.rename(partial, target)

    record.status = 'done'
    record.bytesDone = written
    record.finishedAt = Date.now()
    if (!record.bytesTotal) record.bytesTotal = written
    allowMediaPath(target)

    await writeSidecar(track, target)
    emit({ ...record })
  } catch (err) {
    const aborted = controller.signal.aborted
    record.status = aborted ? 'cancelled' : 'error'
    record.error = (err as Error).message
    record.finishedAt = Date.now()
    emit({ ...record })
    if (record.filePath) await fs.rm(record.filePath, { force: true }).catch(() => undefined)
  } finally {
    controllers.delete(track.id)
    pending.delete(track.id)
  }
}

async function writeSidecar(track: Track, target: string): Promise<void> {
  const sidecar = `${target}.kolaars.json`
  const payload = {
    app: 'Kolaars Music',
    downloadedAt: new Date().toISOString(),
    title: track.title,
    artist: track.artist,
    album: track.album ?? null,
    year: track.year ?? null,
    duration: track.duration ?? null,
    license: track.license ?? null,
    licenseUrl: track.licenseUrl ?? null,
    sourceUrl: track.sourceUrl ?? null,
    originalStreamUrl: track.streamUrl,
    attribution: `${track.artist} — ${track.title}`
  }
  await fs.writeFile(sidecar, JSON.stringify(payload, null, 2), 'utf8').catch(() => undefined)
}

export function cancelDownload(trackId: string): boolean {
  const controller = controllers.get(trackId)
  if (!controller) return false
  controller.abort()
  return true
}

export async function removeDownload(trackId: string): Promise<boolean> {
  const record = records.get(trackId)
  if (!record) return false
  cancelDownload(trackId)
  if (record.filePath) {
    await fs.rm(record.filePath, { force: true }).catch(() => undefined)
    await fs.rm(`${record.filePath}.kolaars.json`, { force: true }).catch(() => undefined)
  }
  records.delete(trackId)
  return true
}

/** Resolves the effective download directory for the current settings. */
export function resolveDownloadDir(configured: string): string {
  if (configured && configured.trim()) return configured
  return downloadsDir()
}

/** Re-attaches already-downloaded files to the media protocol on startup. */
export async function restoreDownloads(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile()) allowMediaPath(path.join(dir, entry.name))
    }
  } catch {
    /* directory does not exist yet */
  }
}

export { app, encodeMediaUrl }
