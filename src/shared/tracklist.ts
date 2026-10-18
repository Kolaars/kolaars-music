/**
 * Parsing and serialising track lists.
 *
 * This is how a playlist from another service gets in and out: users paste a
 * list of "Исполнитель — Название" lines, or hand over a `.txt`, `.csv` or
 * `.m3u` file, and the app turns it into entries it can match against the local
 * library, the open archive and the lyrics providers.
 *
 * Kept dependency-free (no Node, no DOM) so main and renderer can both use it.
 */

/** One "artist — title" pair recovered from a pasted list or a file. */
export interface TrackListEntry {
  artist: string
  title: string
  /** The line as it appeared, for error messages and the results table. */
  raw: string
}

/** Separators that appear between artist and title in real-world exports. */
const SEPARATORS = [' - ', ' – ', ' — ', ' − ', ' | ', ' \u2013 ', '\t', ' -- ']

const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|aiff|aif|wma|ape|mpc|wv)$/i

/** Leading "01. ", "1) " or "01 - " track numbers that exports like to add. */
const TRACK_NUMBER = /^(?:\s*\d{1,3}\s*[.)\]]\s+|\s*\d{1,3}\s+[-–—]\s+)/

const CSV_ARTIST = /^(artist|artists|artist name|исполнитель|артист|автор)$/i
const CSV_TITLE = /^(title|track|track name|song|name|название|трек|композиция)$/i

/** Splits one CSV/TSV line, honouring double-quoted cells. */
function splitCells(line: string, separator: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === separator) {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += char
  }
  cells.push(cell.trim())
  return cells
}

/** Picks the separator used by a header line, if it looks like a CSV header. */
function detectCsvHeader(
  line: string
): { separator: string; artist: number; title: number } | null {
  for (const separator of [',', ';', '\t']) {
    if (!line.includes(separator)) continue
    const cells = splitCells(line, separator)
    if (cells.length < 2) continue
    const artist = cells.findIndex((cell) => CSV_ARTIST.test(cell.trim()))
    const title = cells.findIndex((cell) => CSV_TITLE.test(cell.trim()))
    if (artist !== -1 && title !== -1) return { separator, artist, title }
  }
  return null
}

/** Recovers "artist — title" from a single line. */
export function parseArtistTitle(input: string): TrackListEntry {
  const raw = input
  let text = input.trim()

  const stripped = text.replace(TRACK_NUMBER, '')
  if (stripped) text = stripped

  for (const separator of SEPARATORS) {
    const at = text.indexOf(separator)
    if (at > 0) {
      const artist = text.slice(0, at).trim()
      const title = text.slice(at + separator.length).trim()
      if (artist && title) return { artist, title, raw }
    }
  }

  return { artist: '', title: text, raw }
}

