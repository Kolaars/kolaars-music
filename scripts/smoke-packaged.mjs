#!/usr/bin/env node
/**
 * Smoke test for a *packaged* build.
 *
 * `scripts/smoke.mjs` drives the app from source (`electron .` + `out/`). This
 * one drives the artefact users actually install: it launches the executable
 * out of `release/win-unpacked` and checks the things a source run cannot
 * prove — that the asar archive loads, that `music-metadata` resolves from the
 * unpacked archive, and that the privileged `kmedia://` scheme streams a local
 * file in the packaged app.
 *
 * Run `npm run pack` first (or `npm run dist`).
 *
 * Usage:
 *   node scripts/smoke-packaged.mjs [--exe=PATH] [--screenshot=DIR] [--keep-open]
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

const root = path.resolve(import.meta.dirname, '..')
const keepOpen = process.argv.includes('--keep-open')
const shotDir = process.argv.find((arg) => arg.startsWith('--screenshot='))?.slice('--screenshot='.length)
const exe =
  process.argv.find((arg) => arg.startsWith('--exe='))?.slice('--exe='.length) ??
  path.join(root, 'release', 'win-unpacked', 'Kolaars Music.exe')

const PORT = Number(process.env.SMOKE_PORT ?? 9334)
/** The restart check reopens the app; a second port avoids a lingering endpoint. */
const SECOND_PORT = PORT + 1
const userDataDir = path.join(os.tmpdir(), `kolaars-packed-${process.pid}`)
const fixtureDir = path.join(os.tmpdir(), `kolaars-fixture-${process.pid}`)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const paint = (color, text) => `\u001b[${color}m${text}\u001b[0m`

/* ------------------------------------------------------------------ */
/* Fixture: a 45 s WAV plus a sidecar .lrc, so the local path has real  */
/* input and the tag reader has something to parse. It is deliberately  */
/* longer than the couple of seconds Chromium buffers up front — a seek */
/* to the far end is what proves the protocol answers `Range`.          */
/* ------------------------------------------------------------------ */

function makeWav(seconds = 45, rate = 44100) {
  const frames = seconds * rate
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

mkdirSync(fixtureDir, { recursive: true })
const wavPath = path.join(fixtureDir, 'Kolaars Tone.wav')
writeFileSync(wavPath, makeWav())
writeFileSync(
  path.join(fixtureDir, 'Kolaars Tone.lrc'),
  '[ti:Kolaars Tone]\n[ar:Kolaars QA]\n[00:00.50]Первая строка\n[00:02.00]Вторая строка\n'
)

/* A real image beside the track: the sidecar cover convention is shared with
 * the music downloaders, and a text file cannot prove that an <img> renders. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A small solid-colour PNG, minimally valid so Chromium will decode it. */
function makePng(width = 16, height = 16, [r, g, b] = [120, 90, 220]) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // truecolour
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = r
      raw[row + 2 + x * 3] = g
      raw[row + 3 + x * 3] = b
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

const coverPath = path.join(fixtureDir, 'Kolaars Tone.png')
writeFileSync(coverPath, makePng())

/* ------------------------------------------------------------------ */
/* Chrome DevTools Protocol client                                     */
/* ------------------------------------------------------------------ */

class Cdp {
  #socket
  #nextId = 1
  #pending = new Map()
  problems = []

  constructor(socket) {
    this.#socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const entry = this.#pending.get(message.id)
        if (!entry) return
        this.#pending.delete(message.id)
        if (message.error) entry.reject(new Error(`${message.error.message} (${entry.method})`))
        else entry.resolve(message.result)
        return
      }
      this.#onEvent(message)
    })
    socket.addEventListener('close', () => {
      for (const entry of this.#pending.values()) entry.reject(new Error('devtools socket closed'))
      this.#pending.clear()
    })
    this.#send('Runtime.enable').catch(() => undefined)
    this.#send('Page.enable').catch(() => undefined)
  }

  #send(method, params = {}) {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  send(method, params) {
    return this.#send(method, params)
  }

  #onEvent(message) {
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params?.exceptionDetails
      const text = details?.exception?.description ?? details?.text ?? 'unknown renderer exception'
      this.problems.push(`uncaught exception: ${text.split('\n')[0]}`)
      return
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      const text = (message.params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.type)
        .join(' ')
      // Failed archive.org thumbnails are expected and reported as console errors.
      if (/Failed to load resource|net::ERR/i.test(text)) return
      this.problems.push(`console.error: ${text.slice(0, 200)}`)
    }
  }

  async evaluate(expression) {
    const result = await this.#send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.exceptionDetails) {
      const text =
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'eval failed'
      throw new Error(text.split('\n')[0])
    }
    return result.result?.value
  }

  async waitFor(label, expression, timeout = 30_000, interval = 250) {
    const deadline = Date.now() + timeout
    for (;;) {
      try {
        if (await this.evaluate(expression)) return
      } catch {
        /* the page may still be navigating */
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
      await sleep(interval)
    }
  }

  async screenshot() {
    const result = await this.#send('Page.captureScreenshot', { format: 'png' })
    return Buffer.from(result.data, 'base64')
  }
}

