/**
 * Desktop binding for the shared Internet Archive provider.
 *
 * The provider itself lives in `src/shared/archive.ts` so the Android build can
 * reuse it. Here we only wire the desktop HTTP helper (timeouts, retries, LRU
 * cache) into the shared transport.
 */

import { setHttpTransport } from '@shared/net'
import { fetchJson } from '../http'

setHttpTransport(fetchJson)

export * from '@shared/archive'
