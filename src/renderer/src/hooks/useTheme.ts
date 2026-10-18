/**
 * Applies the selected theme and accent colour to the document root.
 *
 * The CSS only ever reads `data-theme` and `--accent`, so switching themes is a
 * single attribute write — no re-render of the whole tree.
 */

import { useEffect } from 'react'
import type { ThemeMode } from '@shared/types'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function useTheme(theme: ThemeMode, accent: string): void {
  useEffect(() => {
    const root = document.documentElement

    const apply = (): void => {
      const resolved =
        theme === 'system' ? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light') : theme
      root.dataset.theme = resolved
    }

    apply()

    if (theme !== 'system') return
    const media = window.matchMedia(DARK_QUERY)
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent)
  }, [accent])
}
