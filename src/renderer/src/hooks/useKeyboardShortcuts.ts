/**
 * Global playback shortcuts.
 *
 * Guardrails, in order:
 *   1. any open `.modal` swallows keys (that is how the tap-to-sync editor keeps
 *      the space bar for itself);
 *   2. typing targets (input / textarea / select / contentEditable) are ignored;
 *   3. modifier combinations are never intercepted — those belong to the app
 *      menu and the OS.
 */

import { useEffect, useRef } from 'react'
import { usePlayer } from '../state/player'

export interface ShortcutHandlers {
  onToggleLyrics: () => void
  onToggleQueue: () => void
  onToggleFavorite: () => void
  onFocusSearch: () => void
  onEscape: () => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || !element.tagName) return false
  const tag = element.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return element.isContentEditable === true
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (document.querySelector('.modal')) return
      if (isTypingTarget(event.target)) return

      const player = usePlayer.getState()

      switch (event.key) {
        case ' ':
        case 'Spacebar':
          event.preventDefault()
          player.toggle()
          return
        case 'ArrowRight':
          event.preventDefault()
          player.skip(event.shiftKey ? 30 : 5)
          return
        case 'ArrowLeft':
          event.preventDefault()
          player.skip(event.shiftKey ? -30 : -5)
          return
        case 'ArrowUp':
          event.preventDefault()
          player.adjustVolume(0.05)
          return
        case 'ArrowDown':
          event.preventDefault()
          player.adjustVolume(-0.05)
          return
        case 'Escape':
          ref.current.onEscape()
          return
        default:
          break
      }

      switch (event.key.toLowerCase()) {
        case 'm':
          event.preventDefault()
          player.toggleMute()
          return
        case 's':
          event.preventDefault()
          player.toggleShuffle()
          return
        case 'r':
          event.preventDefault()
          player.cycleRepeat()
          return
        case 'n':
          event.preventDefault()
          player.next()
          return
        case 'p':
          event.preventDefault()
          player.previous()
          return
        case 'l':
          event.preventDefault()
          ref.current.onToggleLyrics()
          return
        case 'q':
          event.preventDefault()
          ref.current.onToggleQueue()
          return
        case 'f':
          event.preventDefault()
          ref.current.onToggleFavorite()
          return
        case '/':
          event.preventDefault()
          ref.current.onFocusSearch()
          return
        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
