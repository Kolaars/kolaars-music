/**
 * YouTube Music search through the official YouTube Data API v3.
 *
 * Playback is *not* done here: the app embeds the official YouTube IFrame
 * Player and drives it with its public API. No audio stream is extracted, no
 * signature is deciphered, and no video is downloaded.
 *
 *   search ....... /youtube/v3/search      (100 quota units per call)
 *   details ...... /youtube/v3/videos      (1 unit per call)
 *
 * Quota is per Google Cloud project: the default 10 000 units/day allows about
 * a hundred searches, which is why results are cached by `http.ts`.
 */

import { fetchJson } from '../http'
import type { SearchResultPage, SourceSearchQuery, Track } from '@shared/types'

const API = 'https://www.googleapis.com/youtube/v3'

interface YouTubeThumbnail {
  url?: string
  width?: number
  height?: number
}

interface YouTubeSnippet {
  title?: string
  channelTitle?: string
  publishedAt?: string
  tags?: string[]
  thumbnails?: Record<string, YouTubeThumbnail>
}

interface YouTubeSearchItem {
  id?: { videoId?: string }
  snippet?: YouTubeSnippet
}

interface YouTubeVideoItem {
  id?: string
  snippet?: YouTubeSnippet
  contentDetails?: { duration?: string }
}

