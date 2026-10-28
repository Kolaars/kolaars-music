/**
 * Transport used by the provider modules in `src/shared`.
 *
 * Electron's main process wants its caching/retrying implementation, while the
 * Android WebView wants Capacitor's native HTTP bridge. Both install their own
 * implementation once at start-up; the providers below only depend on this
 * small interface, so the same code runs on every platform.
 */

export interface HttpOptions {
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
  signal?: AbortSignal
}

export type FetchJson = <T>(url: string, opts?: HttpOptions) => Promise<T>
export type FetchText = (url: string, opts?: HttpOptions) => Promise<string>

const UA =
  'KolaarsMusic/1.0 (+https://github.com/Kolaars/kolaars-music; open-source music player)'

/** Hides API keys that providers pass in the query string from error text. */
export function redactUrl(url: string): string {
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

/** Plain browser/Node fetch with timeout and retries. Used when nothing better is installed. */
export async function defaultFetchJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await rawFetch(url, opts)
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(
      `Expected JSON from ${redactUrl(url)} but received ${res.headers.get('content-type')}`
    )
  }
}

export async function defaultFetchText(url: string, opts: HttpOptions = {}): Promise<string> {
  const res = await rawFetch(url, opts)
  return res.text()
}

let jsonTransport: FetchJson = defaultFetchJson

export function setHttpTransport(next: FetchJson): void {
  jsonTransport = next
}

export function fetchJson<T>(url: string, opts?: HttpOptions): Promise<T> {
  return jsonTransport<T>(url, opts)
}
