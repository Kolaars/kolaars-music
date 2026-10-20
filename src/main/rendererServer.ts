/**
 * Serves the built renderer from a loopback HTTP origin.
 *
 * Why not `file://`? The official YouTube IFrame player refuses to start when
 * the embedding page has an opaque file origin: the request to YouTube arrives
 * without a valid HTTP referrer and the player stops with "error 153".
 * A normal http origin on 127.0.0.1 is both valid and private to this machine.
 *
 * Only the app's own build directory is exposed. The server is read-only,
 * binds to loopback and is closed when the app quits.
 */

import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { CONTENT_SECURITY_POLICY } from './csp'

const LOOPBACK = '127.0.0.1'
/** Stable port keeps localStorage (theme, panel sizes) across launches. */
const PORTS = [41723, 41724, 41725, 41726, 41727]

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8'
}

export interface RendererServer {
  origin: string
  close: () => Promise<void>
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      const address = server.address()
      resolve(address && typeof address === 'object' ? address.port : port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, LOOPBACK)
  })
}

export async function startRendererServer(root: string): Promise<RendererServer> {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end()
      return
    }

    let pathname = '/'
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', `http://${LOOPBACK}`).pathname)
    } catch {
      response.writeHead(400)
      response.end()
      return
    }
    if (pathname === '/' || pathname === '') pathname = '/index.html'

    const file = path.resolve(root, `.${pathname}`)
    const relative = path.relative(root, file)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(403)
      response.end()
      return
    }

    let body: Buffer
    try {
      body = await readFile(file)
    } catch {
      response.writeHead(404)
      response.end()
      return
    }

    const extension = path.extname(file).toLowerCase()
    response.writeHead(200, {
      'Content-Type': MIME[extension] ?? 'application/octet-stream',
      'Content-Length': body.byteLength,
      'Cache-Control': pathname === '/index.html' ? 'no-store' : 'no-cache',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      // Cross-origin iframes need a referrer; YouTube rejects embeds without one.
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff'
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  })

  let port = 0
  let lastError: unknown = null
  for (const candidate of [...PORTS, 0]) {
    try {
      port = await listen(server, candidate)
      lastError = null
      break
    } catch (error) {
      lastError = error
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') break
    }
  }
  if (lastError) {
    server.close()
    throw lastError
  }

  return {
    origin: `http://${LOOPBACK}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
  }
}
