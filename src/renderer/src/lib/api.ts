/**
 * Thin, typed wrapper around the preload bridge.
 *
 * Having one place that touches `window.kolaars` makes it trivial to stub the
 * backend in tests and keeps every call site free of `any`.
 */

import type { KolaarsApi } from '../../../preload/index'

export const api: KolaarsApi = window.kolaars

/** Turns anything thrown into a sentence we can show a human. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Неизвестная ошибка'
}

/** Runs a promise, reporting failures through `onError` instead of throwing. */
export async function attempt<T>(
  operation: () => Promise<T>,
  onError: (message: string) => void
): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    onError(errorMessage(error))
    return null
  }
}