interface YouTubeListResponse<T> {
  items?: T[]
  nextPageToken?: string
}

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                     */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/** YouTube returns HTML-escaped titles (`&amp;`, `&#39;`, …). */
export function decodeHtml(input: string): string {
  return String(input ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith('#')) {
      const hex = code[1]?.toLowerCase() === 'x'
      const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(value) && value >= 0 && value <= 0x10ffff
        ? String.fromCodePoint(value)
        : match
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

/** ISO-8601 duration (`PT3M21S`) → seconds. */
export function parseIsoDuration(raw: string | undefined | null): number | null {
  if (!raw) return null
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(raw)
  if (!match) return null
  const [, days, hours, minutes, seconds] = match
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  return total > 0 ? total : null
}

/** Suffixes that describe the upload, not the song. */
const NOISE =
  /\s*[([{](?:official\s*(?:music\s*)?(?:video|audio|visualizer|lyric\s*video)|lyrics?|audio|video|visuali[sz]er|hd|hq|4k|8k|explicit|clean|remaster(?:ed)?(?:\s*\d{4})?|m\/v|mv|full\s*(?:song|album))[)\]}]/gi

export function cleanTitle(raw: string): string {
  return decodeHtml(raw).replace(NOISE, '').replace(/\s+/g, ' ').trim()
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '')
}

/**
 * Splits "Artist - Song" when the left side plausibly names the channel.
 * Otherwise the channel is the artist (the usual shape of "Artist - Topic"
 * auto-generated music uploads).
 */
export function splitArtist(rawTitle: string, channelTitle: string): { title: string; artist: string } {
  const title = cleanTitle(rawTitle)
  const channel = decodeHtml(channelTitle)
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim()

  const parts = title.split(/\s+[-–—]\s+/)
  if (parts.length >= 2) {
    const left = parts[0].trim()
    const right = parts.slice(1).join(' - ').trim()
    const a = normalize(left)
    const b = normalize(channel)
    if (left.length <= 80 && right.length > 0 && a && b && (a.includes(b) || b.includes(a))) {
      return { artist: left, title: right }
    }
  }

  return { artist: channel || 'YouTube', title }
}

function bestThumbnail(
  thumbs: Record<string, YouTubeThumbnail> | undefined
): string | null {
  if (!thumbs) return null
  for (const name of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const url = thumbs[name]?.url
    if (url) return url
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

function trackFromVideo(video: YouTubeVideoItem | YouTubeSearchItem): Track | null {
  const id = typeof video.id === 'string' ? video.id : video.id?.videoId
  if (!id) return null
  const snippet = video.snippet ?? {}
  const { title, artist } = splitArtist(snippet.title ?? id, snippet.channelTitle ?? '')
  const duration = 'contentDetails' in video ? parseIsoDuration(video.contentDetails?.duration) : null

  return {
    id: `yt:${id}`,
    title,
    artist,
    album: null,
    year: snippet.publishedAt ? Number(snippet.publishedAt.slice(0, 4)) || null : null,
    genres: snippet.tags?.slice(0, 6) ?? [],
    duration,
    artwork: bestThumbnail(snippet.thumbnails),
    source: 'external',
    // Playback happens inside the embedded official player.
    streamUrl: '',
    identifier: id,
    external: {
      provider: 'youtube',
      id,
      pageUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
    },
    filePath: null,
    license: null,
    licenseUrl: null,
    sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    offline: false,
    addedAt: null
  }
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

function friendlyYouTubeError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  if (/HTTP 400/.test(message)) {
    throw new Error(
      'YouTube отклонил запрос. Проверьте ключ, что YouTube Data API v3 включён, и параметры поиска.'
    )
  }
  if (/HTTP 403/.test(message)) {
    throw new Error('YouTube отклонил запрос: проверьте дневную квоту проекта и ограничения ключа.')
  }
  throw error instanceof Error ? error : new Error(message)
}

/* ------------------------------------------------------------------ */
/* Page tokens                                                         */
/* ------------------------------------------------------------------ */

/**
 * `search.list` has no numeric offset, only opaque page tokens. Tokens are
 * remembered per query so the UI can still ask for "page 2"; an unknown page
 * simply comes back empty.
 */
const pageTokens = new Map<string, string>()
const PAGE_TOKEN_MAX = 100

function tokenKey(apiKey: string, query: SourceSearchQuery): string {
  return `${apiKey.slice(-6)}|${query.text.trim().toLowerCase()}|${query.pageSize ?? 24}`
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function searchYouTube(
  apiKey: string,
  query: SourceSearchQuery
): Promise<SearchResultPage<Track>> {
  const text = query.text.trim()
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 24))
  if (!text) return { items: [], page, pageSize, total: 0, hasMore: false }

  const key = tokenKey(apiKey, { ...query, pageSize })
  const pageToken = page > 1 ? pageTokens.get(`${key}|${page}`) : undefined
  if (page > 1 && !pageToken) {
    return { items: [], page, pageSize, total: 0, hasMore: false }
  }

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: String(pageSize),
    q: text,
    videoCategoryId: '10',
    key: apiKey,
    fields: 'items(id/videoId,snippet(title,channelTitle,publishedAt,thumbnails)),nextPageToken'
  })
  if (pageToken) params.set('pageToken', pageToken)

  let data = await fetchJson<YouTubeListResponse<YouTubeSearchItem>>(`${API}/search?${params}`).catch(
    (error: unknown) => friendlyYouTubeError(error)
  )

  // Category 10 is "Music", but it is not available in every region. Retry
  // without the filter rather than showing an empty page.
  if ((data.items?.length ?? 0) === 0 && page === 1) {
    params.delete('videoCategoryId')
    data = await fetchJson<YouTubeListResponse<YouTubeSearchItem>>(`${API}/search?${params}`).catch(
      (error: unknown) => friendlyYouTubeError(error)
    )
  }

  const ids = (data.items ?? [])
    .map((item) => item.id?.videoId)
    .filter((id): id is string => Boolean(id))

  if (data.nextPageToken) {
    if (pageTokens.size >= PAGE_TOKEN_MAX) {
      const oldest = pageTokens.keys().next()
      if (!oldest.done) pageTokens.delete(oldest.value)
    }
    pageTokens.set(`${key}|${page + 1}`, data.nextPageToken)
  }

  if (ids.length === 0) return { items: [], page, pageSize, total: 0, hasMore: false }

  const details = await fetchJson<YouTubeListResponse<YouTubeVideoItem>>(
    `${API}/videos?` +
      new URLSearchParams({
        part: 'snippet,contentDetails',
        id: ids.join(','),
        key: apiKey,
        fields:
          'items(id,snippet(title,channelTitle,publishedAt,tags,thumbnails),contentDetails(duration))'
      })
  ).catch((error: unknown) => friendlyYouTubeError(error))

  const byId = new Map((details.items ?? []).map((item) => [item.id, item]))
  const items = ids
    .map((id) => {
      const item = byId.get(id) ?? data.items?.find((entry) => entry.id?.videoId === id)
      return item ? trackFromVideo(item) : null
    })
    .filter((track): track is Track => Boolean(track))

  return {
    items,
    page,
    pageSize,
    total: items.length,
    hasMore: Boolean(data.nextPageToken)
  }
}

/** Loads one video by id — used to restore saved tracks and old queues. */
export async function fetchYouTubeTrack(apiKey: string, videoId: string): Promise<Track | null> {
  const id = String(videoId ?? '').trim()
  if (!/^[\w-]{6,20}$/.test(id)) return null
  const data = await fetchJson<YouTubeListResponse<YouTubeVideoItem>>(
    `${API}/videos?` +
      new URLSearchParams({
        part: 'snippet,contentDetails',
        id,
        key: apiKey,
        fields:
          'items(id,snippet(title,channelTitle,publishedAt,tags,thumbnails),contentDetails(duration))'
      })
  ).catch((error: unknown) => friendlyYouTubeError(error))
  const item = data.items?.[0]
  return item ? trackFromVideo(item) : null
}
