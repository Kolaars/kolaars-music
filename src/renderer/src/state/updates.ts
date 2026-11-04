/**
 * Renderer-side state for the built-in updater.
 *
 * The main process owns the state machine; this store mirrors the latest
 * pushed status so the banner and the Settings card stay in sync. `init` is
 * idempotent, which lets both `App` and the Settings view call it safely.
 */

import { create } from 'zustand'
import type { UpdateStatus } from '@shared/api'
import { api, errorMessage } from '../lib/api'

const INITIAL: UpdateStatus = {
  status: 'idle',
  currentVersion: '',
  canInstall: false
}

interface UpdatesState {
  update: UpdateStatus
  init: () => Promise<void>
  check: (manual?: boolean) => Promise<void>
  download: () => Promise<void>
  install: () => Promise<boolean>
  openRelease: () => Promise<void>
}

let initialized = false

export const useUpdates = create<UpdatesState>((set, get) => ({
  update: INITIAL,

  init: async () => {
    if (initialized) return
    initialized = true
    api.updates.onStatus((next) => set({ update: next }))
    try {
      set({ update: await api.updates.status() })
    } catch {
      /* the preload bridge is always present on desktop; Android reports idle */
    }
  },

  check: async (manual = true) => {
    set({ update: { ...get().update, status: 'checking', error: undefined } })
    try {
      set({ update: await api.updates.check(manual) })
    } catch (error) {
      set({
        update: {
          ...get().update,
          status: 'error',
          error: errorMessage(error),
          checkedAt: Date.now()
        }
      })
    }
  },

  download: async () => {
    try {
      set({ update: await api.updates.download() })
    } catch (error) {
      set({
        update: {
          ...get().update,
          status: 'error',
          error: errorMessage(error),
          checkedAt: Date.now()
        }
      })
    }
  },

  install: async () => {
    try {
      return await api.updates.install()
    } catch (error) {
      set({
        update: {
          ...get().update,
          status: 'error',
          error: errorMessage(error),
          checkedAt: Date.now()
        }
      })
      return false
    }
  },

  openRelease: async () => {
    const url = get().update.releaseUrl
    if (url) await api.app.openExternal(url)
  }
}))
