/**
 * Internet Archive provider.
 *
 * The Archive is the backbone of the built-in catalog: it hosts ~190 000
 * public-domain 78rpm sides (the Great 78 Project), the Musopen classical
 * collection, and tens of thousands of Creative Commons releases from
 * netlabels. Everything here is fetched straight from the public APIs, with no
 * API key and no account.
 *
 *   search ....... https://archive.org/advancedsearch.php
 *   metadata ..... https://archive.org/metadata/<identifier>
 *   audio ........ https://archive.org/download/<identifier>/<file>
 *   cover ........ https://archive.org/services/img/<identifier>
 */

import { fetchJson } from '../http'
import type { ArchiveCollection, SearchQuery, SearchResultPage, Track } from '@shared/types'

const SEARCH_ENDPOINT = 'https://archive.org/advancedsearch.php'
const METADATA_ENDPOINT = 'https://archive.org/metadata/'
const DOWNLOAD_ENDPOINT = 'https://archive.org/download/'
const THUMB_ENDPOINT = 'https://archive.org/services/img/'

/* ------------------------------------------------------------------ */
/* Curated shelves                                                     */
/* ------------------------------------------------------------------ */

/** A keyword query that is known to return content, shown as a shelf. */
export interface Shelf {
  id: string
  title: string
  subtitle: string
  query: string
  sort: string
}

export const SHELVES: Shelf[] = [
  {
    id: 'jazz',
    title: 'Золотой век джаза',
    subtitle: 'Public-domain шеллак 78 об/мин · Great 78 Project',
    query: 'collection:georgeblood AND subject:"jazz"',
    sort: 'downloads desc'
  },
  {
    id: 'blues',
    title: 'Блюз и спиричуэлс',
    subtitle: 'Полевые записи и ранние блюзовые пластинки',
    query: 'collection:georgeblood AND (subject:"blues" OR subject:"spiritual")',
    sort: 'downloads desc'
  },
  {
    id: 'country',
    title: 'Раннее кантри и фолк',
    subtitle: 'Хиллбилли, ковбойские песни, стринг-бэнды',
    query: 'collection:georgeblood AND subject:"country"',
    sort: 'downloads desc'
  },
  {
    id: 'ragtime',
    title: 'Рэгтайм',
    subtitle: 'Скотт Джоплин и рэгтайм-оркестры',
    query: 'collection:georgeblood AND subject:"ragtime"',
    sort: 'downloads desc'
  },
  {
    id: 'dance-band',
    title: 'Танцевальные оркестры',
    subtitle: 'Большие бэнды 1900–1950-х',
    query: 'collection:georgeblood AND subject:"dance"',
    sort: 'downloads desc'
  },
  {
    id: 'waltz',
    title: 'Вальсы и салонная музыка',
    subtitle: 'Вальсы, польки, мазурки',
    query: 'collection:georgeblood AND subject:"waltz"',
    sort: 'downloads desc'
  },
  {
    id: 'christmas',
    title: 'Рождественская классика',
    subtitle: 'Записи, перешедшие в общественное достояние',
    query: 'collection:georgeblood AND subject:"christmas"',
    sort: 'downloads desc'
  },
  {
    id: 'classical',
    title: 'Академическая классика и опера',
    subtitle: 'Ранние записи, общественное достояние',
    query: 'collection:georgeblood AND (subject:"classical" OR subject:"opera")',
    sort: 'downloads desc'
  },
  {
    id: 'musopen',
    title: 'Musopen: записи без ограничений',
    subtitle: 'Переданы в общественное достояние',
    query: 'collection:musopen AND mediatype:audio',
    sort: 'downloads desc'
  },
  {
    id: 'netlabels',
    title: 'Независимые лейблы',
    subtitle: 'Современная музыка под лицензиями Creative Commons',
    query: 'collection:netlabels AND mediatype:audio',
    sort: 'downloads desc'
  }
]

