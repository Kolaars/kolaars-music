import type { KolaarsApi } from '../shared/api'

declare global {
  interface Window {
    kolaars: KolaarsApi
    /** Zustand store handle installed by the Android boot code, for debugging. */
    __kolaars?: { getState: () => unknown }
  }
}

export {}
