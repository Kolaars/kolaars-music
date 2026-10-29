/**
 * Local music on Android.
 *
 * Android hands out `content://` URIs through the Storage Access Framework and
 * nothing else: there are no POSIX paths to hand to a tag reader, and the
 * WebView cannot open a `content://` URL either. So the import works in two
 * steps that match the desktop one from the UI's point of view:
 *
 * 1. the native half (`LocalFilesPlugin`) asks the user for files or a folder,
 *    then copies the chosen audio into `files/music`, untouched;
 * 2. this module reads names and tags, pairs `.lrc` and cover sidecars, applies
 *    the same duplicate rules as the desktop importer, and writes the tracks
 *    into the profile database.
 *
 * Playback then uses `Capacitor.convertFileSrc()`, which maps an app-private
 * file to a `https://localhost/_capacitor_file_…` URL the media element can
 * actually load.
 */

import { Capacitor, registerPlugin } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { DEFAULT_FORMAT_PRIORITY, formatRank } from '@shared/defaults'
import { baseName, extensionOf, isAudioFile, isCoverFile, isLyricsFile, songKey } from '@shared/audio-files'
import { findMoovStart, readAudioMeta, type AudioMeta } from '@shared/audio-tags'
import { restoreForbiddenCharacters } from '@shared/fileNames'
import { parseLrc, serializeLrc } from '@shared/lrc'
import { parseArtistTitle, PLAYLIST_FILE_FORMATS, serializePlaylist } from '@shared/tracklist'
import type { ImportOutcome } from '@shared/api'
import type { Lyrics, Playlist, PersistedDb, Track } from '@shared/types'
import { loadDb, updateDb } from './storage'
import type { PlaylistFileFormat } from '@shared/tracklist'

/* ------------------------------------------------------------------ */
/* Native bridge                                                       */
/* ------------------------------------------------------------------ */

export interface TreeEntry {
  uri: string
  name: string
  mime: string
  size: number
}

export interface DocumentInfo {
  uri: string
  name: string
  size: number
  mime: string
}

interface LocalFilesBridge {
  pickFiles(options: { mimeType?: string }): Promise<{ uris: string[] }>
  pickFolder(): Promise<{ uri: string | null; name?: string }>
  pickTextFile(options?: { mimeType?: string }): Promise<{ path: string | null; name?: string; text?: string }>
  listTree(options: { uri: string }): Promise<{ entries: TreeEntry[] }>
  describe(options: { uris: string[] }): Promise<{ documents: DocumentInfo[] }>
  copyToMusic(options: { uri: string; name?: string; folder?: string }): Promise<{
    path: string
    name: string
    size: number
  }>
  readText(options: { uri: string }): Promise<{ text: string }>
  deleteFile(options: { path: string }): Promise<{ removed: boolean }>
  writeText(options: { fileName: string; mimeType?: string; text: string }): Promise<{
    uri: string | null
    name?: string
  }>
}

export const LocalFiles = registerPlugin<LocalFilesBridge>('LocalFiles')

/** A picked handle: a `content://` document, or a `content://…/tree/…` folder. */
export function isFolderHandle(handle: string): boolean {
  return /\/tree\//i.test(String(handle ?? ''))
}

function pluginPresent(): boolean {
  return Capacitor.isPluginAvailable('LocalFiles')
}