export const ARCHIVE_COLLECTIONS: ArchiveCollection[] = [
  {
    id: 'georgeblood',
    title: 'Great 78 Project',
    description:
      'Оцифрованные шеллачные пластинки 78 об/мин. Записи в общественном достоянии.',
    sort: 'downloads desc'
  },
  {
    id: 'musopen',
    title: 'Musopen',
    description: 'Записи академической музыки, переданные в общественное достояние.',
    sort: 'downloads desc'
  },
  {
    id: 'netlabels',
    title: 'Netlabels',
    description: 'Современные релизы независимых лейблов под лицензиями Creative Commons.',
    sort: 'downloads desc'
  },
  {
    id: '78rpm',
    title: '78 RPM',
    description: 'Вся коллекция пластинок 78 об/мин, включая Great 78 Project.',
    sort: 'downloads desc'
  },
  {
    id: 'audio_music',
    title: 'Вся музыка',
    description: 'Всё аудио в разделе «music» Internet Archive.',
    sort: 'downloads desc'
  }
]

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ArchiveSearchDoc {
  identifier: string
  title?: string | string[]
  creator?: string | string[]
  year?: string | string[]
  date?: string | string[]
  genre?: string | string[]
  subject?: string | string[]
  licenseurl?: string | string[]
  collection?: string | string[]
  downloads?: number
  item_size?: number
}

interface ArchiveSearchResponse {
  responseHeader?: { status?: number }
  response: {
    numFound: number
    start: number
    docs: ArchiveSearchDoc[]
  }
}

interface ArchiveFile {
  name: string
  format?: string
  length?: string
  size?: string
  title?: string
  artist?: string
  album?: string
  track?: string
  genre?: string
  source?: string
  original?: string
}

