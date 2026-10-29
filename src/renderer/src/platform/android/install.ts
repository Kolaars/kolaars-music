/**
 * Android boot: install the native bridge on `window.kolaars` before any React
 * module evaluates `src/renderer/src/lib/api.ts`.
 *
 * Import order in `main.mobile.tsx` matters: module evaluation is depth-first, so
 * `./platform/android/install` runs to completion before `./main`.
 */

import { StatusBar, Style } from '@capacitor/status-bar'
import { App } from '@capacitor/app'
import { createNativeAudio } from './audio'
import { createAndroidApi } from './index'
import { installHttpTransport } from './http'
import { trackSystemInsets } from './insets'
import { installLifecycleFlush } from './storage'
import { setAudioFactory } from '../../lib/media'

installHttpTransport()
installLifecycleFlush()
setAudioFactory(createNativeAudio)
trackSystemInsets()

window.kolaars = createAndroidApi()

const root = document.documentElement
root.classList.add('platform-android')
root.dataset.platform = 'android'

/**
 * Debug handle: `window.__kolaars.getState()` in the WebView inspector.
 * A dynamic import keeps the boot path free of a cycle with the store.
 */
void import('../../state/store').then(({ useApp }) => {
  window.__kolaars = useApp as unknown as { getState: () => unknown }
})

void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined)
void StatusBar.setBackgroundColor({ color: '#0b0b10' }).catch(() => undefined)

/**
 * Hardware back button.
 *
 * By default Capacitor closes the app on back, which is jarring in a player.
 * Instead: Escape first (this closes dialogs, menus and the Now Playing sheet,
 * since every overlay listens for it), then the route stack, and only then
 * minimise, so music can keep playing.
 */
async function goBack(): Promise<void> {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

  const { useApp } = await import('../../state/store')
  const app = useApp.getState()
  if (app.nowPlayingOpen || app.queueOpen) return
  if (app.routeStack.length > 1) {
    app.goBack()
    return
  }
  await App.minimizeApp().catch(() => undefined)
}

void App.addListener('backButton', () => {
  void goBack()
}).catch(() => undefined)

// Long-press on a track row should not pop the WebView's text-selection menu.
document.addEventListener('contextmenu', (event) => event.preventDefault())
