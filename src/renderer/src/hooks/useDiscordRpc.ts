/**
 * Keeps Discord Rich Presence in sync with playback.
 *
 * The hook deliberately subscribes to the player store instead of selecting
 * `position` with React: playback updates ~15 times per second, while Discord
 * only needs a snapshot on track changes, play/pause and seeks. The catalog
 * subscription catches the moment an archive track is resolved and gains its
 * public download URL.
 */

import { useEffect } from 'react'
import { buildDiscordPresence } from '@shared/discordPresence'
import { api } from '../lib/api'
import { usePlayer } from '../state/player'
import { useApp } from '../state/store'

export function useDiscordRpc(ready: boolean): void {
  const enabled = useApp((state) => state.settings.discordRpc)
  const clientId = useApp((state) => state.settings.discordRpcClientId)

  /* Configure the connection once per settings change. */
  useEffect(() => {
    if (!ready) return
    void api.discord.configure(enabled, clientId).catch(() => undefined)
  }, [ready, enabled, clientId])

  /* Push a presence snapshot whenever something Discord can display changes. */
  useEffect(() => {
    if (!ready) return

    const send = (): void => {
      const player = usePlayer.getState()
      const track = player.currentId
        ? useApp.getState().catalogIndex.get(player.currentId)
        : undefined

      if (!enabled || !track) {
        void api.discord.setActivity(null).catch(() => undefined)
        return
      }

      void api.discord
        .setActivity(
          buildDiscordPresence(track, {
            position: player.position,
            duration: player.duration,
            playing: player.playing
          })
        )
        .catch(() => undefined)
    }

    send()
    if (!enabled) return

    let lastSampleAt = Date.now()
    let lastPosition = usePlayer.getState().position

    const offPlayer = usePlayer.subscribe((state, previous) => {
      const now = Date.now()
      const elapsed = (now - lastSampleAt) / 1000
      const delta = state.position - lastPosition
      lastSampleAt = now
      lastPosition = state.position

      const trackChanged = state.currentId !== previous.currentId
      const playChanged = state.playing !== previous.playing
      // A seek makes the observed position jump away from real elapsed time.
      const seeked = state.playing && Math.abs(delta - elapsed) > 2.5

      if (trackChanged || playChanged || seeked) send()
    })

    const offCatalog = useApp.subscribe((state, previous) => {
      const currentId = usePlayer.getState().currentId
      if (!currentId) return
      if (state.catalogIndex.get(currentId) === previous.catalogIndex.get(currentId)) return

      // Resolving an archive track adds `streamUrl`, and therefore the download
      // button. A duplicate update here is harmless; missing one would leave the
      // button absent until the next playback event.
      send()
    })

    return () => {
      offPlayer()
      offCatalog()
    }
  }, [ready, enabled])
}