/** A bare file path or URL in an `.m3u` becomes its base name. */
function fromLocation(line: string): string | null {
  const withoutQuery = line.split(/[?#]/)[0]
  if (!AUDIO_EXT.test(withoutQuery)) return null
  const base = withoutQuery.split(/[\\/]/).pop() ?? ''
  return base.replace(AUDIO_EXT, '').replace(/_/g, ' ').trim() || null
}

/**
 * Parses a pasted list or an imported file.
 *
 * Understands, in this order:
 *   - CSV/TSV with a header naming the artist and title columns;
 *   - `.m3u`/`.m3u8` `#EXTINF:<seconds>,<artist - title>` lines;
 *   - plain "Исполнитель — Название" lines (any of the usual dashes);
 *   - bare file paths, which are reduced to a human-readable base name.
 *
 * Anything beginning with `#` (other than `#EXTINF`) is treated as a comment.
 */
export function parseTrackList(text: string): TrackListEntry[] {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const entries: TrackListEntry[] = []
  let csv: { separator: string; artist: number; title: number } | null = null
  let start = 0

  const first = lines[0]
  if (first) {
    const header = detectCsvHeader(first)
    if (header) {
      csv = header
      start = 1
    }
  }

  for (let index = start; index < lines.length; index++) {
    const line = lines[index]

    if (csv) {
      const cells = splitCells(line, csv.separator)
      const artist = (cells[csv.artist] ?? '').trim()
      const title = (cells[csv.title] ?? '').trim()
      if (title) entries.push({ artist, title, raw: line })
      continue
    }

    const extinf = /^#EXTINF:[^,]*,(.*)$/i.exec(line)
    if (extinf) {
      const rest = extinf[1].trim()
      if (rest) {
        const parsed = parseArtistTitle(rest)
        if (parsed.title) entries.push(parsed)
      }
      continue
    }

    if (line.startsWith('#')) continue

    const fromPath = fromLocation(line)
    if (fromPath) {
      const parsed = parseArtistTitle(fromPath)
      if (parsed.title) entries.push({ ...parsed, raw: line })
      continue
    }

    const parsed = parseArtistTitle(line)
    if (parsed.title) entries.push(parsed)
  }

  return entries
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export interface ImportListRequest {
  entries: TrackListEntry[]
  /** Look for matching audio in the open archive (archive.org). */
  searchArchive: boolean
  /** Ask LRCLIB for lyrics of every resolved track. */
  fetchLyrics: boolean
}

/** How an entry was resolved. */
export type ImportMatchKind =
  /** Found in this profile's library (local file or offline download). */
  | 'local'
  /** Found in the open archive. */
  | 'archive'
  /** Kept as a name without audio — the honest outcome for copyrighted music. */
  | 'metadata'

export interface ImportListEntryResult {
  raw: string
  artist: string
  title: string
  trackId: string
  match: ImportMatchKind
  /** Matched title, which may differ from the entry's. */
  matchedTitle: string
  lyrics: 'saved' | 'skipped' | 'none'
}

export interface ImportListOutcome {
  results: ImportListEntryResult[]
  trackIds: string[]
  stats: { total: number; local: number; archive: number; metadata: number; lyrics: number }
  durationMs: number
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export interface ExportableTrack {
  artist: string
  title: string
  album?: string | null
  duration?: number | null
  /** Absolute path of a local file, when the track has one. */
  path?: string | null
}

export type PlaylistFileFormat = 'm3u8' | 'csv' | 'json'

export const PLAYLIST_FILE_FORMATS: { value: PlaylistFileFormat; label: string; extension: string }[] = [
  { value: 'm3u8', label: 'Плейлист M3U8', extension: 'm3u8' },
  { value: 'csv', label: 'Таблица CSV', extension: 'csv' },
  { value: 'json', label: 'Данные JSON', extension: 'json' }
]

function csvCell(value: string): string {
  return /[",;\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Renders a playlist for a foreign service or a spreadsheet.
 *
 * `streamUrl` is deliberately never written: for copyrighted music there is
 * nothing legitimate to point at, and the list is meant to carry names. Only a
 * track's own local file may be referenced, which is what makes an M3U8
 * genuinely playable — entries without one become comments, so other players
 * skip them instead of choking.
 */
export function serializePlaylist(
  format: PlaylistFileFormat,
  playlistName: string,
  tracks: ExportableTrack[]
): string {
  if (format === 'csv') {
    const header = 'artist,title,album,duration'
    const rows = tracks.map((track) =>
      [
        csvCell(track.artist ?? ''),
        csvCell(track.title ?? ''),
        csvCell(track.album ?? ''),
        track.duration != null ? String(Math.round(track.duration)) : ''
      ].join(',')
    )
    return [header, ...rows].join('\n')
  }

  if (format === 'json') {
    return JSON.stringify(
      {
        name: playlistName,
        exportedAt: new Date().toISOString(),
        count: tracks.length,
        tracks: tracks.map((track) => ({
          artist: track.artist ?? '',
          title: track.title ?? '',
          album: track.album ?? null,
          duration: track.duration ?? null
        }))
      },
      null,
      2
    )
  }

  const lines = ['#EXTM3U', `#PLAYLIST:${playlistName}`]
  for (const track of tracks) {
    const label = [track.artist, track.title].filter(Boolean).join(' - ')
    lines.push(`#EXTINF:${Math.round(track.duration ?? -1)},${label}`)
    lines.push(track.path ? track.path : `# ${label}`)
  }
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

/** Folds accents, punctuation and case so "Björk — Jóga!" matches "bjork joga". */
export function normalizeForMatch(value: string): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Stable-ish key for "does this library already have that song?". */
export function matchKey(artist: string, title: string): string {
  const a = normalizeForMatch(artist)
  const t = normalizeForMatch(title)
  // A missing artist should still match on the title alone.
  return a ? `${a}|${t}` : `|${t}`
}

/** Title-only key, used as a weaker fallback when the artist is unknown. */
export function titleKey(title: string): string {
  return normalizeForMatch(title)
}