/* ------------------------------------------------------------------ */
/* Runner                                                             */
/* ------------------------------------------------------------------ */

/** Reads the detached `new Audio()` the player keeps, unreachable via the DOM. */
const AUDIO_STATE = `(() => {
  const list = window.__kolaarsProbeAudios ?? []
  const a = list[list.length - 1]
  if (!a) return { audios: list.length, note: 'no Audio instance captured' }
  const seekable = []
  for (let i = 0; i < a.seekable.length; i++) {
    seekable.push([+a.seekable.start(i).toFixed(1), +a.seekable.end(i).toFixed(1)])
  }
  return {
    audios: list.length,
    src: a.currentSrc || a.src,
    currentTime: +a.currentTime.toFixed(2),
    duration: Number.isFinite(a.duration) ? +a.duration.toFixed(2) : null,
    paused: a.paused,
    readyState: a.readyState,
    seekable,
    error: a.error ? { code: a.error.code, message: a.error.message } : null
  }
})()`

const CHECKS = [
  ['renderer loads from the asar archive', "!!document.querySelector('.app-shell')"],
  ['sidebar navigation has entries', "document.querySelectorAll('.navitem').length >= 6"],
  ['discover header renders in Russian', "!!document.querySelector('.hero__title')?.textContent?.includes('Музыка')"],
  ['seed shelves are on screen', "document.querySelectorAll('.shelf').length >= 5"],
  ['shelf cards are populated', "document.querySelectorAll('.card').length >= 20"],
  [
    'player bar starts idle',
    "document.querySelector('.playerbar__title')?.textContent?.trim() === 'Ничего не играет'"
  ],
  ['no page overflows the window horizontally', 'document.documentElement.scrollWidth <= window.innerWidth + 2'],
  ['preload bridge is exposed', "typeof window.kolaars?.local?.importPaths === 'function'"]
]

