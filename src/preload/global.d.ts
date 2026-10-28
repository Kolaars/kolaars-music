import type { KolaarsApi } from '../shared/api'

declare global {
  interface Window {
    kolaars: KolaarsApi
  }
}

export {}
