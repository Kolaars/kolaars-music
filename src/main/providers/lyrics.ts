/** Desktop binding for the shared online lyrics providers. */

import { setHttpTransport } from '@shared/net'
import { fetchJson } from '../http'

setHttpTransport(fetchJson)

export * from '@shared/lyrics-online'