async function main() {
  const failures = []
  const output = []
  let child = null
  let cdp = null

  const launch = (port) => {
    child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', (chunk) => output.push(String(chunk)))
    child.stderr.on('data', (chunk) => output.push(String(chunk)))
    return child
  }

  const waitForExit = (timeout = 10_000) =>
    new Promise((resolve) => {
      if (!child || child.exitCode !== null) return resolve(true)
      const timer = setTimeout(() => resolve(false), timeout)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })

  const stop = async () => {
    if (cdp) await cdp.send('Browser.close').catch(() => undefined)
    cdp = null
    const exited = await waitForExit(8_000)
    if (!exited && child?.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      await sleep(500)
    }
  }

  /**
   * Waits for the devtools endpoint, attaches, and hooks the audio constructor
   * before the bundle runs so the player's detached `new Audio()` is visible.
   */
  const attach = async (port, { reload = true } = {}) => {
    let target
    const deadline = Date.now() + 40_000
    for (;;) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`)
        const targets = await response.json()
        target = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
        if (target) break
      } catch {
        /* the devtools endpoint is not up yet */
      }
      if (Date.now() > deadline) throw new Error('the packaged app never exposed a devtools target')
      await sleep(400)
    }
    process.stdout.write(`  exe  ${exe}\n`)
    process.stdout.write(`  url  ${target.url}\n`)

    const socket = new WebSocket(target.webSocketDebuggerUrl)
    const client = await new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve(new Cdp(socket)), { once: true })
      socket.addEventListener('error', () => reject(new Error('could not open the devtools socket')), {
        once: true
      })
    })
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__kolaarsProbeAudios = []
        const Original = window.Audio
        window.Audio = function (...args) {
          const element = new Original(...args)
          window.__kolaarsProbeAudios.push(element)
          return element
        }
        window.Audio.prototype = Original.prototype
      })()`
    })
    if (reload) await client.send('Page.reload')
    await client.waitFor('the app shell', "!!document.querySelector('.app-shell')", 40_000)
    return client
  }

  const finish = async (code) => {
    await stop()
    if (!keepOpen) {
      try {
        rmSync(userDataDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(fixtureDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    const log = output.join('').trim()
    if (log) process.stdout.write(`\n--- app output ---\n${log}\n`)
    if (failures.length > 0) {
      process.stdout.write(`\n${paint(31, `${failures.length} problem(s):`)}\n`)
      for (const failure of failures) process.stdout.write(`  - ${failure}\n`)
      process.exit(code || 1)
    }
    process.stdout.write(`\n${paint(32, 'packaged smoke test passed')}\n`)
    process.exit(code)
  }

  try {
    launch(PORT)
    cdp = await attach(PORT)
    await cdp.waitFor('the seed catalog', "document.querySelectorAll('.card').length > 0", 40_000)
    await sleep(1_500)

    for (const [name, expression] of CHECKS) {
      let ok = false
      try {
        ok = Boolean(await cdp.evaluate(expression))
      } catch (error) {
        failures.push(`${name}: ${error.message}`)
      }
      if (!ok) failures.push(name)
      process.stdout.write(`${ok ? paint(32, '  ok  ') : paint(31, ' FAIL ')} ${name}\n`)
    }

    /* A remote seed track, played by the real player. archive.org is outside
     * our control, so a stream that never loads is reported as a note; if it
     * does load, playback must actually advance. The offline path below is the
     * deterministic hard requirement. */
    try {
      let remote = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        await cdp.evaluate(`document.querySelector('.card__play')?.click()`)
        await sleep(7_000)
        remote = await cdp.evaluate(AUDIO_STATE)
        if (remote.readyState >= 2 && remote.currentTime > 0) break
        if (attempt < 3) {
          process.stdout.write(`${paint(33, ' note ')} remote stream not ready, retrying (${attempt}/3)\n`)
          await cdp.send('Page.reload')
          await cdp.waitFor('the seed catalog', "document.querySelectorAll('.card').length > 0", 40_000)
          await sleep(1_000)
        }
      }
      process.stdout.write(`  ..  remote playback: ${JSON.stringify(remote)}\n`)
      if (remote.readyState >= 2 && remote.currentTime > 0) {
        if (!/^https?:/.test(String(remote.src ?? ''))) failures.push(`remote track src looks wrong (${remote.src})`)
        process.stdout.write(`${paint(32, '  ok  ')} a remote seed track plays from archive.org\n`)
      } else {
        process.stdout.write(
          `${paint(33, ' note ')} archive.org stream unavailable (readyState ${remote.readyState}, error ${JSON.stringify(remote.error)}) — skipping\n`
        )
      }
    } catch (error) {
      failures.push(`remote playback: ${error.message}`)
    }

    /* Local import: tags via `music-metadata`, then playback over kmedia://. */
    try {
      const imported = await cdp.evaluate(`window.kolaars.local.importPaths([${JSON.stringify(wavPath)}])`)
      const track = imported?.tracks?.[0]
      process.stdout.write(
        `  ..  import: ${JSON.stringify({
          tracks: imported?.tracks?.length,
          skipped: imported?.skipped,
          failed: imported?.failed,
          track:
            track && {
              id: track.id,
              title: track.title,
              duration: track.duration,
              offline: track.offline,
              streamUrl: track.streamUrl
            }
        })}\n`
      )
      if (!track) {
        failures.push('local import returned no track')
      } else {
        if (!String(track.id).startsWith('local:')) failures.push(`local track id is not local:* (${track.id})`)
        if (!String(track.streamUrl).startsWith('kmedia://')) {
          failures.push(`local streamUrl is not kmedia:// (${track.streamUrl})`)
        }
        if (track.title !== 'Kolaars Tone') failures.push(`filename was not used as the title (${track.title})`)
        if (!(track.duration >= 43 && track.duration <= 47)) {
          failures.push(`music-metadata did not report a duration (${track.duration})`)
        }
      }

      const lyrics = await cdp.evaluate(
        `window.kolaars.lyrics.get(${JSON.stringify({ id: track?.id, title: track?.title, artist: track?.artist })})`
      )
      const saved = lyrics?.saved
      process.stdout.write(
        `  ..  sidecar lyrics: ${JSON.stringify(saved && { origin: saved.origin, synced: saved.synced?.length })}\n`
      )
      if (!saved) failures.push('the sidecar .lrc was not imported')
      else if (!(saved.synced?.length >= 2)) {
        failures.push(`sidecar .lrc produced ${saved.synced?.length ?? 0} synced lines`)
      }

      await cdp.evaluate(`(() => {
        const element = new Audio(${JSON.stringify(track?.streamUrl)})
        return element.play().then(() => true).catch((error) => 'play() rejected: ' + error.message)
      })()`)
      await sleep(2_500)
      const state = await cdp.evaluate(AUDIO_STATE)
      process.stdout.write(`  ..  kmedia playback: ${JSON.stringify(state)}\n`)
      if (!String(state.src ?? '').startsWith('kmedia://')) failures.push(`kmedia:// src was lost (${state.src})`)
      if (!(state.readyState >= 2)) {
        failures.push(
          `kmedia:// track never became playable (readyState ${state.readyState}, error ${JSON.stringify(state.error)})`
        )
      }
      if (!(state.currentTime > 0)) failures.push(`kmedia:// playback never advanced (currentTime ${state.currentTime})`)

      /* Seeking is the point of `kmedia://` answering `Range`: without it the
       * element reports a non-seekable stream, the seek bar does nothing and a
       * lyric line or a restored position throws the track back to the start. */
      const whole = (state.seekable?.length ?? 0) > 0 && state.seekable[0][1] >= (state.duration ?? 0) - 0.5
      if (!whole) {
        failures.push(`the local file was not seekable (seekable ${JSON.stringify(state.seekable)} of ${state.duration}s)`)
      } else {
        const asked = Math.max(1, (state.duration ?? 45) - 5)
        await cdp.evaluate(`(window.__kolaarsProbeAudios[window.__kolaarsProbeAudios.length - 1]).currentTime = ${asked}`)
        await sleep(700)
        const jumped = await cdp.evaluate(AUDIO_STATE)
        process.stdout.write(`  ..  seek to ${asked}s: ${JSON.stringify(jumped)}\n`)
        if (Math.abs((jumped.currentTime ?? -99) - asked) > 0.9) {
          failures.push(`a seek to ${asked}s landed at ${jumped.currentTime}s`)
        } else {
          process.stdout.write(`${paint(32, '  ok  ')} the local file can be seeked anywhere\n`)
        }
      }
    } catch (error) {
      failures.push(`local import / kmedia://: ${error.message}`)
    }

    /* Restart regression.
     *
     * The kmedia:// allowlist lives in memory only, so a fresh process starts
     * with nothing allowed: every local track came back unplayable and every
     * sidecar cover blank, with no hint why. Close the app for real, reopen it
     * on the same profile, and use the track the way the UI does. */
    try {
      const before = await cdp.evaluate(`(async () => {
        const db = await window.kolaars.store.load()
        const row = db.tracks.find((track) => track.filePath === ${JSON.stringify(wavPath)})
        return row ? { artwork: row.artwork, streamUrl: row.streamUrl } : null
      })()`)
      if (!before?.artwork) failures.push('the sidecar cover was not attached at import time')

      process.stdout.write(`  ..  restarting on the same profile\n`)
      await stop()
      launch(SECOND_PORT)
      cdp = await attach(SECOND_PORT)
      await sleep(2_000)

      const after = await cdp.evaluate(`(async () => {
        const db = await window.kolaars.store.load()
        const row = db.tracks.find((track) => track.filePath === ${JSON.stringify(wavPath)})
        if (!row) return { missing: true, tracks: db.tracks.length }
        const audio = new Audio(row.streamUrl)
        const played = await audio.play().then(() => true).catch((error) => 'play() rejected: ' + error.message)
        await new Promise((resolve) => setTimeout(resolve, 2_500))
        const seekable = []
        for (let i = 0; i < audio.seekable.length; i++) {
          seekable.push([+audio.seekable.start(i).toFixed(1), +audio.seekable.end(i).toFixed(1)])
        }
        const duration = Number.isFinite(audio.duration) ? +audio.duration.toFixed(2) : null
        let landed = null
        if (duration) {
          const asked = Math.max(1, duration - 5)
          audio.currentTime = asked
          await new Promise((resolve) => setTimeout(resolve, 700))
          landed = { asked, at: +audio.currentTime.toFixed(2) }
        }
        return {
          streamUrl: row.streamUrl,
          artwork: String(row.artwork ?? '').slice(0, 48),
          played,
          readyState: audio.readyState,
          currentTime: +audio.currentTime.toFixed(2),
          duration,
          seekable,
          landed,
          error: audio.error ? { code: audio.error.code, message: audio.error.message } : null
        }
      })()`)
      process.stdout.write(`  ..  playback after restart: ${JSON.stringify(after)}\n`)

      if (after?.missing) {
        failures.push(`the local track was lost after a restart (${after.tracks} tracks)`)
      } else {
        if (!(after.readyState >= 2)) {
          failures.push(
            `local track not playable after a restart (readyState ${after.readyState}, error ${JSON.stringify(after.error)})`
          )
        }
        if (!(after.currentTime > 0)) {
          failures.push(`local playback did not advance after a restart (currentTime ${after.currentTime})`)
        }
        const afterWhole = (after.seekable?.length ?? 0) > 0 && after.seekable[0][1] >= (after.duration ?? 0) - 0.5
        if (!afterWhole) {
          failures.push(`the local file was not seekable after a restart (seekable ${JSON.stringify(after.seekable)})`)
        }
        if (after.landed && Math.abs((after.landed.at ?? -99) - after.landed.asked) > 0.9) {
          failures.push(`a seek to ${after.landed.asked}s landed at ${after.landed.at}s after a restart`)
        }

        /* The cover has to survive the restart too — that is the half of the
         * bug a user notices first, because the library fills with blanks. */
        await cdp.evaluate(`(() => {
          const item = [...document.querySelectorAll('.navitem')]
            .find((node) => (node.textContent ?? '').includes('Библиотека'))
          item?.click()
        })()`)
        await cdp.waitFor('the library rows', "document.querySelectorAll('.trackrow').length > 0", 20_000)
        await sleep(1_500)
        const cover = await cdp.evaluate(`(() => {
          const row = [...document.querySelectorAll('.trackrow')]
            .find((node) => (node.textContent ?? '').includes('Kolaars Tone'))
          if (!row) return { found: false }
          const image = row.querySelector('img')
          return {
            found: true,
            width: image?.naturalWidth ?? 0,
            height: image?.naturalHeight ?? 0,
            src: String(image?.currentSrc ?? image?.src ?? '').slice(0, 24)
          }
        })()`)
        process.stdout.write(`  ..  library cover after restart: ${JSON.stringify(cover)}\n`)
        if (!cover.found) failures.push('the imported track is missing from the library after a restart')
        else if (!(cover.width > 0)) {
          failures.push(`the sidecar cover did not render after a restart (${JSON.stringify(cover)})`)
        } else {
          process.stdout.write(`${paint(32, '  ok  ')} local audio and artwork survive a restart\n`)
        }
      }
    } catch (error) {
      failures.push(`restart regression: ${error.message}`)
    }

    if (shotDir) {
      mkdirSync(shotDir, { recursive: true })
      writeFileSync(path.join(shotDir, 'packaged-discover.png'), await cdp.screenshot())
      process.stdout.write(`${paint(36, ' shot ')} packaged-discover.png\n`)
    }

    for (const problem of cdp.problems) failures.push(problem)
  } catch (error) {
    failures.push(error.message)
    process.stdout.write(`${paint(31, ' FAIL ')} ${error.message}\n`)
  }

  await finish(failures.length > 0 ? 1 : 0)
}

void main()
