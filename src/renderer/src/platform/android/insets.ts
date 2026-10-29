/**
 * System bar insets for the phone layout.
 *
 * Capacitor's `env(safe-area-inset-*)` values come from the WebView and are
 * zero at the bottom on some ROMs (MIUI 12 reports nothing although the
 * navigation bar is on screen), so the player bar drew itself underneath the
 * system buttons. The native `SystemUi` plugin reads the window insets and, if
 * the system claims there are none, falls back to the tappable area.
 *
 * The values land in CSS custom properties that `styles/mobile.css` prefers
 * over `env()`, so the layout reacts to both button and gesture navigation.
 */

import { registerPlugin } from '@capacitor/core'

interface SystemUiBridge {
  insets(): Promise<{ top: number; bottom: number; left: number; right: number }>
}

const SystemUi = registerPlugin<SystemUiBridge>('SystemUi')

let applying = false

async function applyInsets(): Promise<void> {
  if (applying) return
  applying = true
  try {
    const insets = await SystemUi.insets()
    const style = document.documentElement.style
    style.setProperty('--android-inset-top', `${Math.max(0, Math.round(insets.top))}px`)
    style.setProperty('--android-inset-bottom', `${Math.max(0, Math.round(insets.bottom))}px`)
  } catch {
    /* Older shells keep the env() values. */
  } finally {
    applying = false
  }
}

export function trackSystemInsets(): void {
  void applyInsets()
  // The insets change on rotation and when the navigation mode changes; the
  // WebView fires a resize for both.
  window.addEventListener('resize', () => void applyInsets())
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void applyInsets()
  })
  watchPlayerBar()
}

/**
 * Toasts are positioned above the player bar using `--playerbar-h`, which is the
 * desktop height. On the phone the bar grows with the safe area, so its real
 * height is published instead of guessing it in CSS.
 */
function watchPlayerBar(): void {
  const root = document.documentElement
  let attempts = 0

  const publish = (bar: Element): void => {
    root.style.setProperty(
      '--playerbar-live-h',
      `${Math.round(bar.getBoundingClientRect().height)}px`
    )
  }

  const attach = (): void => {
    const bar = document.querySelector('.playerbar')
    if (!bar) {
      // React has not mounted the shell yet; try again on the next frames.
      if (attempts < 40) {
        attempts += 1
        setTimeout(attach, 100)
      }
      return
    }
    publish(bar)
    new ResizeObserver(() => publish(bar)).observe(bar)
  }

  attach()
}
