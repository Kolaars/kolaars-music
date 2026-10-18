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
import { buildAppMenu } from './menu'
import * as store from './db'
import { resolveDownloadDir, restoreDownloads } from './downloads'

const isDev = !app.isPackaged
const APP_ID = 'com.kolaars.music'

let mainWindow: BrowserWindow | null = null

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
    const allowed = isDev && process.env.ELECTRON_RENDERER_URL
    if (allowed && url.startsWith(allowed)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
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
  // HTTP and relies on a websocket for HMR.
  if (isDev && process.env.ELECTRON_RENDERER_URL) return

  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: kmedia: https:",
    "media-src 'self' blob: kmedia: https: http:",
    "font-src 'self' data:",
    "connect-src 'self' https: http:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
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
    // Persist the library synchronously-ish before the process goes away.
    void store.flushAndClose()
  })
}