function assertPlugin(): void {
  if (!pluginPresent()) {
    throw new Error('Системный выбор файлов недоступен на этом устройстве')
  }
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** Turns an app-private path into a URL the WebView can stream. */
export function fileUrl(path: string): string {
  const convert = (window as unknown as { Capacitor?: { convertFileSrc?: (p: string) => string } })
    .Capacitor?.convertFileSrc
  try {
    return convert ? convert(path) : path
  } catch {
    return path
  }
}

function localTrackId(filePath: string): string {
  // FNV-1a over the lower-cased path: stable across imports, cheap, and the id
  // only has to be unique inside this profile.
  const text = filePath.toLowerCase()
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return `local:${hash.toString(16).padStart(16, '0')}`
}

const GENERIC_COVER_NAMES = new Set(['cover', 'folder', 'front', 'album', 'artwork'])

/* ------------------------------------------------------------------ */
/* Tags                                                                */
/* ------------------------------------------------------------------ */

/** Enough of a file to hold an ID3/FLAC header or an MP4 `moov` at the front. */
const META_HEAD_BYTES = 2 * 1024 * 1024
const META_TAIL_BYTES = 1024 * 1024

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  // `String.fromCharCode(...bytes)` blows the stack on a big cover.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** App-private paths only; the Filesystem plugin resolves them from `Data`. */
function filesRelative(path: string): string | null {
  const marker = '/files/'
  const index = path.indexOf(marker)
  return index < 0 ? null : path.slice(index + marker.length)
}

async function readSlice(path: string, offset: number, length: number): Promise<Uint8Array | null> {
  const relative = filesRelative(path)
  if (!relative) return null
  try {
    const { data } = await Filesystem.readFile({
      path: relative,
      directory: Directory.Data,
      offset,
      length
    })
    return typeof data === 'string' ? bytesFromBase64(data) : null
  } catch {
    return null
  }
}

/**
 * Reads the tags of a copied file.
 *
 * Only a couple of megabytes are fetched — enough for MP3 and FLAC, whose
 * metadata sits at the front. iTunes-style M4A files keep their `moov` after
 * the audio, so when the head has none the tail is scanned for it and just that
 * box is fetched.
 */
/** Containers this reader understands. Others are left to the decoder. */
const TAGGED_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.m4b', '.mp4', '.alac'])

async function readTrackMeta(path: string, size: number): Promise<AudioMeta> {
  if (!TAGGED_EXTENSIONS.has(extensionOf(path))) return {}
  const known = size > 0 ? size : 0
  const head = await readSlice(path, 0, known ? Math.min(known, META_HEAD_BYTES) : META_HEAD_BYTES)
  if (!head) return {}

  const isMp4 = head.length > 8 && String.fromCharCode(head[4], head[5], head[6], head[7]) === 'ftyp'
  const meta = readAudioMeta(head, known || head.length)
  if (!isMp4 || meta.title || meta.cover || meta.duration) return meta
  if (known <= head.length) return meta

  const tailStart = Math.max(0, known - META_TAIL_BYTES)
  const tail = await readSlice(path, tailStart, known - tailStart)
  if (!tail) return meta
  const moov = findMoovStart(tail)
  if (!moov) return meta
  const box = await readSlice(path, tailStart + moov.offset, moov.size)
  return box ? readAudioMeta(box, known) : meta
}

/** Writes embedded cover art into `files/covers`, like the sidecar copy. */
async function saveEmbeddedCover(
  musicPath: string,
  id: string,
  cover: NonNullable<AudioMeta['cover']>
): Promise<string | null> {
  const marker = '/files/'
  const index = musicPath.indexOf(marker)
  if (index < 0) return null
  const root = musicPath.slice(0, index + marker.length)
  const format = cover.format.includes('png') ? 'png' : cover.format.includes('webp') ? 'webp' : 'jpg'
  const name = `${id.replace(':', '_')}.${format}`
  try {
    await Filesystem.writeFile({
      path: `covers/${name}`,
      data: base64FromBytes(cover.data),
      directory: Directory.Data,
      recursive: true
    })
    return fileUrl(`${root}covers/${name}`)
  } catch {
    return null
  }
}

/**
 * Tag values win over the file name, because they were written by whoever
 * mastered the track. Missing fields stay as the name made them.
 */
function applyMeta(track: Track, meta: AudioMeta): Track {
  if (meta.title) track.title = meta.title
  if (meta.artist) track.artist = meta.artist
  if (meta.album) track.album = meta.album
  if (meta.year) track.year = meta.year
  if (meta.genres?.length) track.genres = meta.genres
  if (meta.duration && meta.duration > 0) track.duration = meta.duration
  return track
}

function pickCover(entries: TreeEntry[], key: string): TreeEntry | null {
  const covers = entries.filter((entry) => isCoverFile(entry.name))
  return (
    covers.find((entry) => songKey(entry.name) === key) ??
    covers.find((entry) => GENERIC_COVER_NAMES.has(songKey(entry.name))) ??
    null
  )
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

interface Candidate {
  uri: string
  name: string
  size: number
  /** `.lrc` and cover siblings found in the same picked folder. */
  lyrics?: Lyrics
  cover?: { uri: string; name: string }
}

/**
 * Expands the picked handles into audio candidates.
 *
 * A folder is listed natively in one pass, so sidecars are paired before
 * anything is copied; a single file has no siblings to look at.
 */
async function collectCandidates(
  handles: string[],
  skipped: string[]
): Promise<Candidate[]> {
  const out: Candidate[] = []

  for (const handle of handles) {
    if (isFolderHandle(handle)) {
      const { entries } = await LocalFiles.listTree({ uri: handle })
      for (const entry of entries) {
        if (!isAudioFile(entry.name)) continue
        const key = songKey(entry.name)
        const lrcEntry = entries.find((item) => isLyricsFile(item.name) && songKey(item.name) === key)
        const coverEntry = pickCover(entries, key)
        out.push({
          uri: entry.uri,
          name: entry.name,
          size: entry.size,
          lyrics: lrcEntry ? await readSidecarLyrics(lrcEntry) : undefined,
          cover: coverEntry ? { uri: coverEntry.uri, name: coverEntry.name } : undefined
        })
      }
      continue
    }

    const { documents } = await LocalFiles.describe({ uris: [handle] })
    const document = documents[0]
    if (!document) {
      skipped.push(handle)
      continue
    }
    if (!isAudioFile(document.name)) {
      skipped.push(document.name)
      continue
    }
    out.push({ uri: document.uri, name: document.name, size: document.size })
  }

  return out
}

/** Reads a `.lrc` beside the track. The lyrics are attached after the copy. */
async function readSidecarLyrics(entry: TreeEntry): Promise<Lyrics | undefined> {
  try {
    const { text } = await LocalFiles.readText({ uri: entry.uri })
    const parsed = parseLrc(text)
    if (!parsed.plain.trim() && parsed.synced.length === 0) return undefined
    return {
      trackId: '',
      plain: parsed.plain,
      synced: parsed.synced.length ? parsed.synced : null,
      meta: parsed.meta,
      origin: 'lrc-file',
      provider: entry.name,
      language: null,
      updatedAt: Date.now()
    }
  } catch {
    return undefined
  }
}

function buildTrack(copied: { path: string; name: string }, artwork: string | null): Track {
  const id = localTrackId(copied.path)
  const stem = baseName(copied.name).replace(/\.[^.]+$/, '')

  const track: Track = {
    id,
    title: stem,
    artist: 'Неизвестный исполнитель',
    album: null,
    year: null,
    genres: [],
    // The decoder reports the real duration on first play (`rememberTrackDuration`).
    duration: null,
    artwork,
    source: 'local',
    streamUrl: fileUrl(copied.path),
    identifier: null,
    filePath: copied.path,
    license: null,
    licenseUrl: null,
    sourceUrl: null,
    offline: true,
    addedAt: Date.now()
  }

  // Downloader output is often named "Artist - Title" with no tags at all.
  const fromName = parseArtistTitle(stem)
  if (fromName.title) track.title = restoreForbiddenCharacters(fromName.title)
  if (fromName.artist) track.artist = restoreForbiddenCharacters(fromName.artist)

  return track
}

/**
 * Imports the picked handles and writes the result into the profile database.
 * Mirrors `src/main/localFiles.ts`: one file per song, best format wins, a
 * second format never replaces a track that is already in the library.
 */
export async function importHandles(
  handles: string[],
  onProgress?: (done: number, total: number, current: string) => void
): Promise<ImportOutcome> {
  assertPlugin()

  const skipped: string[] = []
  const candidates = await collectCandidates(handles, skipped)

  const db = await loadDb()
  const priority = db.settings.formatPriority ?? DEFAULT_FORMAT_PRIORITY
  candidates.sort((a, b) => {
    const byFormat = formatRank(extensionOf(a.name), priority) - formatRank(extensionOf(b.name), priority)
    return byFormat !== 0 ? byFormat : a.name.localeCompare(b.name, undefined, { numeric: true })
  })

  const kept = new Map<string, string>()
  for (const track of Object.values(db.tracks)) {
    if (track.source === 'local' && track.filePath) kept.set(songKey(track.filePath), track.filePath)
  }

  const tracks: Track[] = []
  const lyrics: Lyrics[] = []
  const failed: { path: string; error: string }[] = []
  const duplicates: { path: string; kept: string }[] = []
  const importedPaths: string[] = []

  let done = 0
  for (const candidate of candidates) {
    const key = songKey(candidate.name)
    const existing = kept.get(key)

    if (existing) {
      duplicates.push({ path: candidate.name, kept: existing })
    } else {
      try {
        const copied = await LocalFiles.copyToMusic({ uri: candidate.uri, name: candidate.name })
        const id = localTrackId(copied.path)
        const meta = await readTrackMeta(copied.path, copied.size)

        let artwork: string | null = null
        if (meta.cover) {
          artwork = await saveEmbeddedCover(copied.path, id, meta.cover)
        }
        if (!artwork && candidate.cover) {
          try {
            const cover = await LocalFiles.copyToMusic({
              uri: candidate.cover.uri,
              name: `${id.replace(':', '_')}${extensionOf(candidate.cover.name)}`,
              folder: 'covers'
            })
            artwork = fileUrl(cover.path)
          } catch {
            artwork = null
          }
        }

        const track = applyMeta(buildTrack(copied, artwork), meta)
        tracks.push(track)
        importedPaths.push(copied.path)
        kept.set(key, copied.path)

        if (candidate.lyrics) {
          lyrics.push({ ...candidate.lyrics, trackId: track.id })
        }
      } catch (error) {
        failed.push({ path: candidate.name, error: (error as Error)?.message ?? String(error) })
      }
    }

    done += 1
    onProgress?.(done, candidates.length, candidate.name)
  }

  if (tracks.length > 0 || lyrics.length > 0) {
    await updateDb((database: PersistedDb) => {
      for (const track of tracks) {
        database.tracks[track.id] = track
        if (track.filePath) {
          database.importedPaths = [
            ...database.importedPaths.filter((path) => path !== track.filePath),
            track.filePath
          ]
        }
      }
      for (const item of lyrics) database.lyrics[item.trackId] = item
    })
  }

  return { tracks, lyrics, skipped, failed, duplicates }
}

/* ------------------------------------------------------------------ */
/* Picking                                                             */
/* ------------------------------------------------------------------ */

export async function pickFiles(): Promise<string[]> {
  assertPlugin()
  const { uris } = await LocalFiles.pickFiles({ mimeType: 'audio/*' })
  return uris ?? []
}

export async function pickFolder(): Promise<string | null> {
  assertPlugin()
  const { uri } = await LocalFiles.pickFolder()
  return uri ?? null
}

export async function pickTextFile(): Promise<{ path: string; text: string } | null> {
  assertPlugin()
  const picked = await LocalFiles.pickTextFile({ mimeType: '*/*' })
  if (!picked.path || typeof picked.text !== 'string') return null
  return { path: picked.path, text: picked.text }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/** Path behind a `_capacitor_file_` URL, so a cover can be deleted with its track. */
export function localArtworkPath(artwork: string | null): string | null {
  if (!artwork) return null
  const marker = '/_capacitor_file_'
  const index = artwork.indexOf(marker)
  if (index < 0) return null
  const tail = artwork.slice(index + marker.length)
  try {
    return decodeURIComponent(tail)
  } catch {
    return tail
  }
}

/** Removes a file the importer copied. */
export async function deleteCopiedFile(path: string): Promise<void> {
  try {
    await LocalFiles.deleteFile({ path })
  } catch {
    /* already gone, or the bridge is unavailable */
  }
}

const PLAYLIST_MIME: Record<PlaylistFileFormat, string> = {
  m3u8: 'audio/x-mpegurl',
  csv: 'text/csv',
  json: 'application/json'
}

/** Writes a playlist through the system "save as" dialog. */
export async function exportPlaylist(
  playlist: Playlist,
  tracks: Track[],
  format: PlaylistFileFormat
): Promise<{ path: string; count: number } | null> {
  assertPlugin()
  const spec = PLAYLIST_FILE_FORMATS.find((item) => item.value === format) ?? PLAYLIST_FILE_FORMATS[0]
  const text = serializePlaylist(
    format,
    playlist.name,
    tracks.map((track) => ({
      artist: track.artist,
      title: track.title,
      album: track.album,
      duration: track.duration,
      path: track.filePath
    }))
  )
  const safe = playlist.name.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'playlist'
  const saved = await LocalFiles.writeText({
    fileName: `${safe}.${spec.extension}`,
    mimeType: PLAYLIST_MIME[format],
    text
  })
  if (!saved.uri) return null
  return { path: saved.name ?? `${safe}.${spec.extension}`, count: tracks.length }
}

/** Applies a picked `.lrc` to a track. */
export async function importLyrics(track: Track): Promise<Lyrics | null> {
  assertPlugin()
  const picked = await LocalFiles.pickTextFile({ mimeType: '*/*' })
  if (!picked.path || typeof picked.text !== 'string') return null
  const parsed = parseLrc(picked.text)
  if (!parsed.plain.trim() && parsed.synced.length === 0) return null

  const lyrics: Lyrics = {
    trackId: track.id,
    plain: parsed.plain,
    synced: parsed.synced.length ? parsed.synced : null,
    meta: parsed.meta,
    origin: 'lrc-file',
    provider: picked.name ?? 'файл .lrc',
    language: null,
    updatedAt: Date.now()
  }
  await updateDb((db) => {
    db.lyrics[track.id] = lyrics
  })
  return lyrics
}

/** Saves lyrics as `.lrc` through the system dialog, like the desktop save box. */
export async function exportLyrics(track: Track, lyrics: Lyrics): Promise<string | null> {
  assertPlugin()
  const content = lyrics.synced?.length
    ? serializeLrc(lyrics.synced, {
        ti: track.title,
        ar: track.artist,
        ...(track.album ? { al: track.album } : {}),
        ...(lyrics.meta ?? {})
      })
    : lyrics.plain

  const safe = `${track.artist} - ${track.title}`.replace(/[\\/:*?"<>|]/g, ' ').trim()
  const saved = await LocalFiles.writeText({
    fileName: `${safe || 'lyrics'}.lrc`,
    mimeType: 'text/plain',
    text: content
  })
  return saved.uri ? saved.name ?? `${safe}.lrc` : null
}
