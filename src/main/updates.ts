/**
 * Built-in application updates.
 *
 * Release builds use `electron-updater`, which reads the `app-update.yml`
 * written by electron-builder, checks the GitHub release feed, verifies the
 * SHA-512 from `latest.yml`, and hands the installer off to the NSIS package.
 * Development runs and the portable `.exe` cannot replace themselves, so they
 * use the same public GitHub API only to discover a new version and point the
 * user at the release page.
 *
 * This is the only network call the app makes without an explicit user action,
 * and it is a bare version check: no identifiers, library contents or usage
 * data leave the machine. It can be disabled in Settings.
 */

import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateProgress, UpdateStatus } from '@shared/api'
import { EV } from '@shared/ipc'
import { t } from '@shared/i18n'
import { isNewerVersion, normalizeVersion, releasePageUrl } from '@shared/update'

const RELEASES_PAGE = 'https://github.com/Kolaars/kolaars-music/releases/latest'
const RELEASES_API = 'https://api.github.com/repos/Kolaars/kolaars-music/releases/latest'
const AUTO_CHECK_DELAY_MS = 20_000
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

type WindowGetter = () => BrowserWindow | null

let getWindow: WindowGetter = () => null
let configured = false
let status: UpdateStatus | null = null
let statusBeforeCheck: UpdateStatus | null = null
let checkPromise: Promise<UpdateStatus> | null = null
let downloadPromise: Promise<UpdateStatus> | null = null
let manualCheck = false
let autoCheckEnabled = true
let firstCheckTimer: NodeJS.Timeout | null = null
let intervalTimer: NodeJS.Timeout | null = null

/* ------------------------------------------------------------------ */
/* Status plumbing                                                     */
/* ------------------------------------------------------------------ */

function installCapability(): Pick<UpdateStatus, 'canInstall' | 'installReason'> {
  if (!app.isPackaged) return { canInstall: false, installReason: 'development' }
  if (process.platform !== 'win32') return { canInstall: false, installReason: 'unsupported' }
  if (isPortableBuild()) return { canInstall: false, installReason: 'portable' }
  return { canInstall: true }
}

/** electron-builder sets these only inside the portable launcher. */
export function isPortableBuild(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR)
}

function idleStatus(): UpdateStatus {
  return {
    status: 'idle',
    currentVersion: app.getVersion(),
    releaseUrl: RELEASES_PAGE,
    ...installCapability()
  }
}

function currentStatus(): UpdateStatus {
  if (!status) status = idleStatus()
  return status
}

