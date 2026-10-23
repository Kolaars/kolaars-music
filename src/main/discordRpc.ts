/**
 * Discord Rich Presence.
 *
 * Discord only exposes its RPC socket to native applications, so the connection
 * lives in the main process. The renderer sends a small snapshot of the current
 * track over IPC; nothing is collected or published unless the user turns the
 * feature on and supplies a Discord Application ID.
 *
 * The package is imported lazily: a user who never enables Rich Presence should
 * not pay for loading the RPC stack, and a broken optional dependency must not
 * prevent the music player from starting.
 */

import type { Client as DiscordRpcClient, SetActivity } from '@xhayper/discord-rpc'
import type { DiscordPresence, DiscordRpcState, DiscordRpcStatus } from '@shared/types'
import { buildDiscordButtons } from '@shared/discordPresence'

type StatusSink = (status: DiscordRpcStatus) => void

const RETRY_MS = 30_000
/** Discord snowflakes are 17–20 decimal digits. */
const CLIENT_ID_RE = /^\d{17,20}$/

let statusSink: StatusSink = () => {}
let client: DiscordRpcClient | null = null
let enabled = false
let clientId = ''
let presence: DiscordPresence | null = null
let state: DiscordRpcState = 'disabled'
let lastError: string | null = null
let retryTimer: NodeJS.Timeout | null = null
let generation = 0
let connecting = false
let lastPublished = ''

export function setDiscordRpcStatusSink(sink: StatusSink): void {
  statusSink = sink
}

export function discordRpcStatus(): DiscordRpcStatus {
  return { state, error: lastError }
}

function publish(): void {
  const next = discordRpcStatus()
  const key = `${next.state}\u0000${next.error ?? ''}`
  if (key === lastPublished) return
  lastPublished = key
  try {
    statusSink(next)
  } catch {
    /* the window may have gone away during shutdown */
  }
}

function setState(next: DiscordRpcState, error: string | null = null): void {
  state = next
  lastError = error
  publish()
}

function clearRetry(): void {
  if (!retryTimer) return
  clearTimeout(retryTimer)
  retryTimer = null
}

function scheduleRetry(): void {
  if (!enabled || !clientId || retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void connect()
  }, RETRY_MS)
  retryTimer.unref?.()
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/COULD_NOT_CONNECT|COULD_NOT_FIND_CLIENT|Could not connect/i.test(message)) {
    return 'Discord не запущен или RPC недоступен'
  }
  if (/INVALID_CLIENTID|Invalid Client ID|invalid client/i.test(message)) {
    return 'Discord отклонил Application ID'
  }
  if (/RATE_LIMITED|rate limit/i.test(message)) {
    return 'Discord временно ограничил обновления'
  }
  if (/CONNECTION_TIMEOUT|timed out/i.test(message)) {
    return 'Discord не ответил вовремя'
  }
  if (/CONNECTION_ENDED|Connection ended/i.test(message)) {
    return 'Discord закрыл соединение — проверьте Application ID'
  }
  if (/MODULE_NOT_FOUND|Cannot find module/i.test(message)) {
    return 'Модуль Discord RPC не найден в сборке'
  }
  return 'Не удалось подключиться к Discord'
}

/**
 * Applies the cached presence to a connected client.
 *
 * Buttons are plain URLs: Discord cannot invoke an app command. We therefore
 * only label a button "Скачать" when the renderer supplied a direct public file
 * URL. External services get an "Открыть" button instead, and local-only tracks
 * get a clearly labelled YouTube Music search.
 */
async function applyPresence(): Promise<void> {
  const current = client
  if (!current || state !== 'connected' || !current.user) return

  try {
    if (!presence) {
      await current.user.clearActivity()
      return
    }
    await current.user.setActivity(buildActivity(presence))
  } catch (error) {
    if (client !== current) return
    console.warn('[discord-rpc] setActivity:', error)
    setState('error', friendlyError(error))
    client = null
    try {
      await current.destroy()
    } catch {
      /* already gone */
    }
    scheduleRetry()
  }
}

function isPublicUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512) return false
  return /^https?:\/\//i.test(value)
}

/** Discord's CDN only fetches external artwork over https. */
function isPublicImage(value: unknown): value is string {
  return isPublicUrl(value) && /^https:\/\//i.test(value)
}

