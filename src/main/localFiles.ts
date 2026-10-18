/**
 * Importing music from the user's disk.
 *
 * Tags are read with `music-metadata` (pure JS, loaded lazily so startup stays
 * fast). Embedded cover art is written once into the app's `covers` directory
 * and referenced through the `kmedia://` protocol. A sidecar `.lrc` next to an
 * audio file is imported automatically — the standard way people ship synced
 * lyrics with their own music.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { allowMediaPath, encodeMediaUrl } from './media'
import { coversDir, userDataDir } from './db'
import { parseLrc } from '@shared/lrc'
import type { Lyrics, Track } from '@shared/types'

export const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.m4b',
  '.aac',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.aiff',
  '.aif',
  '.wma',
  '.ape',
  '.mpc',
  '.wv'
])

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export interface ImportOutcome {
  tracks: Track[]
  lyrics: Lyrics[]
  skipped: string[]
  failed: { path: string; error: string }[]
}

function localTrackId(filePath: string): string {
  const hash = crypto.createHash('sha1').update(filePath.toLowerCase()).digest('hex')
  return `local:${hash.slice(0, 24)}`
}

/** Recursively collects audio files, ignoring dot-directories. */
export async function collectAudioFiles(root: string, maxDepth = 6): Promise<string[]> {
  const out: string[] = []
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]

  while (stack.length > 0) {
    const { dir, depth } = stack.pop() as { dir: string; depth: number }
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < maxDepth) stack.push({ dir: full, depth: depth + 1 })
      } else if (entry.isFile() && isAudioFile(full)) {
        out.push(full)
      }
    }
  }

  out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return out
}

type MmModule = {
  parseFile: (
    filePath: string,
    options?: { duration?: boolean; skipCovers?: boolean }
  ) => Promise<{
    common: {
      title?: string
      artist?: string
      artists?: string[]
      album?: string
      albumartist?: string
      year?: number
      genre?: string[]
      track?: { no: number | null }
      disk?: { no: number | null }
      picture?: { format: string; data: Uint8Array }[]
    }
    format: { duration?: number; bitrate?: number; sampleRate?: number; container?: string }
  }>
}

let mmPromise: Promise<MmModule | null> | null = null

/** `music-metadata` is ESM-only; load it once, lazily, from CommonJS. */
function loadMusicMetadata(): Promise<MmModule | null> {
  if (!mmPromise) {
    mmPromise = import('music-metadata')
      .then((mod) => mod as unknown as MmModule)
      .catch(() => null)
  }
  return mmPromise
}

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp'
}

async function writeCover(trackId: string, format: string, data: Uint8Array): Promise<string | null> {
  const ext = IMAGE_EXT[format.toLowerCase()] ?? '.jpg'
  const dir = coversDir()
  const target = path.join(dir, `${trackId.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`)
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(target, data)
    allowMediaPath(target)
    return encodeMediaUrl(target)
  } catch {
    return null
  }
}

function cleanTag(value: string | undefined | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * Reads one audio file. Never throws: unreadable tags degrade to
 * filename-derived metadata so the file still becomes playable.
 */
export async function importAudioFile(filePath: string): Promise<{ track: Track; lyrics: Lyrics | null }> {
  const id = localTrackId(filePath)
  const baseName = path.basename(filePath, path.extname(filePath))

  const track: Track = {
    id,
    title: baseName,
    artist: 'Неизвестный исполнитель',
    album: null,
    year: null,
    genres: [],
    duration: null,
    artwork: null,
    source: 'local',
    streamUrl: encodeMediaUrl(filePath),
    identifier: null,
    filePath,
    license: null,
    licenseUrl: null,
    sourceUrl: null,
    offline: true,
    addedAt: Date.now()
  }

  const mm = await loadMusicMetadata()
  if (mm) {
    try {
      const parsed = await mm.parseFile(filePath, { duration: true })
      const { common, format } = parsed
      track.title = cleanTag(common.title) ?? baseName
      const artist = cleanTag(common.artist) ?? cleanTag(common.artists?.join(', '))
      track.artist = artist ?? cleanTag(common.albumartist) ?? 'Неизвестный исполнитель'
      track.album = cleanTag(common.album)
      track.year = common.year ?? null
      track.genres = (common.genre ?? []).map((g) => String(g).trim()).filter(Boolean).slice(0, 6)
      track.duration = format.duration ? Math.round(format.duration) : null

      const picture = common.picture?.[0]
      if (picture?.data) {
        track.artwork = await writeCover(id, picture.format, picture.data)
      }
    } catch {
      /* keep filename-derived metadata */
    }
  }

  allowMediaPath(filePath)

  // Sidecar lyrics: `song.mp3` + `song.lrc`.
  let lyrics: Lyrics | null = null
  try {
    const lrcPath = path.join(path.dirname(filePath), `${baseName}.lrc`)
    const text = await fs.readFile(lrcPath, 'utf8')
    const parsed = parseLrc(text)
    lyrics = {
      trackId: id,
      plain: parsed.plain,
      synced: parsed.synced.length ? parsed.synced : null,
      meta: parsed.meta,
      origin: 'lrc-file',
      provider: path.basename(lrcPath),
      language: null,
      updatedAt: Date.now()
    }
  } catch {
    /* no sidecar lyrics */
  }

  return { track, lyrics }
}

/** Imports a list of files and/or directories. */
export async function importPaths(
  inputs: string[],
  onProgress?: (done: number, total: number, current: string) => void
): Promise<ImportOutcome> {
  await fs.mkdir(userDataDir(), { recursive: true })

  const files: string[] = []
  const skipped: string[] = []

  for (const input of inputs) {
    let stat: import('node:fs').Stats | null = null
    try {
      stat = await fs.stat(input)
    } catch {
      skipped.push(input)
      continue
    }
    if (stat.isDirectory()) {
      files.push(...(await collectAudioFiles(input)))
    } else if (isAudioFile(input)) {
      files.push(input)
    } else {
      skipped.push(input)
    }
  }

  const unique = Array.from(new Set(files.map((f) => path.resolve(f))))
  const tracks: Track[] = []
  const lyrics: Lyrics[] = []
  const failed: { path: string; error: string }[] = []

  let done = 0
  for (const file of unique) {
    try {
      const result = await importAudioFile(file)
      tracks.push(result.track)
      if (result.lyrics) lyrics.push(result.lyrics)
    } catch (err) {
      failed.push({ path: file, error: (err as Error).message })
    }
    done++
    onProgress?.(done, unique.length, path.basename(file))
  }

  return { tracks, lyrics, skipped, failed }
}