function setStatus(next: UpdateStatus): UpdateStatus {
  status = next
  const window = getWindow()
  if (window && !window.isDestroyed()) {
    try {
      window.webContents.send(EV.updateStatus, next)
    } catch {
      /* the window may be closing; the next status() call still sees it */
    }
  }
  return next
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  // electron-updater prefixes network failures with a long stack; keep the
  // first line, which is the part a user can act on.
  return raw.split('\n')[0].trim() || t('Неизвестная ошибка')
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

export function configureUpdates(windowGetter: WindowGetter): void {
  getWindow = windowGetter
  if (configured) return
  configured = true
  status = idleStatus()

  autoUpdater.autoDownload = false
  // A downloaded update installs when the user quits normally, too. The
  // explicit "restart and update" button is still the fastest path.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowPrerelease = false
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => {
    if (!installCapability().canInstall) return
    setStatus({ ...idleStatus(), status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    const version = normalizeVersion(info.version)
    setStatus({
      ...idleStatus(),
      status: 'available',
      version,
      releaseUrl: releasePageUrl(version)
    })
  })

  autoUpdater.on('update-not-available', () => {
    setStatus({ ...idleStatus(), status: 'up-to-date', checkedAt: Date.now() })
  })

  autoUpdater.on('download-progress', (info) => {
    const progress: UpdateProgress = {
      percent: Math.max(0, Math.min(100, Math.round(info.percent))),
      transferred: info.transferred,
      total: info.total,
      bytesPerSecond: info.bytesPerSecond
    }
    setStatus({
      ...idleStatus(),
      status: 'downloading',
      version: currentStatus().version,
      releaseUrl: currentStatus().releaseUrl,
      progress
    })
  })

  autoUpdater.on('update-downloaded', (event) => {
    const version = normalizeVersion(event.version)
    setStatus({
      ...idleStatus(),
      status: 'ready',
      version,
      releaseUrl: releasePageUrl(version)
    })
  })

  autoUpdater.on('error', (error) => {
    const message = errorMessage(error)
    // A silent background check must not replace a good "available" state with
    // an error banner just because the network blinked. Manual checks and
    // downloads do surface the failure.
    if (manualCheck || currentStatus().status === 'downloading') {
      setStatus({
        ...idleStatus(),
        status: 'error',
        version: currentStatus().version,
        releaseUrl: currentStatus().releaseUrl,
        error: message,
        checkedAt: Date.now()
      })
    } else if (statusBeforeCheck) {
      setStatus(statusBeforeCheck)
    }
    console.warn('[updates]', message)
  })
}

/* ------------------------------------------------------------------ */
/* Checking                                                            */
/* ------------------------------------------------------------------ */

interface GitHubRelease {
  tag_name?: unknown
  html_url?: unknown
  draft?: unknown
  prerelease?: unknown
}

async function fetchLatestRelease(): Promise<{ version: string; url: string }> {
  const response = await fetch(RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `Kolaars-Music/${app.getVersion()}`
    },
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? t('GitHub временно ограничил запросы. Попробуйте позже.')
        : t('GitHub ответил ошибкой {0}', { 0: response.status })
    )
  }
  const data = (await response.json()) as GitHubRelease
  if (typeof data.tag_name !== 'string' || data.draft === true || data.prerelease === true) {
    throw new Error(t('На GitHub нет опубликованного выпуска'))
  }
  const version = normalizeVersion(data.tag_name)
  if (!version) throw new Error(t('На GitHub нет опубликованного выпуска'))
  return {
    version,
    url: typeof data.html_url === 'string' ? data.html_url : releasePageUrl(version)
  }
}

async function checkWithoutUpdater(manual: boolean): Promise<UpdateStatus> {
  statusBeforeCheck = currentStatus()
  setStatus({ ...idleStatus(), status: 'checking' })
  try {
    const release = await fetchLatestRelease()
    if (isNewerVersion(release.version, app.getVersion())) {
      return setStatus({
        ...idleStatus(),
        status: 'available',
        version: release.version,
        releaseUrl: release.url,
        checkedAt: Date.now()
      })
    }
    return setStatus({ ...idleStatus(), status: 'up-to-date', checkedAt: Date.now() })
  } catch (error) {
    if (manual) {
      return setStatus({
        ...idleStatus(),
        status: 'error',
        error: errorMessage(error),
        checkedAt: Date.now()
      })
    }
    return setStatus(statusBeforeCheck ?? idleStatus())
  }
}

/**
 * Checks for a newer release.
 *
 * `manual` is true for the Settings button and the Help menu; background
 * checks stay quiet when the network is unavailable.
 */
export function checkForUpdates(manual = true): Promise<UpdateStatus> {
  if (checkPromise) return checkPromise

  // A background interval can fire while a download is running or after it has
  // finished. Re-checking then would replace the progress (or the "ready to
  // install" state) with a fresh "available", so leave those states alone.
  if (currentStatus().status === 'downloading' || currentStatus().status === 'ready') {
    return Promise.resolve(currentStatus())
  }

  if (!installCapability().canInstall) {
    checkPromise = checkWithoutUpdater(manual).finally(() => {
      checkPromise = null
    })
    return checkPromise
  }

  const capability = installCapability()
  statusBeforeCheck = currentStatus()
  manualCheck = manual
  setStatus({ ...idleStatus(), ...capability, status: 'checking' })

  checkPromise = (async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      if (!result) throw new Error(t('Обновления недоступны в этой сборке'))
      // Normally the events above have already set the final state. This is a
      // fallback for a provider that resolves without emitting one.
      if (currentStatus().status === 'checking') {
        const version = normalizeVersion(result.updateInfo.version)
        setStatus(
          isNewerVersion(version, app.getVersion())
            ? {
                ...idleStatus(),
                status: 'available',
                version,
                releaseUrl: releasePageUrl(version),
                checkedAt: Date.now()
              }
            : { ...idleStatus(), status: 'up-to-date', checkedAt: Date.now() }
        )
      }
    } catch (error) {
      if (manual) {
        setStatus({
          ...idleStatus(),
          status: 'error',
          error: errorMessage(error),
          checkedAt: Date.now()
        })
      } else {
        setStatus(statusBeforeCheck ?? idleStatus())
      }
    } finally {
      manualCheck = false
      checkPromise = null
    }
    return currentStatus()
  })()

  return checkPromise
}

