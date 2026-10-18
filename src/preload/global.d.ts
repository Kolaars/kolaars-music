import type { KolaarsApi } from './index'

declare global {
  interface Window {
    kolaars: KolaarsApi
  }
}

export {}