interface ArchiveMetadata {
  created?: number
  dir?: string
  server?: string
  d1?: string
  d2?: string
  files?: ArchiveFile[]
  metadata?: {
    identifier?: string
    title?: string
    creator?: string | string[]
    date?: string
    year?: string
    genre?: string | string[]
    subject?: string | string[]
    licenseurl?: string | string[]
    rights?: string
    collection?: string | string[]
    description?: string | string[]
    publisher?: string
    label?: string
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function firstString(value: string | string[] | undefined | null): string | null {
  const arr = toArray(value)
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  return arr.length ? arr[0] : null
}

function joinCreators(value: string | string[] | undefined | null): string {
  const arr = toArray(value)
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  if (arr.length === 0) return 'Неизвестный исполнитель'
  // De-duplicate while keeping order.
  return Array.from(new Set(arr)).join(', ')
}

function parseYear(doc: ArchiveSearchDoc | undefined, meta?: ArchiveMetadata): number | null {
  const fromDoc = toArray(doc?.year)[0] ?? toArray(doc?.date)[0]
  const raw = fromDoc ?? meta?.metadata?.year ?? meta?.metadata?.date
  const match = String(raw ?? '').match(/(1[6-9]\d{2}|20\d{2})/)
  return match ? Number(match[1]) : null
}

/** `length` is seconds ("185.97") in some items and "m:ss" in others. */
export function parseDuration(raw: string | undefined): number | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value) return null
  if (value.includes(':')) {
    const parts = value.split(':').map(Number)
    if (parts.some((p) => !Number.isFinite(p))) return null
    return parts.reduce((acc, part) => acc * 60 + part, 0)
  }
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

const AUDIO_FORMAT_RANK: Record<string, number> = {
  'VBR MP3': 0,
  MP3: 1,
  '128Kbps MP3': 2,
  '64Kbps MP3': 3,
  'Ogg Vorbis': 4,
  Opus: 5,
  '24bit Flac': 6,
  Flac: 7,
  'WAVE': 8,
  'AIFF': 9,
  'Shorten': 20
}

const LOSSLESS = new Set(['24bit Flac', 'Flac', 'WAVE', 'AIFF'])

function isAudio(file: ArchiveFile): boolean {
  const format = file.format ?? ''
  if (format in AUDIO_FORMAT_RANK) return true
  return /\.(mp3|ogg|flac|wav|m4a|opus)$/i.test(file.name) && !file.name.endsWith('_files.xml')
}

/** Deterministic ordering of the audio files inside one Archive item. */
function sortedAudioFiles(files: ArchiveFile[] | undefined, preferLossless = false): ArchiveFile[] {
  const audio = (files ?? []).filter(isAudio)
  if (preferLossless) {
    audio.sort((a, b) => {
      const la = LOSSLESS.has(a.format ?? '') ? 0 : 1
      const lb = LOSSLESS.has(b.format ?? '') ? 0 : 1
      if (la !== lb) return la - lb
      return (AUDIO_FORMAT_RANK[a.format ?? ''] ?? 50) - (AUDIO_FORMAT_RANK[b.format ?? ''] ?? 50)
    })
  }
  // Group identical base names so that the MP3/FLAC pair of one track is
  // ordered together, keeping index-based ids stable across calls.
  const byBase = new Map<string, ArchiveFile[]>()
  for (const file of audio) {
    const base = file.name.replace(/\.[^.]+$/, '').toLowerCase()
    const list = byBase.get(base)
    if (list) list.push(file)
    else byBase.set(base, [file])
  }
  const groups = Array.from(byBase.values())
  groups.sort((a, b) => {
    const ta = Number(a[0].track ?? Number.NaN)
    const tb = Number(b[0].track ?? Number.NaN)
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb
    return a[0].name.localeCompare(b[0].name, undefined, { numeric: true })
  })
  return groups.map((group) => {
    group.sort(
      (a, b) => (AUDIO_FORMAT_RANK[a.format ?? ''] ?? 50) - (AUDIO_FORMAT_RANK[b.format ?? ''] ?? 50)
    )
    return group[0]
  })
}

/** One representative audio file per logical track. */
function primaryFiles(files: ArchiveFile[] | undefined, preferLossless = false): ArchiveFile[] {
  return sortedAudioFiles(files, preferLossless)
}

function licenseInfo(
  meta: ArchiveMetadata | undefined,
  identifier: string
): { license: string; licenseUrl: string | null } {
  const url = firstString(meta?.metadata?.licenseurl)
  if (url && /^https?:/i.test(url)) {
    return { license: licenseLabel(url), licenseUrl: url }
  }
  const collections = toArray(meta?.metadata?.collection).map((c) => String(c))
  if (collections.includes('georgeblood') || collections.includes('78rpm')) {
    return {
      license: 'Общественное достояние',
      licenseUrl: 'https://archive.org/details/georgeblood'
    }
  }
  const rights = meta?.metadata?.rights
  if (rights) return { license: String(rights).slice(0, 160), licenseUrl: null }
  return { license: 'См. страницу записи', licenseUrl: `https://archive.org/details/${identifier}` }
}

function licenseLabel(url: string): string {
  const u = url.toLowerCase()
  if (u.includes('publicdomain') || u.includes('/zero/')) return 'Общественное достояние'
  const cc = u.match(/licenses\/([a-z-]+)\/([\d.]+)/)
  if (cc) {
    const parts = cc[1].split('-')
    const kind = parts
      .map((p) => ({ by: 'BY', nc: 'NC', sa: 'SA', nd: 'ND' })[p] ?? p.toUpperCase())
      .join('-')
    return `CC ${kind} ${cc[2]}`
  }
  return url
}

/** Public, directly streamable URL for one file inside an item. */
export function archiveFileUrl(identifier: string, fileName: string): string {
  return `${DOWNLOAD_ENDPOINT}${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`
}

export function archiveCoverUrl(identifier: string): string {
  return `${THUMB_ENDPOINT}${encodeURIComponent(identifier)}`
}

export function archivePageUrl(identifier: string): string {
  return `https://archive.org/details/${encodeURIComponent(identifier)}`
}

/** `arc:<identifier>` for the first track, `arc:<identifier>#<n>` for the rest. */
export function archiveTrackId(identifier: string, index = 0): string {
  return index === 0 ? `arc:${identifier}` : `arc:${identifier}#${index}`
}

export function parseArchiveTrackId(id: string): { identifier: string; index: number } | null {
  if (!id.startsWith('arc:')) return null
  const rest = id.slice(4)
  const hash = rest.lastIndexOf('#')
  if (hash === -1) return { identifier: rest, index: 0 }
  const index = Number(rest.slice(hash + 1))
  return { identifier: rest.slice(0, hash), index: Number.isFinite(index) ? index : 0 }
}

/* ------------------------------------------------------------------ */
/* Metadata cache                                                      */
/* ------------------------------------------------------------------ */

const metadataCache = new Map<string, { at: number; value: ArchiveMetadata | null }>()
const METADATA_TTL = 30 * 60_000
const metadataInflight = new Map<string, Promise<ArchiveMetadata | null>>()

export async function fetchArchiveMetadata(identifier: string): Promise<ArchiveMetadata | null> {
  const cached = metadataCache.get(identifier)
  if (cached && Date.now() - cached.at < METADATA_TTL) return cached.value

  const inflight = metadataInflight.get(identifier)
  if (inflight) return inflight

  const promise = (async (): Promise<ArchiveMetadata | null> => {
    try {
      const data = await fetchJson<ArchiveMetadata>(
        `${METADATA_ENDPOINT}${encodeURIComponent(identifier)}`,
        { timeoutMs: 25_000 }
      )
      if (!data || !data.files) throw new Error('Item has no files')
      metadataCache.set(identifier, { at: Date.now(), value: data })
      return data
    } catch {
      metadataCache.set(identifier, { at: Date.now(), value: null })
      return null
    } finally {
      metadataInflight.delete(identifier)
    }
  })()

  metadataInflight.set(identifier, promise)
  return promise
}

export function clearArchiveCache(): void {
  metadataCache.clear()
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

function trackFromFile(
  identifier: string,
  index: number,
  file: ArchiveFile,
  meta: ArchiveMetadata | undefined,
  preferLossless: boolean
): Track {
  const md = meta?.metadata ?? {}
  const albumTitle = md.title ? String(md.title) : identifier
  const artist = joinCreators(md.creator)
  const rawTitle = file.title?.trim() || file.original?.replace(/\.[^.]+$/, '') || file.name
  const multiple = primaryFiles(meta?.files, preferLossless).length > 1
  const { license, licenseUrl } = licenseInfo(meta, identifier)

  return {
    id: archiveTrackId(identifier, index),
    title: multiple ? rawTitle : rawTitle || albumTitle,
    artist: file.artist?.trim() || artist,
    album: multiple ? albumTitle : (file.album?.trim() ?? null),
    year: parseYear(undefined, meta),
    genres: toArray(file.genre ?? md.genre ?? md.subject)
      .map((g) => String(g).trim())
      .filter(Boolean)
      .slice(0, 6),
    duration: parseDuration(file.length),
    artwork: archiveCoverUrl(identifier),
    source: 'online',
    streamUrl: archiveFileUrl(identifier, file.name),
    identifier,
    filePath: null,
    license,
    licenseUrl,
    sourceUrl: archivePageUrl(identifier),
    offline: false,
    addedAt: null
  }
}

function trackFromDoc(doc: ArchiveSearchDoc): Track {
  const identifier = doc.identifier
  return {
    id: archiveTrackId(identifier, 0),
    title: firstString(doc.title) ?? identifier,
    artist: joinCreators(doc.creator),
    album: null,
    year: parseYear(doc),
    genres: toArray(doc.genre ?? doc.subject)
      .map((g) => String(g).trim())
      .filter(Boolean)
      .slice(0, 6),
    duration: null,
    artwork: archiveCoverUrl(identifier),
    source: 'online',
    // Placeholder: replaced by `resolveArchiveTrack` before playback.
    streamUrl: '',
    identifier,
    filePath: null,
    license: doc.licenseurl ? licenseLabel(firstString(doc.licenseurl) ?? '') : null,
    licenseUrl: firstString(doc.licenseurl),
    sourceUrl: archivePageUrl(identifier),
    offline: false,
    addedAt: null
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function searchArchive(query: SearchQuery): Promise<SearchResultPage<Track>> {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 24))
  const text = query.text.trim()
  if (!text) return { items: [], page, pageSize, total: 0, hasMore: false }

  const params = new URLSearchParams()
  let q = text
  if (!/\bmediatype\s*:/.test(q)) q = `(${q}) AND mediatype:(audio)`
  params.set('q', collectionFilter(q, query.collection))
  for (const field of [
    'identifier',
    'title',
    'creator',
    'year',
    'date',
    'genre',
    'subject',
    'licenseurl',
    'collection',
    'downloads'
  ]) {
    params.append('fl[]', field)
  }
  params.set('rows', String(pageSize))
  params.set('page', String(page))
  params.set('output', 'json')
  params.append('sort[]', 'downloads desc')

  const data = await fetchJson<ArchiveSearchResponse>(`${SEARCH_ENDPOINT}?${params.toString()}`, {
    timeoutMs: 30_000
  })
  const docs = data?.response?.docs ?? []
  const total = data?.response?.numFound ?? 0

  return {
    items: docs.map(trackFromDoc),
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total
  }
}

function collectionFilter(q: string, collection?: string | null): string {
  if (!collection) return q
  return `${q} AND collection:${JSON.stringify(collection)}`
}

/**
 * Resolves placeholder search results into playable tracks by reading each
 * item's metadata in parallel. Keeps catalog browsing instant while still
 * showing real durations, licenses and stream URLs.
 */
export async function hydrateArchiveTracks(
  tracks: Track[],
  keepPlaceholders = true
): Promise<Track[]> {
  const out = await mapLimit(tracks, 6, async (track) => {
    if (!track.identifier) return track
    const resolved = await resolveArchiveTrack(track.id)
    if (resolved) {
      return {
        ...resolved,
        // Preserve search-provided genre hints when the item has none.
        genres: resolved.genres?.length ? resolved.genres : track.genres
      }
    }
    return keepPlaceholders ? track : null
  })
  return out.filter((t): t is Track => t !== null)
}

export async function resolveArchiveTrack(trackId: string): Promise<Track | null> {
  const parsed = parseArchiveTrackId(trackId)
  if (!parsed) return null
  const meta = await fetchArchiveMetadata(parsed.identifier)
  if (!meta) return null
  const files = primaryFiles(meta.files)
  if (files.length === 0) return null
  const index = Math.min(parsed.index, files.length - 1)
  return trackFromFile(parsed.identifier, index, files[index], meta, false)
}

/** Every track of one Archive item — used by the album view. */
export async function fetchArchiveItem(
  identifier: string,
  preferLossless = false
): Promise<{ tracks: Track[]; album: string; artist: string; artwork: string; license: string } | null> {
  const meta = await fetchArchiveMetadata(identifier)
  if (!meta) return null
  const files = primaryFiles(meta.files, preferLossless)
  if (files.length === 0) return null
  const tracks = files.map((file, index) =>
    trackFromFile(identifier, index, file, meta, preferLossless)
  )
  const { license } = licenseInfo(meta, identifier)
  return {
    tracks,
    album: meta.metadata?.title ? String(meta.metadata.title) : identifier,
    artist: joinCreators(meta.metadata?.creator),
    artwork: archiveCoverUrl(identifier),
    license
  }
}

/** Runs `fn` over `items` with a bounded number of concurrent calls. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
