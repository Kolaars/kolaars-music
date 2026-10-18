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

const root = path.resolve(import.meta.dirname, '..')
const keepOpen = process.argv.includes('--keep-open')
const shotDir = process.argv.find((arg) => arg.startsWith('--screenshot='))?.slice('--screenshot='.length)
const exe =
  process.argv.find((arg) => arg.startsWith('--exe='))?.slice('--exe='.length) ??
  path.join(root, 'release', 'win-unpacked', 'Kolaars Music.exe')

const PORT = Number(process.env.SMOKE_PORT ?? 9334)
const userDataDir = path.join(os.tmpdir(), `kolaars-packed-${process.pid}`)
const fixtureDir = path.join(os.tmpdir(), `kolaars-fixture-${process.pid}`)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const paint = (color, text) => `\u001b[${color}m${text}\u001b[0m`

/* ------------------------------------------------------------------ */
/* Fixture: a 3 s WAV plus a sidecar .lrc, so the local path has real   */
/* input and the tag reader has something to parse.                     */
/* ------------------------------------------------------------------ */

function makeWav(seconds = 3, rate = 44100) {
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
  return {
    audios: list.length,
    src: a.currentSrc || a.src,
    currentTime: +a.currentTime.toFixed(2),
    duration: Number.isFinite(a.duration) ? +a.duration.toFixed(2) : null,
    paused: a.paused,
    readyState: a.readyState,
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
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const output = []
  child.stdout.on('data', (chunk) => output.push(String(chunk)))
  child.stderr.on('data', (chunk) => output.push(String(chunk)))

  let cdp

  const finish = async (code) => {
    try {
      if (cdp) await cdp.send('Browser.close').catch(() => undefined)
    } catch {
      /* ignore */
    }
    if (!keepOpen) {
      await sleep(400)
      if (child.exitCode === null) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      }
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
    let target
    const deadline = Date.now() + 40_000
    for (;;) {
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
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
    cdp = await new Promise((resolve, reject) => {
      socket.addEventListener('open', () => resolve(new Cdp(socket)), { once: true })
      socket.addEventListener('error', () => reject(new Error('could not open the devtools socket')), {
        once: true
      })
    })

    // The player owns a detached `new Audio()`, so hook the constructor before
    // the bundle runs, then reload once.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
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
    await cdp.send('Page.reload')

    await cdp.waitFor('the app shell', "!!document.querySelector('.app-shell')", 40_000)
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
        if (!(track.duration >= 2 && track.duration <= 4)) {
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
    } catch (error) {
      failures.push(`local import / kmedia://: ${error.message}`)
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
