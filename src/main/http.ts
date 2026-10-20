/**
 * HTTP helper used by every online provider.
 *
 * Node's global fetch is used, but wrapped with: a hard timeout, a couple of
 * retries on transient failures, a JSON fast path, and a small in-memory LRU
 * cache so that repeated searches do not hammer upstream services.
 */

export interface HttpOptions {
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
  signal?: AbortSignal
}

const cache = new Map<string, { at: number; value: unknown }>()
const CACHE_TTL_MS = 5 * 60_000
const CACHE_MAX = 120

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return hit.value as T
}

function cacheSet(key: string, value: unknown): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, { at: Date.now(), value })
}

export function clearHttpCache(): void {
  cache.clear()
}

const UA =
  'KolaarsMusic/1.0 (+https://github.com/Kolaars/kolaars-music; open-source music player)'

/** Hides API keys that providers pass in the query string from error text. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const name of ['key', 'client_id', 'access_token', 'token']) {
      if (parsed.searchParams.has(name)) parsed.searchParams.set(name, '***')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

async function rawFetch(url: string, opts: HttpOptions = {}): Promise<Response> {
  const { timeoutMs = 20_000, retries = 2, headers } = opts
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onOuterAbort = (): void => controller.abort()
    opts.signal?.addEventListener('abort', onOuterAbort, { once: true })

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers },
        signal: controller.signal,
        redirect: 'follow'
      })
      if (!res.ok) {
        // 4xx other than 429 will not improve by retrying.
        if (res.status < 500 && res.status !== 429) {
          throw Object.assign(new Error(`HTTP ${res.status} for ${redactUrl(url)}`), { fatal: true })
        }
        throw new Error(`HTTP ${res.status} for ${redactUrl(url)}`)
      }
      return res
    } catch (err) {
      lastError = err
      const fatal = (err as { fatal?: boolean }).fatal === true
      if (fatal || attempt === retries) break
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onOuterAbort)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function fetchJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const key = `json:${url}`
  const hit = cacheGet<T>(key)
  if (hit !== undefined) return hit
  const res = await rawFetch(url, opts)
  const text = await res.text()
  let parsed: T
  try {
    parsed = JSON.parse(text) as T
  } catch {
    throw new Error(`Expected JSON from ${redactUrl(url)} but received ${res.headers.get('content-type')}`)
  }
  cacheSet(key, parsed)
  return parsed
}

export async function fetchText(url: string, opts: HttpOptions = {}): Promise<string> {
  const key = `text:${url}`
  const hit = cacheGet<string>(key)
  if (hit !== undefined) return hit
  const res = await rawFetch(url, opts)
  const text = await res.text()
  cacheSet(key, text)
  return text
}

/** Used by the downloader: streams to disk without buffering in memory. */
export function fetchRaw(url: string, opts: HttpOptions = {}): Promise<Response> {
  return rawFetch(url, { retries: 2, ...opts })
}