function clip(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/**
 * Discord shows activity type 2 as "Listening to …" instead of "Playing …".
 * The RPC payload uses the numeric Discord activity type, so the value is cast
 * rather than imported from a transitive dependency.
 */
const LISTENING_TYPE = 2 as NonNullable<SetActivity['type']>

function buildActivity(snapshot: DiscordPresence): SetActivity {
  const title = clip(snapshot.title, 128) || 'Kolaars Music'
  const artist = clip(snapshot.artist, 128)
  const album = clip(snapshot.album, 96)
  const provider = clip(snapshot.provider, 40)

  let stateText = [artist, album].filter(Boolean).join(' — ')
  if (provider) stateText = [stateText, provider].filter(Boolean).join(' · ')
  if (!snapshot.playing) stateText = `Пауза · ${stateText || 'Kolaars Music'}`
  if (!stateText.trim()) stateText = 'Kolaars Music'

  const activity: SetActivity = {
    type: LISTENING_TYPE,
    details: title,
    state: clip(stateText, 128),
    instance: false
  }

  if (isPublicImage(snapshot.artworkUrl)) {
    activity.largeImageKey = snapshot.artworkUrl
    activity.largeImageText = clip([title, artist].filter(Boolean).join(' — '), 128)
  }

  if (snapshot.playing) {
    const rawPosition = snapshot.position
    const position =
      typeof rawPosition === 'number' && Number.isFinite(rawPosition) ? Math.max(0, rawPosition) : 0
    const rawDuration = snapshot.duration
    const duration =
      typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0
        ? rawDuration
        : null

    const now = Date.now()
    const start = now - Math.min(position, duration ?? position) * 1000
    activity.startTimestamp = start
    if (duration && duration > 0) {
      activity.endTimestamp = start + duration * 1000
    }
  }

  const buttons = buildDiscordButtons(snapshot)
  if (buttons.length > 0) activity.buttons = buttons

  return activity
}

async function createClient(id: string): Promise<DiscordRpcClient> {
  const { Client } = await import('@xhayper/discord-rpc')
  return new Client({ clientId: id })
}

async function connect(): Promise<void> {
  if (!enabled || !clientId || connecting) return
  if (client?.isConnected) {
    setState('connected')
    await applyPresence()
    return
  }

  connecting = true
  const currentGeneration = ++generation
  setState('connecting')

  let next: DiscordRpcClient | null = null
  try {
    next = await createClient(clientId)
    if (currentGeneration !== generation || !enabled) {
      await next.destroy().catch(() => undefined)
      return
    }
    client = next

    next.on('ready', () => {
      if (currentGeneration !== generation || !enabled || client !== next) return
      setState('connected')
      void applyPresence()
    })

    next.on('disconnected', () => {
      if (currentGeneration !== generation || client !== next) return
      client = null
      if (!enabled) return
      setState('error', 'Соединение с Discord потеряно')
      scheduleRetry()
    })

    await next.login()
  } catch (error) {
    if (next && currentGeneration === generation) {
      console.warn('[discord-rpc] connection:', error)
      client = null
      await next.destroy().catch(() => undefined)
      if (!enabled) return
      setState('error', friendlyError(error))
      scheduleRetry()
    }
  } finally {
    if (currentGeneration === generation) connecting = false
  }
}

async function stopClient(): Promise<void> {
  generation++
  clearRetry()
  connecting = false
  const old = client
  client = null
  if (!old) return
  try {
    if (old.user) {
      await old.user.clearActivity()
    }
  } catch {
    /* not connected */
  }
  try {
    await old.destroy()
  } catch {
    /* already closed */
  }
}

/**
 * Enables, disables or reconfigures Rich Presence. Returns immediately; the
 * connection attempt continues in the background and its state is reported
 * through the status sink.
 */
export function configureDiscordRpc(nextEnabled: boolean, nextClientId: string): DiscordRpcStatus {
  const normalized = String(nextClientId ?? '').trim()
  const idChanged = normalized !== clientId
  const enabledChanged = Boolean(nextEnabled) !== enabled

  enabled = Boolean(nextEnabled)
  clientId = normalized
  clearRetry()

  if (!enabled) {
    void stopClient()
    setState('disabled')
    return discordRpcStatus()
  }

  if (!clientId) {
    void stopClient()
    setState('missing-client-id', 'Укажите Application ID приложения Discord')
    return discordRpcStatus()
  }

  if (!CLIENT_ID_RE.test(clientId)) {
    void stopClient()
    setState('error', 'Application ID должен состоять из 17–20 цифр')
    return discordRpcStatus()
  }

  if (idChanged || enabledChanged) {
    void stopClient().then(() => connect())
  } else if (state === 'error' && !connecting) {
    void connect()
  } else if (!client && !connecting) {
    void connect()
  }

  return discordRpcStatus()
}

/** Updates the track shown in Discord. A snapshot is cached before connecting. */
export function setDiscordActivity(nextPresence: DiscordPresence | null): DiscordRpcStatus {
  presence = nextPresence
  if (!enabled || !clientId) return discordRpcStatus()

  if (state === 'connected') {
    void applyPresence()
  } else if (state === 'connecting') {
    /* the ready handler will apply the cached snapshot */
  } else if (!client && !retryTimer) {
    void connect()
  }

  return discordRpcStatus()
}

/** Clears presence and closes the local Discord IPC socket on app quit. */
export async function shutdownDiscordRpc(): Promise<void> {
  enabled = false
  presence = null
  await stopClient()
  setState('disabled')
}
