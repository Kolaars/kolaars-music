/**
 * LRC (lyrics) parsing and serialisation.
 *
 * Shared between the main process (importing sidecar files, exporting) and the
 * renderer (the built-in sync editor), so the two can never disagree about the
 * format.
 *
 * Supported subset — the one that is actually used in the wild:
 *   [mm:ss.xx] line
 *   [ar:artist] [ti:title] [al:album] [by:author] [offset:+/-ms] [length:mm:ss]
 *   several timestamps on one line  ->  [00:10.00][01:20.00] chorus
 *   enhanced word timings `<00:12.50>` are dropped, keeping the words
 */

import type { LyricLine, Lyrics } from './types'

const TIME_TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g
const META_TAG = /^\[(ar|ti|al|by|offset|length|re|ve|au|tool|encoding):(.*)\]$/i
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g

export interface ParsedLrc {
  synced: LyricLine[]
  plain: string
  meta: Record<string, string>
  /** Millisecond shift implied by the `[offset:]` tag. */
  offset: number
}

function parseTimestamp(minutes: string, rest: string): number {
  const seconds = Number(rest.replace(':', '.'))
  if (!Number.isFinite(seconds)) return Number.NaN
  return Number(minutes) * 60 + seconds
}

export function parseLrc(text: string): ParsedLrc {
  const meta: Record<string, string> = {}
  const entries: LyricLine[] = []
  const plainLines: string[] = []

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = rawLine.trim()
    if (!line) continue

    TIME_TAG.lastIndex = 0
    const metaMatch = line.match(META_TAG)
    if (metaMatch && !TIME_TAG.test(line)) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim()
      continue
    }

    const times: number[] = []
    TIME_TAG.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = TIME_TAG.exec(line)) !== null && match.index === 0) {
      const time = parseTimestamp(match[1], match[2])
      if (Number.isFinite(time)) times.push(time)
      line = line.slice(match[0].length)
      TIME_TAG.lastIndex = 0
    }

    const content = line.replace(WORD_TAG, '').trim()
    if (!content) continue

    if (times.length === 0) {
      if (!plainLines.includes(content)) plainLines.push(content)
      continue
    }
    if (!plainLines.includes(content)) plainLines.push(content)
    for (const time of times) entries.push({ time, text: content })
  }

  entries.sort((a, b) => a.time - b.time)

  const rawOffset = Number(meta.offset ?? '0')
  const offset = Number.isFinite(rawOffset) ? rawOffset : 0
  if (offset !== 0) {
    for (const entry of entries) entry.time = Math.max(0, entry.time + offset / 1000)
  }

  for (let i = 0; i < entries.length; i++) {
    const next = entries[i + 1]
    entries[i].end = next ? next.time : undefined
  }

  return { synced: entries, plain: plainLines.join('\n'), meta, offset }
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, seconds)
  const minutes = Math.floor(total / 60)
  const rest = total - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`
}

export function serializeLrc(synced: LyricLine[], meta: Record<string, string> = {}): string {
  const head: string[] = []
  const order = ['ti', 'ar', 'al', 'by', 'length']
  for (const key of order) {
    const value = meta[key]
    if (value) head.push(`[${key}:${value}]`)
  }
  for (const [key, value] of Object.entries(meta)) {
    if (!order.includes(key) && key !== 'offset' && value) head.push(`[${key}:${value}]`)
  }

  const body = [...synced]
    .sort((a, b) => a.time - b.time)
    .map((line) => `[${formatTimestamp(line.time)}]${line.text}`)

  return `${[...head, ...body].join('\n')}\n`
}

/**
 * Draft timings for the built-in sync helper: spreads lyric lines evenly across
 * the track. Explicitly presented as a *draft* — tap-to-sync is how you make it
 * accurate.
 */
export function distributeTimings(plain: string, duration: number, leadIn = 1.5): LyricLine[] {
  const lines = plain
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return []

  const usable = Math.max(1, duration - leadIn - 1)
  const step = usable / lines.length
  return lines.map((text, index) => {
    const time = leadIn + index * step
    return { time, text, end: time + step }
  })
}

export function emptyLyrics(trackId: string): Lyrics {
  return {
    trackId,
    plain: '',
    synced: null,
    origin: 'user',
    provider: null,
    language: null,
    updatedAt: Date.now()
  }
}

/** Parses a single `mm:ss.xx` / `m:ss` token typed into the editor. */
export function parseTimestampInput(input: string): number | null {
  const value = input.trim().replace(',', '.')
  if (!value) return null
  if (value.includes(':')) {
    const parts = value.split(':')
    if (parts.length !== 2) return null
    const minutes = Number(parts[0])
    const seconds = Number(parts[1])
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null
    return minutes * 60 + seconds
  }
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds : null
}
