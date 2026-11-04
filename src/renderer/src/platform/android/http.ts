/**
 * Native HTTP for the shared providers.
 *
 * A WebView's `fetch` is subject to CORS, and archive.org / LRCLIB / MediaWiki
 * do not all answer preflight requests the same way. CapacitorHttp performs the
 * request in Kotlin instead, so the provider code can stay identical to the
 * desktop one and never worries about origins.
 */

import { CapacitorHttp } from '@capacitor/core'
import { redactUrl, setHttpTransport, type HttpOptions } from '@shared/net'
import { t } from '../../lib/i18n'

async function requestText(url: string, opts: HttpOptions = {}): Promise<string> {
  const { timeoutMs = 20_000, retries = 2, headers } = opts
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await CapacitorHttp.request({
        url,
        method: 'GET',
        headers: { Accept: 'application/json, text/plain, */*', ...headers },
        responseType: 'text',
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs
      })
      if (response.status < 200 || response.status >= 300) {
        const error = new Error(`HTTP ${response.status} for ${redactUrl(url)}`)
        if (response.status < 500 && response.status !== 429) {
          Object.assign(error, { fatal: true })
        }
        throw error
      }
      if (typeof response.data === 'string') return response.data
      return JSON.stringify(response.data ?? null)
    } catch (error) {
      lastError = error
      const fatal = (error as { fatal?: boolean }).fatal === true
      if (fatal || attempt === retries) break
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** Installs the Capacitor transport for `@shared/net`. Safe to call more than once. */
export function installHttpTransport(): void {
  setHttpTransport(async <T>(url: string, opts?: HttpOptions): Promise<T> => {
    const text = await requestText(url, opts)
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(t('Ожидался JSON от {0}', { 0: redactUrl(url) }))
    }
  })
}
