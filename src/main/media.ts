/**
 * Custom `kmedia://` protocol.
 *
 * The renderer must be able to play files from disk (imported tracks, offline
 * downloads) and show extracted cover art without being handed raw `file://`
 * access. Everything is funnelled through this protocol, which only serves
 * paths that the main process has explicitly allowed.
 */

import { app, net, protocol } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const MEDIA_SCHEME = 'kmedia'

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
    try {
      // `net.fetch` on a file URL transparently supports Range requests,
      // which is what lets the player seek inside local tracks.
      return await net.fetch(pathToFileURL(filePath).toString(), {
        headers: request.headers,
        method: request.method
      })
    } catch (err) {
      return new Response(`Not found: ${(err as Error).message}`, { status: 404 })
    }
  })
}
