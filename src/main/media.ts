/**
 * Custom `kmedia://` protocol.
 *
 * The renderer must be able to play files from disk (imported tracks, offline
 * downloads) and show extracted cover art without being handed raw `file://`
 * access. Everything is funnelled through this protocol, which only serves
 * paths that the main process has explicitly allowed.
 */

import { app, protocol } from 'electron'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { contentTypeFor, parseByteRange } from './byteRange'

export const MEDIA_SCHEME = 'kmedia'

/** What `new Response()` accepts as a body, without naming the DOM/undici type. */
type ResponseBody = ConstructorParameters<typeof Response>[0]

/** Paths (normalised, lower-cased on Windows) that may be served. */
const allowed = new Set<string>()

function normalise(p: string): string {
  const resolved = path.resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Allow a single file to be streamed to the renderer. */
export function allowMediaPath(filePath: string): void {
  allowed.add(normalise(filePath))
}

export function allowMediaPaths(filePaths: Iterable<string>): void {
  for (const p of filePaths) allowMediaPath(p)
}

/**
 * Re-allows everything a stored track points at — the audio file and the cover
 * next to it.
 *
 * The allowlist lives in memory only, so it is empty in every new process. A
 * library that was filled in an earlier session would otherwise come back
 * forbidden: covers would not render and nothing would play, with no hint as to
 * why. Called whenever a profile document is read.
 */
export function allowMediaPathsOfTracks(
  tracks: Iterable<{ filePath?: string | null; artwork?: string | null }>
): void {
  for (const track of tracks) {
    if (track.filePath) allowMediaPath(track.filePath)
    const artwork = track.artwork
    if (!artwork || !artwork.startsWith(`${MEDIA_SCHEME}://`)) continue
    const decoded = decodeMediaUrl(artwork)
    if (decoded) allowMediaPath(decoded)
  }
}

export function disallowMediaPath(filePath: string): void {
  allowed.delete(normalise(filePath))
}

/** Allow a whole directory tree (covers, downloads). */
const allowedRoots = new Set<string>()

export function allowMediaRoot(dir: string): void {
  allowedRoots.add(normalise(dir))
}

function isAllowed(filePath: string): boolean {
  const norm = normalise(filePath)
  if (allowed.has(norm)) return true
  for (const root of allowedRoots) {
    if (norm === root || norm.startsWith(root + path.sep)) return true
  }
  return false
}

export function encodeMediaUrl(filePath: string): string {
  const encoded = Buffer.from(filePath, 'utf8').toString('base64url')
  return `${MEDIA_SCHEME}://local/${encoded}`
}

export function decodeMediaUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null
    const token = parsed.pathname.replace(/^\/+/, '')
    if (!token) return null
    return Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

/** Must be called before `app.whenReady()`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: true
      }
    }
  ])
}

/** Must be called after `app.whenReady()`. */
export function registerMediaProtocol(): void {
  allowMediaRoot(app.getPath('userData'))

  protocol.handle(MEDIA_SCHEME, async (request) => {
    const filePath = decodeMediaUrl(request.url)
    if (!filePath) return new Response('Bad request', { status: 400 })
    if (!isAllowed(filePath)) return new Response('Forbidden', { status: 403 })

    let size: number
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) return new Response('Not found', { status: 404 })
      size = stat.size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    /* Ranges are answered by hand. Handing the file to `net.fetch` looks
     * simpler but Chromium's file loader ignores `Range` (and sends no
     * `Accept-Ranges`), so the media element was told the stream was not
     * seekable at all: the seek bar did nothing and jumping to a saved position
     * or a clicked lyric line restarted the track from the beginning. */
    const headers: Record<string, string> = {
      'content-type': contentTypeFor(filePath),
      'accept-ranges': 'bytes'
    }
    const range = parseByteRange(request.headers.get('range'), size)

    if (range) {
      const stream = createReadStream(filePath, { start: range.start, end: range.end })
      return new Response(Readable.toWeb(stream) as unknown as ResponseBody, {
        status: 206,
        headers: {
          ...headers,
          'content-length': String(range.end - range.start + 1),
          'content-range': `bytes ${range.start}-${range.end}/${size}`
        }
      })
    }

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { ...headers, 'content-length': String(size) } })
    }

    const stream = createReadStream(filePath)
    return new Response(Readable.toWeb(stream) as unknown as ResponseBody, {
      status: 200,
      headers: { ...headers, 'content-length': String(size) }
    })
  })
}
