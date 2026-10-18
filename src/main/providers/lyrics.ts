/**
 * Online lyrics providers.
 *
 * Two independent, key-free sources:
 *
 *  * LRCLIB (https://lrclib.net) — an open, community-maintained lyrics
 *    database that also exposes *time-synced* lyrics. Used for the "fetch
 *    lyrics online" action and for karaoke data.
 *  * Wikisource (https://wikisource.org) — a MediaWiki instance hosting
 *    public-domain texts. Used when the user wants a verified PD source.
 *
 * Both are opt-out-able from Settings and are never contacted for tracks the
 * user marked as local-only.
 */

import { fetchJson } from '../http'
import { parseLrc } from '@shared/lrc'
import type { LyricsCandidate } from '@shared/types'

/* ------------------------------------------------------------------ */
/* LRCLIB                                                              */
/* ------------------------------------------------------------------ */

const LRCLIB_BASE = 'https://lrclib.net/api'

interface LrclibRecord {
  id: number
  name?: string
  trackName: string
  artistName: string
  albumName?: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

function lrclibToCandidate(record: LrclibRecord, wantDuration: number | null): LyricsCandidate {
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : null
  const plain = record.plainLyrics ?? synced?.plain ?? ''

  // Rank: synced beats plain, and a matching duration is a strong signal.
  let score = 0
  if (record.syncedLyrics) score += 60
  if (plain.trim().length > 40) score += 20
  if (wantDuration && record.duration) {
    const delta = Math.abs(record.duration - wantDuration)
    if (delta < 3) score += 40
    else if (delta < 8) score += 20
    else if (delta < 20) score += 5
    else score -= 15
  }

  return {
    trackId: '',
    plain,
    synced: synced?.synced ?? null,
    meta: {
      title: record.trackName,
      artist: record.artistName,
      ...(record.albumName ? { album: record.albumName } : {}),
      ...(record.duration ? { length: `${Math.round(record.duration)}` } : {})
    },
    origin: 'lrclib',
    provider: 'LRCLIB',
    language: null,
    updatedAt: Date.now(),
    score
  }
}

function normalizeTitle(input: string): string {
  return input
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(remaster(ed)?|version|mix|mono|stereo)\b.*$/i, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Precise lookup: needs an exact artist + title + duration match upstream. */
export async function lrclibGet(
  artist: string,
  title: string,
  duration: number | null
): Promise<LyricsCandidate | null> {
  if (!artist || !title) return null
  const params = new URLSearchParams({ artist_name: artist, track_name: title })
  if (duration) params.set('duration', String(Math.round(duration)))
  try {
    const record = await fetchJson<LrclibRecord>(`${LRCLIB_BASE}/get?${params.toString()}`, {
      timeoutMs: 15_000,
      retries: 0
    })
    if (!record || record.instrumental) return null
    return lrclibToCandidate(record, duration)
  } catch {
    return null
  }
}

/** Fuzzy lookup: used when the exact trio (artist, title, duration) misses. */
export async function lrclibSearch(
  artist: string,
  title: string,
  duration: number | null
): Promise<LyricsCandidate[]> {
  const cleaned = normalizeTitle(title)
  const queries = [`${artist} ${cleaned}`.trim(), cleaned].filter(Boolean)
  const seen = new Set<string>()
  const out: LyricsCandidate[] = []

  for (const query of queries) {
    try {
      const records = await fetchJson<LrclibRecord[]>(
        `${LRCLIB_BASE}/search?${new URLSearchParams({ q: query }).toString()}`,
        { timeoutMs: 20_000 }
      )
      if (!Array.isArray(records)) continue
      for (const record of records) {
        if (!record || record.instrumental) continue
        const key = `${record.trackName}\u0000${record.artistName}\u0000${record.duration}`
        if (seen.has(key)) continue
        seen.add(key)
        if (!record.plainLyrics && !record.syncedLyrics) continue
        out.push(lrclibToCandidate(record, duration))
      }
    } catch {
      /* try the next query */
    }
    if (out.length >= 12) break
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 12)
}

/* ------------------------------------------------------------------ */
/* Wikisource                                                          */
/* ------------------------------------------------------------------ */

const WIKISOURCE_API = 'https://en.wikisource.org/w/api.php'

interface WikiSearchResponse {
  query?: {
    search?: { title: string; snippet: string; pageid: number }[]
  }
}

interface WikiParseResponse {
  parse?: { title: string; text?: { '*': string } }
}

export interface WikisourceHit {
  title: string
  pageId: number
  snippet: string
  url: string
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\[edit\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

export async function wikisourceSearch(term: string, limit = 10): Promise<WikisourceHit[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    list: 'search',
    srsearch: term,
    srlimit: String(limit),
    srnamespace: '0'
  })
  try {
    const data = await fetchJson<WikiSearchResponse>(`${WIKISOURCE_API}?${params.toString()}`, {
      timeoutMs: 20_000
    })
    return (data.query?.search ?? []).map((hit) => ({
      title: hit.title,
      pageId: hit.pageid,
      snippet: stripHtml(hit.snippet ?? '').replace(/\n+/g, ' ').slice(0, 240),
      url: `https://en.wikisource.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`
    }))
  } catch {
    return []
  }
}

export async function wikisourceFetch(title: string): Promise<LyricsCandidate | null> {
  const params = new URLSearchParams({
    action: 'parse',
    format: 'json',
    page: title,
    prop: 'text',
    disablelimitreport: '1',
    disableeditsection: '1'
  })
  try {
    const data = await fetchJson<WikiParseResponse>(`${WIKISOURCE_API}?${params.toString()}`, {
      timeoutMs: 25_000
    })
    const html = data.parse?.text?.['*']
    if (!html) return null
    const text = stripHtml(html)
    if (text.length < 40) return null
    return {
      trackId: '',
      plain: text,
      synced: null,
      meta: { ti: data.parse?.title ?? title },
      origin: 'wikisource',
      provider: 'Wikisource',
      language: 'en',
      updatedAt: Date.now(),
      score: 30
    }
  } catch {
    return null
  }
}
