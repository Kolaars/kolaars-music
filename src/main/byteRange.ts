/**
 * Byte ranges for the `kmedia://` protocol.
 *
 * A media element cannot seek inside a file that is served as one opaque blob:
 * Chromium marks such a stream as non-seekable, the seek bar goes dead and a
 * request to jump anywhere outside the buffer throws the player back to the
 * start. The protocol therefore has to answer `Range` requests properly, which
 * starts with reading the header. Kept free of Electron imports so it can be
 * unit-tested on its own (`scripts/test-byte-range.mjs`).
 */

export interface ByteRange {
  start: number
  end: number
}

/**
 * Reads a single-range `Range` header against a known file size.
 *
 * Returns `null` for anything that should be answered with the whole file:
 * no header, an unparsable one, a multi-range request (nothing here asks for
 * several ranges) or a range that starts past the end of the file.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange | null {
  if (!header || !Number.isSafeInteger(size) || size <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match) return null
  const rawStart = match[1] ?? ''
  const rawEnd = match[2] ?? ''
  if (rawStart === '' && rawEnd === '') return null

  if (rawStart === '') {
    // `bytes=-500`: the last 500 bytes.
    const length = Number(rawEnd)
    if (!Number.isSafeInteger(length) || length <= 0) return null
    return { start: Math.max(0, size - length), end: size - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isSafeInteger(start) || start >= size) return null
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isSafeInteger(end) || end < start) return null
  return { start, end }
}

const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/mp4',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.lrc': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
}

/** A content type for a media path, so nothing has to guess from the bytes. */
export function contentTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return TYPES[filePath.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}
