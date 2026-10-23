/**
 * Electron main process entry point.
 *
 * Responsibilities, in order:
 *   1. claim the single-instance lock and register the `kmedia://` scheme
 *      (both must happen before the app is ready);
 *   2. install the media protocol, IPC surface and application menu;
 *   3. open the frameless window that hosts the UI.
 */

import { app, BrowserWindow, nativeImage, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { EV } from '@shared/ipc'
import { registerMediaProtocol, registerMediaScheme } from './media'
import { registerIpc } from './ipc'
import { shutdownDiscordRpc } from './discordRpc'
import { buildAppMenu } from './menu'
import * as store from './db'
import { resolveDownloadDir, restoreDownloads } from './downloads'
import { CONTENT_SECURITY_POLICY } from './csp'
import { startRendererServer, type RendererServer } from './rendererServer'

const isDev = !app.isPackaged
const APP_ID = 'com.kolaars.music'

/*
 * Embedded provider players are started by an explicit click in the app. The
 * iframe is cross-origin, so Chromium's autoplay heuristic cannot see that
 * gesture and would otherwise keep the player paused.
 */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

/*
 * A music player keeps playing when its window is covered by another app.
 * Chromium otherwise treats an occluded window as background: animation frames
 * stop, the scrubber and karaoke highlight freeze, and synthetic input can be
 * dropped. Keep the renderer fully active even when the window is not on top.
 */
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
/*
 * Windows reports a covered window as "occluded"; Chromium then treats it as
 * hidden and can stop compositor frames and even drop input. A music player is
 * expected to keep its scrubber and controls live while another app is on top,
 * so opt out of the native occlusion calculation as well.
 */
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

let mainWindow: BrowserWindow | null = null
/** Loopback origin of the packaged renderer; `null` in dev-server mode. */
let rendererOrigin: string | null = null
let rendererServer: RendererServer | null = null
const devRendererUrl = isDev ? process.env.ELECTRON_RENDERER_URL : undefined

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

/**
 * Resolves a file that lives either in the repository (`resources/…`) during
 * development or inside the packaged app's resources directory.
 */
function resolveResource(...parts: string[]): string | null {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, ...parts) : '',
    path.join(app.getAppPath(), ...parts),
    path.join(process.cwd(), ...parts)
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function appIcon(): Electron.NativeImage | undefined {
  const iconPath = resolveResource('resources', 'icon.png') ?? resolveResource('icon.png')
  if (!iconPath) return undefined
  const image = nativeImage.createFromPath(iconPath)
  return image.isEmpty() ? undefined : image
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

function createWindow(): BrowserWindow {
  const icon = appIcon()

  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    title: 'Kolaars Music',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  const emitWindowState = (): void => {
    window.webContents.send(EV.windowState, { maximized: window.isMaximized() })
  }

  window.on('maximize', emitWindowState)
  window.on('unmaximize', emitWindowState)
  window.on('enter-full-screen', emitWindowState)
  window.on('leave-full-screen', emitWindowState)

  window.once('ready-to-show', () => {
    window.show()
    emitWindowState()
  })

  // Keep the app self-contained: external links open in the user's browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const sharesOrigin = (candidate: string | null | undefined): boolean => {
      if (!candidate) return false
      try {
        return new URL(url).origin === new URL(candidate).origin
      } catch {
        return false
      }
    }
    if (sharesOrigin(devRendererUrl) || sharesOrigin(rendererOrigin)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  if (devRendererUrl) {
    void window.loadURL(devRendererUrl)
  } else if (rendererOrigin) {
    void window.loadURL(`${rendererOrigin}/index.html`)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

/* ------------------------------------------------------------------ */
/* Security headers                                                    */
/* ------------------------------------------------------------------ */

function applyContentSecurityPolicy(): void {
  // Only the Vite dev server needs to be exempt: it serves its modules over
  // HTTP and relies on a websocket for HMR. The production renderer gets the
  // same policy from the loopback server, so this hook is a fallback for a
  // `file://` load.
  if (devRendererUrl) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Never stamp the app's policy onto a third-party response: the official
    // YouTube/SoundCloud documents inside the iframes must keep their own CSP.
    if (!details.url.startsWith('file://')) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY]
      }
    })
  })
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

registerMediaScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

  app.whenReady().then(async () => {
    registerMediaProtocol()

    const db = await store.loadDb()
    await restoreDownloads(resolveDownloadDir(db.settings.downloadDir))

    registerIpc(() => mainWindow)
    buildAppMenu(() => mainWindow)
    applyContentSecurityPolicy()

    // Serve the built UI from loopback. The official YouTube player needs a
    // real HTTP origin with a referrer; `file://` is rejected with error 153.
    if (!devRendererUrl) {
      try {
        rendererServer = await startRendererServer(path.join(__dirname, '../renderer'))
        rendererOrigin = rendererServer.origin
      } catch (error) {
        // Fall back to `file://`: the app still works, but YouTube embeds may
        // refuse to play. This only happens if loopback is unavailable.
        console.error('Не удалось запустить локальный сервер интерфейса:', error)
      }
    }

    mainWindow = createWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
        mainWindow.on('closed', () => {
          mainWindow = null
        })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    // Close the local Discord socket so the presence disappears promptly.
    void shutdownDiscordRpc()
    // Persist the library synchronously-ish before the process goes away.
    void store.flushAndClose()
    void rendererServer?.close()
  })
}