/* ------------------------------------------------------------------ */
/* Download and install                                                */
/* ------------------------------------------------------------------ */

export function downloadUpdate(): Promise<UpdateStatus> {
  if (downloadPromise) return downloadPromise
  const capability = installCapability()
  if (!capability.canInstall) return Promise.resolve(currentStatus())

  const offered = currentStatus()
  if (!offered.version) return Promise.resolve(offered)
  if (offered.status !== 'available' && offered.status !== 'error') {
    return Promise.resolve(offered)
  }

  downloadPromise = (async () => {
    setStatus({
      ...idleStatus(),
      ...capability,
      status: 'downloading',
      version: offered.version,
      releaseUrl: offered.releaseUrl,
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }
    })
    try {
      await autoUpdater.downloadUpdate()
      if (currentStatus().status === 'downloading') {
        setStatus({
          ...idleStatus(),
          ...capability,
          status: 'ready',
          version: offered.version,
          releaseUrl: offered.releaseUrl
        })
      }
    } catch (error) {
      setStatus({
        ...idleStatus(),
        ...capability,
        status: 'error',
        version: offered.version,
        releaseUrl: offered.releaseUrl,
        error: errorMessage(error),
        checkedAt: Date.now()
      })
    } finally {
      downloadPromise = null
    }
    return currentStatus()
  })()

  return downloadPromise
}

/** Quits, runs the downloaded installer and lets it start the new build. */
export function installUpdate(): boolean {
  if (!installCapability().canInstall || currentStatus().status !== 'ready') return false
  try {
    // `--updated` makes the NSIS package replace the files without asking the
    // user to walk through the wizard again; `isForceRunAfter` reopens the app.
    autoUpdater.quitAndInstall(false, true)
    return true
  } catch (error) {
    setStatus({
      ...idleStatus(),
      ...installCapability(),
      status: 'error',
      error: errorMessage(error),
      checkedAt: Date.now()
    })
    return false
  }
}

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

function clearSchedule(): void {
  if (firstCheckTimer) clearTimeout(firstCheckTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  firstCheckTimer = null
  intervalTimer = null
}

export function setAutoCheckEnabled(enabled: boolean): void {
  autoCheckEnabled = enabled
  clearSchedule()
  if (enabled) scheduleAutoCheck()
}

/**
 * Starts the quiet background checks. Only packaged builds take part: a dev
 * run has no update metadata, and tests set `KOLAARS_DISABLE_UPDATE_CHECK=1`
 * so a random GitHub request cannot affect them.
 */
export function scheduleAutoCheck(): void {
  if (!autoCheckEnabled || !app.isPackaged) return
  if (process.env.KOLAARS_DISABLE_UPDATE_CHECK === '1') return
  if (firstCheckTimer || intervalTimer) return

  firstCheckTimer = setTimeout(() => {
    firstCheckTimer = null
    void checkForUpdates(false)
    intervalTimer = setInterval(() => {
      void checkForUpdates(false)
    }, AUTO_CHECK_INTERVAL_MS)
    intervalTimer.unref?.()
  }, AUTO_CHECK_DELAY_MS)
  firstCheckTimer.unref?.()
}

export function stopUpdates(): void {
  clearSchedule()
}

export function updateStatus(): UpdateStatus {
  return currentStatus()
}
