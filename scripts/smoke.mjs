#!/usr/bin/env node
/**
 * Headless smoke test for the built application.
 *
 * `npm run build` first, then this script launches the real Electron app with
 * remote debugging enabled, attaches to the renderer over the Chrome DevTools
 * Protocol, and asserts that the UI actually came up: the shell renders, the
 * sidebar has entries, the Discover shelves are populated, clicking a card
 * starts playback, lyrics and queue panels open, and routes navigate.
 *
 * The last check imports a throwaway folder shaped like a music downloader's
 * output — untagged files, names only in the file name, covers in sidecar
 * images — and asserts the app derives real artist, title and artwork from it.
 *
 * It also fails on any uncaught renderer exception or `console.error`, which is
 * exactly the class of bug that a build + typecheck cannot catch.
 *
 * Usage: node scripts/smoke.mjs [--keep-open]
 */

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const electronBinary = require('electron')
const keepOpen = process.argv.includes('--keep-open')
const shotDir = process.argv.find((arg) => arg.startsWith('--screenshot='))?.slice('--screenshot='.length)

const PORT = Number(process.env.SMOKE_PORT ?? 9333)
const userDataDir = path.join(os.tmpdir(), `kolaars-smoke-${process.pid}`)
/** Throwaway folder of downloader-shaped files, used by the local import check. */
const fixtureDir = path.join(os.tmpdir(), `kolaars-smoke-music-${process.pid}`)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const paint = (color, text) => `\u001b[${color}m${text}\u001b[0m`

/** A tiny playable WAV, so a check can seek and follow a lyric line. */
function makeWav(seconds, rate = 44100) {
  const frames = seconds * rate
  const samples = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    samples.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 330 * i) / rate) * 9000), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + samples.length, 4)
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
  header.writeUInt32LE(samples.length, 40)
  return Buffer.concat([header, samples])
}

/** Thirty synced lines, dense enough to overflow any lyrics panel. */
const SMOKE_LINES = Array.from({ length: 30 }, (_, index) => ({
  text: `Строка ${index + 1} — проверка перехода`,
  time: Number((0.35 * index + 0.2).toFixed(2))
}))

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
      const message = JSON.parse(event.data)
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
    this.#send('Log.enable').catch(() => undefined)
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
      const text =
        details?.exception?.description ?? details?.text ?? 'unknown renderer exception'
      this.problems.push(`uncaught exception: ${text.split('\n')[0]}`)
      return
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      const text = (message.params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.type)
        .join(' ')
      // Chromium reports failed <img> loads through the console; those are
      // expected for archive.org thumbnails that 404.
      if (/Failed to load resource|net::ERR/i.test(text)) return
      this.problems.push(`console.error: ${text.slice(0, 200)}`)
      return
    }
    if (message.method === 'Log.entryAdded') {
      const entry = message.params?.entry
      if (entry?.source !== 'javascript') return
      if (entry.level === 'error') this.problems.push(`log error: ${entry.text}`)
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

  async screenshot() {
    const result = await this.#send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    })
    return Buffer.from(result.data, 'base64')
  }

  /** Centre of an element in viewport coordinates. */
  async box(selector, nth = 0) {
    return this.evaluate(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(selector)})[${nth}]
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height }
    })()`)
  }

  /** Move the pointer somewhere, without pressing. */
  async hover(x, y) {
    await this.#send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  }

  /**
   * A trusted press.
   *
   * Menus and click-to-seek only ever broke for a real pointer: a programmatic
   * `element.click()` skips the pointer events that used to dismiss the menu
   * before the click could land. Anything user-facing has to be pressed like
   * this or the regression goes unnoticed.
   */
  async press(x, y) {
    const button = { x, y, button: 'left', clickCount: 1 }
    await this.#send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.#send('Input.dispatchMouseEvent', { type: 'mousePressed', ...button })
    await sleep(30)
    await this.#send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...button })
  }

  async waitFor(label, expression, timeout = 25_000, interval = 250) {
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
}

/* ------------------------------------------------------------------ */
/* Launch                                                             */
/* ------------------------------------------------------------------ */

function launch() {
  mkdirSync(userDataDir, { recursive: true })
  const child = spawn(
    electronBinary,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`, '.'],
    {
      cwd: root,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  const output = []
  child.stdout.on('data', (chunk) => output.push(String(chunk)))
  child.stderr.on('data', (chunk) => output.push(String(chunk)))
  return { child, output }
}

async function findTarget() {
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await response.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* devtools endpoint is not up yet */
    }
    if (Date.now() > deadline) throw new Error('the renderer never exposed a devtools target')
    await sleep(300)
  }
}

function connect(url) {
  if (typeof WebSocket === 'undefined') {
    throw new Error('this Node build has no global WebSocket; use Node 22.4+')
  }
  const socket = new WebSocket(url)
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(new Cdp(socket)), { once: true })
    socket.addEventListener('error', () => reject(new Error('could not open the devtools socket')), {
      once: true
    })
  })
}

/* ------------------------------------------------------------------ */
/* Checks                                                             */
/* ------------------------------------------------------------------ */

const CHECKS = [
  {
    name: 'app shell is mounted',
    expression: "!!document.querySelector('.app-shell')"
  },
  {
    name: 'the renderer is served from loopback HTTP',
    expression: "location.origin.startsWith('http://127.0.0.1:')"
  },
  {
    name: 'the renderer sends a CSP for the official players',
    expression: `fetch(location.href).then((response) => {
      const policy = response.headers.get('content-security-policy') ?? ''
      return (
        policy.includes("frame-src https://www.youtube.com") &&
        policy.includes("script-src 'self' https://www.youtube.com")
      )
    })`
  },
  {
    name: 'title bar + window controls are rendered',
    expression: "!!document.querySelector('.titlebar') && document.querySelectorAll('.titlebar button').length >= 3"
  },
  {
    name: 'sidebar navigation has entries',
    expression: "document.querySelectorAll('.navitem').length >= 6"
  },
  {
    name: 'discover header renders in Russian',
    expression: "!!document.querySelector('.hero__title')?.textContent?.includes('Музыка')"
  },
  {
    name: 'seed shelves are on screen',
    expression: "document.querySelectorAll('.shelf').length >= 5"
  },
  {
    name: 'shelf cards are populated',
    expression: "document.querySelectorAll('.card').length >= 20"
  },
  {
    name: 'cards show a title, artist and cover',
    expression: `(() => {
      const card = document.querySelector('.card')
      if (!card) return false
      return (
        !!card.querySelector('.card__art')?.className.includes('cover') &&
        !!card.querySelector('.card__title')?.textContent &&
        !!card.querySelector('.card__sub')?.textContent
      )
    })()`
  },
  {
    name: 'player bar starts idle',
    expression: "document.querySelector('.playerbar__title')?.textContent?.trim() === 'Ничего не играет'"
  },
  {
    name: 'theme variables resolve',
    expression: `(() => {
      const style = getComputedStyle(document.documentElement)
      return !!style.getPropertyValue('--accent').trim() && !!style.getPropertyValue('--bg-1').trim()
    })()`
  },
  {
    name: 'root element is themed, not transparent',
    expression: "getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'"
  }
]

const INTERACTIONS = [
  {
    name: 'clicking a card plays the track',
    run: `document.querySelector('.card__play').click()`,
    assert: `(() => {
      const title = document.querySelector('.playerbar__title')?.textContent?.trim() ?? ''
      return title && title !== 'Ничего не играет'
    })()`,
    assertName: 'the player bar shows a title'
  },
  {
    name: 'transport controls react to play/pause',
    run: `document.querySelector('.transport__play').click()`,
    assert: `!!document.querySelector('.transport__play')`,
    assertName: 'play button still present'
  },
  {
    name: 'the lyrics button opens the lyrics panel',
    run: `(() => {
      const buttons = [...document.querySelectorAll('.playerbar__right .iconbtn')]
      buttons.find((b) => (b.getAttribute('title') ?? '').startsWith('Текст'))?.click()
    })()`,
    assert: `!!document.querySelector('.lyricsdock')`,
    assertName: '.lyricsdock appears'
  },
  {
    name: 'the queue button opens the queue panel',
    run: `(() => {
      const buttons = [...document.querySelectorAll('.playerbar__right .iconbtn')]
      buttons.find((b) => (b.getAttribute('title') ?? '').startsWith('Очередь'))?.click()
    })()`,
    assert: `!!document.querySelector('.queuepanel, .queue')`,
    assertName: 'queue panel appears'
  },
  {
    name: 'clicking a cover opens the Now Playing overlay',
    run: `document.querySelector('.playerbar__coverbtn').click()`,
    assert: `!!document.querySelector('.nowplaying')`,
    assertName: '.nowplaying appears'
  },
  {
    name: 'the Now Playing overlay takes over the side docks',
    assert: `!document.querySelector('.queue') && !document.querySelector('.lyricsdock')`,
    assertName: 'the queue and lyrics docks are closed'
  },
  {
    name: 'the Now Playing overlay closes with Escape',
    run: `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    assert: `!document.querySelector('.nowplaying')`,
    assertName: '.nowplaying is gone'
  },
  {
    name: 'sidebar navigation switches views',
    run: `(() => {
      const items = [...document.querySelectorAll('.navitem')]
      const target = items.find((i) => !i.classList.contains('navitem--active')) ?? items[1]
      target?.click()
    })()`,
    assert: `document.querySelectorAll('.navitem--active').length === 1`,
    assertName: 'exactly one nav item is active'
  },
  {
    name: 'the library view renders',
    run: `(() => {
      const items = [...document.querySelectorAll('.navitem')]
      items.find((i) => (i.textContent ?? '').includes('Библиотека'))?.click()
    })()`,
    assert: "!!document.querySelector('.page--library')",
    assertName: '.page--library is on screen'
  },
  {
    name: 'the settings view renders',
    run: `(() => {
      const items = [...document.querySelectorAll('.navitem')]
      items.find((i) => (i.textContent ?? '').includes('Настройки'))?.click()
    })()`,
    assert: "!!document.querySelector('.page--settings')",
    assertName: '.page--settings is on screen'
  },
  {
    name: 'the sources view renders its connection panel',
    run: `(() => {
      const items = [...document.querySelectorAll('.navitem')]
      items.find((i) => (i.textContent ?? '').includes('Источники'))?.click()
    })()`,
    assert:
      "!!document.querySelector('.page--sources') && !!document.querySelector('.sources__connect') && !!document.querySelector('.sources__keyform input')",
    assertName: '.page--sources with a key field is on screen'
  },
  {
    name: 'the playlists view renders and opens the create dialog',
    run: `(() => {
      const items = [...document.querySelectorAll('.navitem')]
      items.find((i) => (i.textContent ?? '').includes('Плейлисты'))?.click()
    })()`,
    assert: "!!document.querySelector('.page--playlists')",
    assertName: '.page--playlists is on screen'
  },
  {
    name: 'the new-playlist dialog opens and closes',
    run: `(() => {
      const button = [...document.querySelectorAll('.page--playlists button')]
        .find((b) => (b.textContent ?? '').includes('Новый плейлист'))
      button?.click()
    })()`,
    assert: "!!document.querySelector('.modal')",
    assertName: '.modal appears'
  },
  {
    name: 'the dialog can be dismissed',
    run: `document.querySelector('.modal button[title^="Закрыть"]')?.click()`,
    assert: "!document.querySelector('.modal')",
    assertName: '.modal is gone'
  },
  {
    name: 'search view renders results',
    run: `(() => {
      const items = [...document.querySelectorAll('.navitem')]
      items.find((i) => (i.textContent ?? '').includes('Поиск'))?.click()
    })()`,
    assert: "!!document.querySelector('.page--search') && !!document.querySelector('.searchbar__input')",
    assertName: '.page--search with its search field is on screen'
  },
  {
    name: 'no page overflows the window horizontally',
    assert: `document.documentElement.scrollWidth <= window.innerWidth + 2`,
    assertName: 'the layout does not scroll sideways'
  },
  {
    name: 'creating a playlist through the dialog works',
    steps: [
      `(() => {
        const button = [...document.querySelectorAll('button')]
          .find((b) => (b.getAttribute('title') ?? '').startsWith('Новый плейлист'))
        button?.click()
      })()`,
      `(() => {
        const input = document.querySelector('#prompt-input')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, 'Смоук-плейлист')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()`,
      `[...document.querySelectorAll('.modal__actions .btn--primary')].at(-1)?.click()`
    ],
    delay: 900,
    assert: `[...document.querySelectorAll('.playlist-item__name')].some((node) =>
      (node.textContent ?? '').includes('Смоук-плейлист'))`,
    assertName: 'the playlist is listed in the sidebar'
  }
]

/* ------------------------------------------------------------------ */
/* Runner                                                             */
/* ------------------------------------------------------------------ */

async function main() {
  const { child, output } = launch()
  let cdp
  const failures = []

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
        rmSync(fixtureDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    process.exit(code)
  }

  try {
    const target = await findTarget()
    cdp = await connect(target.webSocketDebuggerUrl)

    /* The window is launched from a background process. Windows is allowed to
     * deny it the foreground, and an unfocused/occluded Chromium window can
     * drop synthetic mouse input entirely. Restore and activate it up front;
     * the same activation is repeated before the real-pointer checks. */
    const activateWindow = async () => {
      await cdp.send('Target.activateTarget', { targetId: target.id }).catch(() => undefined)
      await cdp.send('Page.bringToFront').catch(() => undefined)
      await cdp
        .send('Browser.getWindowForTarget', { targetId: target.id })
        .then(({ windowId }) =>
          cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
        )
        .catch(() => undefined)
      await cdp.evaluate('window.focus()').catch(() => undefined)
    }
    await activateWindow()

    let syntheticInputWarned = false
    /**
     * Press like a user, with a safety net for headless-ish sessions.
     *
     * A Windows window launched by a background process can stay unfocused (or
     * be treated as occluded) even after Target.activateTarget. Chromium then
     * accepts the CDP mouse events but drops them before they reach the page:
     * the hit test still finds the element, yet no pointerdown arrives. If that
     * happens, dispatch the same pointer/mouse/click sequence on the element
     * under the point. The callers still assert what `elementFromPoint` found,
     * so an overlay that really covers the target is never papered over.
     */
    const pressLikeUser = async (x, y) => {
      await cdp.evaluate(`(() => {
        window.__smokeInputSeen = false
        if (window.__smokeInputHook) return
        window.__smokeInputHook = true
        window.addEventListener('pointerdown', () => {
          window.__smokeInputSeen = true
        }, true)
      })()`)
      await cdp.press(x, y)
      await sleep(80)
      if (await cdp.evaluate('window.__smokeInputSeen')) return 'native'
      await cdp.evaluate(`(() => {
        const target = document.elementFromPoint(${x}, ${y})
        if (!target) return
        const base = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: ${x},
          clientY: ${y},
          button: 0,
          buttons: 1,
          view: window
        }
        const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }
        target.dispatchEvent(new PointerEvent('pointerdown', pointer))
        target.dispatchEvent(new MouseEvent('mousedown', base))
        target.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }))
        target.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }))
        target.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }))
      })()`)
      await sleep(80)
      if (!syntheticInputWarned) {
        syntheticInputWarned = true
        process.stdout.write(
          '  note  native mouse input was not delivered; used a synthetic pointer for this check\n'
        )
      }
      return 'synthetic'
    }

    await cdp.waitFor('the app shell', "!!document.querySelector('.app-shell')", 25_000)
    await cdp.waitFor('the seed catalog', "document.querySelectorAll('.card').length > 0", 30_000)
    // Give the live archive.org upgrade a moment; a failure here is not fatal.
    await sleep(1_500)

    for (const check of CHECKS) {
      let ok = false
      try {
        ok = Boolean(await cdp.evaluate(check.expression))
      } catch (error) {
        failures.push(`${check.name}: ${error.message}`)
      }
      if (!ok) failures.push(check.name)
      process.stdout.write(`${ok ? paint(32, '  ok  ') : paint(31, ' FAIL ')} ${check.name}\n`)
    }

    for (const step of INTERACTIONS) {
      let ok = false
      let reason = ''
      try {
        const run = step.steps ?? (step.run ? [step.run] : [])
        for (const expression of run) {
          await cdp.evaluate(expression)
          await sleep(220)
        }
        await sleep(step.delay ?? 350)
        ok = Boolean(await cdp.evaluate(step.assert))
        if (!ok) reason = step.assertName ? ` (${step.assertName})` : ''
      } catch (error) {
        reason = ` (${error.message})`
      }
      if (!ok) failures.push(`${step.name}${reason}`)
      process.stdout.write(`${ok ? paint(32, '  ok  ') : paint(31, ' FAIL ')} ${step.name}\n`)
      if (!ok) {
        const hint = await cdp
          .evaluate(
            `(document.querySelector('.modal')?.innerText ?? document.body.innerText ?? '').slice(0, 500)`
          )
          .catch(() => '')
        if (hint) process.stdout.write(`${paint(90, `        .. ${String(hint).replace(/\s+/g, ' ').slice(0, 400)}`)}\n`)
      }
    }

    for (const problem of cdp.problems) failures.push(problem)

    /* The lyrics "sources" tab. Written with real waits rather than fixed
     * delays: the search is a two-part answer (the pack is local and lands at
     * once, Wikisource is a network round trip allowed twenty seconds), so
     * asserting on a stopwatch only ever measured the network. */
    try {
      const openSourcesTab = async () => {
        const dockOpen = await cdp.evaluate(`!!document.querySelector('.lyricsdock')`)
        if (!dockOpen) {
          await cdp.evaluate(`(() => {
            const button = [...document.querySelectorAll('.playerbar button')]
              .find((item) => (item.getAttribute('title') ?? '').startsWith('Текст'))
            button?.click()
          })()`)
          await cdp.waitFor('the lyrics dock', "!!document.querySelector('.lyricsdock')", 10_000)
        }
        await cdp.evaluate(
          `document.querySelector('.lyricsdock button[title^="Действия с текстом"]')?.click()`
        )
        await cdp.waitFor('the lyrics menu', "document.querySelectorAll('.menu__item').length > 0", 5_000)
        await cdp.evaluate(`[...document.querySelectorAll('.menu__item')]
          .find((item) => (item.textContent ?? '').includes('Найти в открытых базах'))?.click()`)
        await cdp.waitFor(
          'the lyrics workshop search box',
          "!!document.querySelector('.modal .searchbar--inline .input')",
          10_000
        )
      }

      await openSourcesTab()
      await cdp.evaluate(`(() => {
        const input = document.querySelector('.modal .searchbar--inline .input')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, 'Amazing Grace')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await cdp.waitFor(
        'the search box to take the typed query',
        `document.querySelector('.modal .searchbar--inline .input')?.value === 'Amazing Grace'`,
        5_000
      )
      await cdp.waitFor(
        'the sources search button to become pressable',
        `(() => {
          const button = document.querySelector('.modal .searchbar--inline .btn--primary')
          return !!button && !button.disabled
        })()`,
        5_000
      )
      await cdp.evaluate(`document.querySelector('.modal .searchbar--inline .btn--primary')?.click()`)
      let found = true
      try {
        await cdp.waitFor(
          'the bundled pack to answer',
          `[...document.querySelectorAll('.source-block')].some((block) =>
            (block.textContent ?? '').includes('Amazing Grace'))`,
          25_000
        )
      } catch {
        found = false
      }
      process.stdout.write(
        `${found ? paint(32, '  ok  ') : paint(31, ' FAIL ')} the bundled pack answers a sources query\n`
      )
      if (!found) {
        failures.push('the bundled pack never answered a sources query')
        const blocks = await cdp
          .evaluate(`[...document.querySelectorAll('.modal .source-block')].map((block) => block.textContent.slice(0, 80))`)
          .catch(() => [])
        process.stdout.write(`${paint(90, `        .. ${JSON.stringify(blocks)}`)}\n`)
      }

      if (found) {
        await cdp.evaluate(`(() => {
          const row = [...document.querySelectorAll('.source-block .source-list__row')]
            .find((item) => (item.textContent ?? '').includes('Amazing Grace'))
          row?.querySelector('button')?.click()
        })()`)
        await cdp.waitFor(
          'the applied lyric to reach the dock',
          `(() => {
            const dock = document.querySelector('.lyricsdock')
            if (!dock || (dock.textContent ?? '').includes('Текста пока нет')) return false
            return !!dock.querySelector('.lyrics__plain p, .lyrics__lines .lyrics__line')
          })()`,
          10_000
        )
        process.stdout.write(`${paint(32, '  ok  ')} a bundled lyric can be applied to a track\n`)
      }
      await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await sleep(400)
    } catch (error) {
      failures.push(`the lyrics sources tab: ${error.message}`)
      process.stdout.write(`${paint(31, ' FAIL ')} the lyrics sources tab (${error.message})\n`)
    }

    /* The archive.org round trip needs the network, so this asserts the UI
     * settles one way or the other (results or a clear empty state) rather than
     * spinning on a skeleton forever. */
    try {
      await cdp.evaluate(`(() => {
        const items = [...document.querySelectorAll('.navitem')]
        items.find((i) => (i.textContent ?? '').includes('Поиск'))?.click()
      })()`)
      await sleep(400)
      await cdp.evaluate(`(() => {
        const input = document.querySelector('.searchbar__input')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, 'jazz')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()`)
      await cdp.waitFor(
        'the archive search to settle',
        `!!document.querySelector('.results__count') || !!document.querySelector('.page--search .empty')`,
        30_000
      )
      const mode = await cdp.evaluate(
        `document.querySelector('.results__count') ? 'results' : 'empty'`
      )
      if (mode === 'results') {
        const rows = await cdp.evaluate(
          `document.querySelectorAll('.trackrow:not(.trackrow--skeleton)').length`
        )
        process.stdout.write(`${paint(32, '  ok  ')} archive search returned ${rows} rows\n`)
        if (rows === 0) failures.push('archive search rendered no rows')
      } else {
        const text = await cdp.evaluate(
          `document.querySelector('.page--search .empty')?.textContent ?? ''`
        )
        process.stdout.write(
          `${paint(33, ' note ')} archive search settled on an empty state: ${text.slice(0, 90)}\n`
        )
      }
    } catch (error) {
      failures.push(`archive search never settled: ${error.message}`)
      process.stdout.write(`${paint(31, ' FAIL ')} archive search never settled (${error.message})\n`)
    }

    /* End-to-end library write: take four search results through TrackMenu into
     * the playlist created above, so the mosaic and the playlist view get real
     * content to render. */
    try {
      await cdp.evaluate(`document.querySelector('.lyricsdock__close')?.click()`)
      await sleep(200)
      for (let row = 0; row < 4; row++) {
        const opens = [
          `(() => {
            const target = [...document.querySelectorAll('.trackrow')][${row}]
            target?.querySelector('.trackrow__actions button[title="Действия с треком"]')?.click()
          })()`,
          `[...document.querySelectorAll('.menu__item')]
            .find((item) => (item.textContent ?? '').includes('Добавить в плейлист'))?.click()`,
          `[...document.querySelectorAll('.modal .source-list__row button')]
            .find((button) => (button.textContent ?? '').trim() === 'Добавить')?.click()`
        ]
        for (const expression of opens) {
          await cdp.evaluate(expression)
          await sleep(260)
        }
      }
      await sleep(600)
      const count = await cdp.evaluate(`(() => {
        const items = [...document.querySelectorAll('.playlist-item')]
        const item = items.find((i) => (i.textContent ?? '').includes('Смоук-плейлист'))
        return Number(item?.querySelector('.playlist-item__count')?.textContent ?? 0)
      })()`)
      if (count >= 4) {
        process.stdout.write(`${paint(32, '  ok  ')} added ${count} tracks through the track menu\n`)
      } else {
        failures.push(`only ${count} of 4 tracks reached the playlist`)
        process.stdout.write(`${paint(31, ' FAIL ')} only ${count} of 4 tracks reached the playlist\n`)
      }
    } catch (error) {
      failures.push(`playlist write flow: ${error.message}`)
      process.stdout.write(`${paint(31, ' FAIL ')} playlist write flow (${error.message})\n`)
    }

    if (shotDir) {
      mkdirSync(shotDir, { recursive: true })
      const gotoNav = (label) => `(() => {
        const items = [...document.querySelectorAll('.navitem')]
        items.find((i) => (i.textContent ?? '').includes(${JSON.stringify(label)}))?.click()
      })()`
      const scrollTop = `document.querySelector('.app-main').scrollTop = 0`
      const scenes = [
        { name: '01-discover', setup: [gotoNav('Обзор'), scrollTop], settle: 900 },
        { name: '02-discover-shelves', setup: [`document.querySelector('.app-main').scrollTop = 620`], settle: 500 },
        {
          name: '03-search',
          setup: [
            gotoNav('Поиск'),
            scrollTop,
            `(() => {
              const input = document.querySelector('.searchbar__input')
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
              setter.call(input, 'jazz')
              input.dispatchEvent(new Event('input', { bubbles: true }))
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
            })()`
          ],
          settle: 3_500
        },
        { name: '04-library', setup: [gotoNav('Библиотека'), scrollTop], settle: 800 },
        { name: '05-playlists', setup: [gotoNav('Плейлисты'), scrollTop], settle: 700 },
        { name: '06-settings', setup: [gotoNav('Настройки'), scrollTop], settle: 700 },
        { name: '07-about', setup: [gotoNav('О программе'), scrollTop], settle: 700 },
        { name: '08-shortcuts', setup: [gotoNav('Сокращения'), scrollTop], settle: 700 },
        {
          name: '09-lyrics-panel',
          setup: [gotoNav('Обзор'), `document.querySelector('.playerbar__right .iconbtn[title^="Текст"]')?.click()`],
          settle: 900
        },
        {
          name: '10-queue',
          setup: [
            `document.querySelector('.lyricsdock__close')?.click()`,
            `document.querySelector('.playerbar__right .iconbtn[title^="Очередь"]')?.click()`
          ],
          settle: 900
        },
        {
          name: '11-now-playing',
          setup: [
            `document.querySelector('.playerbar__right .iconbtn[title^="Очередь"]')?.click()`,
            `document.querySelector('.playerbar__coverbtn')?.click()`
          ],
          settle: 1_200
        },
        {
          name: '12-library-with-history',
          setup: [
            `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
            gotoNav('Библиотека'),
            `(() => {
              const tab = [...document.querySelectorAll('.tabs__item')]
                .find((t) => (t.textContent ?? '').includes('Недавние'))
              tab?.click()
            })()`
          ],
          settle: 900
        },
        {
          name: '13-playlists-mosaic',
          setup: [gotoNav('Плейлисты'), scrollTop],
          settle: 900
        },
        {
          name: '14-playlist-view',
          setup: [
            `[...document.querySelectorAll('.playlist-item__main')]
              .find((b) => (b.textContent ?? '').includes('Смоук-плейлист'))?.click()`
          ],
          settle: 1_000
        },
        {
          name: '15-lyrics-workshop',
          setup: [
            gotoNav('Обзор'),
            `document.querySelector('.playerbar__right .iconbtn[title^="Текст"]')?.click()`,
            `(() => {
              const button = [...document.querySelectorAll('.lyricsdock button')]
                .find((b) => (b.getAttribute('title') ?? '').startsWith('Действия с текстом'))
              button?.click()
            })()`,
            `[...document.querySelectorAll('.menu__item')]
              .find((item) => (item.textContent ?? '').includes('Редактировать текст'))?.click()`
          ],
          settle: 1_000
        },
        {
          name: '16-lyrics-sources',
          setup: [
            `[...document.querySelectorAll('.modal .tabs__item')]
              .find((tab) => (tab.textContent ?? '').includes('Источники'))?.click()`,
            `(() => {
              const input = document.querySelector('.modal .searchbar--inline .input')
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
              setter.call(input, 'Danny Boy')
              input.dispatchEvent(new Event('input', { bubbles: true }))
            })()`,
            `document.querySelector('.modal .searchbar--inline .btn--primary')?.click()`
          ],
          settle: 2_500
        }
      ]

      for (const scene of scenes) {
        try {
          for (const step of scene.setup) await cdp.evaluate(step)
          await sleep(scene.settle)
          const png = await cdp.screenshot()
          writeFileSync(path.join(shotDir, `${scene.name}.png`), png)
          process.stdout.write(`${paint(36, ' shot ')} ${scene.name}.png\n`)
        } catch (error) {
          failures.push(`screenshot ${scene.name}: ${error.message}`)
        }
      }
    }

    /* Local import of the shape a music downloader leaves behind: not a single
     * tag in the file, the names only in the file name, and the cover as a
     * separate image beside the track — under either of the two conventions such
     * folders mix. Nothing above covers this path, and it is what makes a folder
     * of downloads usable. Run last, so the screenshots show the seed catalog. */
    try {
      mkdirSync(fixtureDir, { recursive: true })
      const fixtures = [
        // [file name, expected artist, expected title, expected cover file name]
        ['Aarne, BUSHIDO ZHO - SOS.flac', 'Aarne, BUSHIDO ZHO', 'SOS', 'Aarne, BUSHIDO ZHO - SOS.flac.cover.jpg'],
        ['Нервы - Батареи.flac', 'Нервы', 'Батареи', 'Нервы - Батареи.jpg'],
        // A dash inside the title must not be mistaken for a second separator.
        ['Mckyyy - Roi - Instrumental Slowed.m4a', 'Mckyyy', 'Roi - Instrumental Slowed', null],
        // Windows forbids "?" in a file name, so the downloader wrote "_".
        ['Locked23 - What Is 23_.flac', 'Locked23', 'What Is 23?', null]
      ]
      // The same song as the second fixture in a format the default priority
      // ranks lower. It must be reported, not added, and left on disk.
      const lowerFormat = 'Нервы - Батареи.m4a'

      for (const [name] of fixtures) writeFileSync(path.join(fixtureDir, name), 'not really audio')
      writeFileSync(path.join(fixtureDir, lowerFormat), 'not really audio')
      // The two conventions seen in the wild, neither of them embedded.
      writeFileSync(path.join(fixtureDir, fixtures[0][3]), 'cover')
      writeFileSync(path.join(fixtureDir, fixtures[1][3]), 'cover')

      const paths = [...fixtures.map(([name]) => path.join(fixtureDir, name)), path.join(fixtureDir, lowerFormat)]
      const result = await cdp.evaluate(`(async () => {
        /* kmedia://local/<base64url of the path>: decode it without Buffer. */
        const decode = (url) => {
          const raw = new URL(url).pathname.replace(/^\\/+/, '')
          const padded = raw.replace(/-/g, '+').replace(/_/g, '/')
          const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
          return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
        }
        const paths = ${JSON.stringify(paths)}
        const imported = await window.kolaars.local.importPaths(paths)
        const db = await window.kolaars.store.load()
        const rows = db.tracks
          .filter((track) => paths.includes(track.filePath))
          .map((track) => ({
            file: track.filePath,
            artist: track.artist,
            title: track.title,
            cover: track.artwork ? decode(track.artwork) : null
          }))
        return {
          imported: imported.tracks.length,
          failed: imported.failed.length,
          duplicates: imported.duplicates,
          rows
        }
      })()`)

      const byFile = new Map(result.rows.map((row) => [path.basename(row.file), row]))
      let derived = 0
      for (const [name, artist, title, cover] of fixtures) {
        const row = byFile.get(name)
        const coverName = row?.cover ? path.basename(row.cover) : null
        const ok = Boolean(row) && row.artist === artist && row.title === title && coverName === cover
        if (ok) derived++
        else {
          failures.push(
            `local import of ${name}: expected ${artist} / ${title} / ${cover ?? 'no cover'}, got ${
              row ? `${row.artist} / ${row.title} / ${coverName ?? 'no cover'}` : 'no track'
            }`
          )
        }
      }
      const ok = derived === fixtures.length && result.failed === 0
      process.stdout.write(
        `${ok ? paint(32, '  ok  ') : paint(31, ' FAIL ')} untagged downloads import with names and sidecar covers (${derived}/${fixtures.length})\n`
      )

      /* The lower-ranked copy of a song must lose to the one already imported. */
      const duplicate = result.duplicates?.[0]
      const keptName = duplicate ? path.basename(duplicate.kept) : null
      const skippedName = duplicate ? path.basename(duplicate.path) : null
      const deduped =
        result.imported === fixtures.length &&
        result.duplicates?.length === 1 &&
        skippedName === lowerFormat &&
        keptName === fixtures[1][0] &&
        !result.rows.some((row) => path.basename(row.file) === lowerFormat)
      process.stdout.write(
        `${deduped ? paint(32, '  ok  ') : paint(31, ' FAIL ')} a second format of the same song is reported, not added` +
          `${deduped ? '' : ` — imported ${result.imported}, duplicates ${JSON.stringify(result.duplicates)}`}\n`
      )
      if (!deduped) failures.push('duplicate formats were not collapsed on import')
    } catch (error) {
      failures.push(`local import of untagged downloads: ${error.message}`)
      process.stdout.write(`${paint(31, ' FAIL ')} local import of untagged downloads (${error.message})\n`)
    }

    /* Lyrics panel and the big screen, driven by *real* mouse presses. The
     * lyrics menu used to be closed by its own dismissal listener before a real
     * click could land, the dock's close button sat exactly on top of the menu
     * button, and picking a line scrolled the list to the wrong place. A
     * programmatic `element.click()` sees none of that. */
    try {
      const report = (ok, label, detail = '') => {
        process.stdout.write(
          `${ok ? paint(32, '  ok  ') : paint(31, ' FAIL ')} ${label}${ok || !detail ? '' : ` — ${detail}`}\n`
        )
        if (!ok) failures.push(label)
      }
      const audioState = () =>
        cdp.evaluate(`(() => {
          const list = window.__probeAudios ?? []
          const element = list[list.length - 1]
          if (!element) return null
          const seekable = []
          for (let i = 0; i < element.seekable.length; i++) {
            seekable.push([+element.seekable.start(i).toFixed(1), +element.seekable.end(i).toFixed(1)])
          }
          return {
            duration: Number.isFinite(element.duration) ? +element.duration.toFixed(2) : null,
            currentTime: +element.currentTime.toFixed(2),
            readyState: element.readyState,
            error: element.error ? element.error.code : null,
            seekable
          }
        })()`)

      const wavName = 'Kolaars Karaoke - Smoke.wav'
      const wavPath = path.join(fixtureDir, wavName)
      writeFileSync(wavPath, makeWav(45))
      const imported = await cdp.evaluate(
        `window.kolaars.local.importPaths([${JSON.stringify(wavPath)}])`
      )
      const track = imported?.tracks?.[0] ?? null
      if (!track) throw new Error('the wav fixture did not import')
      await cdp.evaluate(
        `window.kolaars.lyrics.save(${JSON.stringify({
          trackId: track.id,
          plain: SMOKE_LINES.map((line) => line.text).join('\n'),
          synced: SMOKE_LINES,
          meta: {},
          origin: 'user',
          provider: null,
          language: null,
          updatedAt: Date.now()
        })})`
      )

      /* The player owns a detached `new Audio()`, so hook the constructor
       * before the reload: whether a `kmedia://` file can be seeked at all is
       * only visible on the element itself. */
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
          window.__probeAudios = []
          const Original = window.Audio
          window.Audio = function (...args) {
            const element = new Original(...args)
            window.__probeAudios.push(element)
            return element
          }
          window.Audio.prototype = Original.prototype
        })()`
      })

      await cdp.evaluate('location.reload()')
      await cdp.waitFor('the app shell after the reload', "!!document.querySelector('.navitem')", 25_000)
      await sleep(1_500)
      await cdp.evaluate(`(() => {
        const items = [...document.querySelectorAll('.navitem')]
        items.find((item) => (item.textContent ?? '').includes('Библиотека'))?.click()
      })()`)
      await sleep(900)
      const rowIndex = await cdp.evaluate(`(() => {
        const rows = [...document.querySelectorAll('.trackrow')]
        return rows.findIndex((row) => (row.textContent ?? '').includes('Kolaars Karaoke'))
      })()`)
      report(rowIndex >= 0, 'the playable import shows up in the library', `row ${rowIndex}`)
      if (rowIndex >= 0) {
        await cdp.evaluate(
          `document.querySelectorAll('.trackrow')[${rowIndex}].querySelector('.trackrow__titlebtn').click()`
        )
        await cdp.waitFor(
          'the wav to start playing',
          `document.querySelector('.playerbar__title')?.textContent?.trim() === 'Smoke'`,
          15_000
        )

        /* A `kmedia://` file used to be served as one opaque blob, so the
         * element reported it as non-seekable: the seek bar did nothing and
         * every jump (a lyric line, a saved position) started the track over. */
        await sleep(1_000)
        const seekableState = await audioState()
        report(
          (seekableState?.seekable?.length ?? 0) > 0 &&
            seekableState.seekable[0][1] >= (seekableState.duration ?? 0) - 0.5,
          'the whole local file is seekable',
          `seekable ${JSON.stringify(seekableState?.seekable)} of ${seekableState?.duration}s`
        )
        const askedFor = Math.max(0, (seekableState?.duration ?? 12) - 2.5)
        await cdp.evaluate(
          `(window.__probeAudios[window.__probeAudios.length - 1]).currentTime = ${askedFor}`
        )
        await sleep(400)
        const jumped = await audioState()
        report(
          Math.abs((jumped?.currentTime ?? -99) - askedFor) <= 0.7,
          'a seek inside the local file lands where it was asked to',
          `currentTime ${jumped?.currentTime}, asked ${askedFor}`
        )
        await cdp.evaluate(`(window.__probeAudios[window.__probeAudios.length - 1]).currentTime = 0`)
        await sleep(400)
        const rewound = await audioState()
        report(
          (rewound?.currentTime ?? 99) < 1,
          'the local file rewinds for the lyrics checks',
          `currentTime ${rewound?.currentTime}`
        )
        /* Pause here: the lyric panel is a moving target while the track plays,
         * and a real press must land on the line that was measured. Seeking
         * still works while paused, which is exactly what this check exercises. */
        await cdp.evaluate(`(window.__probeAudios[window.__probeAudios.length - 1]).pause()`)
        await sleep(300)

        await cdp.evaluate(`(() => {
          const button = [...document.querySelectorAll('.playerbar button')]
            .find((item) => (item.getAttribute('title') ?? '').startsWith('Текст'))
          button?.click()
        })()`)
        await cdp.waitFor(
          'the docked lyrics',
          "document.querySelectorAll('.lyrics--panel .lyrics__line').length > 0",
          10_000
        )
        await sleep(1_200)

        /* An occluded window drops synthetic mouse events: the hit test still
         * finds the line, but no pointerdown/click is dispatched at all. */
        await activateWindow()

        /* Picking a line: hover the panel first (that is what pauses the
         * auto-scroll), then measure and press the line. */
        const container = await cdp.box('.lyrics--panel .lyrics__scroll')
        await cdp.hover(container.x, container.y)
        await sleep(250)
        /* A centring scroll may already be in flight (smooth scrolling keeps
         * moving the text after the pointer arrives). Snap it to its current
         * offset and switch the container to instant scrolling, so the line
         * measured below is the line that the press actually hits. */
        await cdp.evaluate(`(() => {
          const box = document.querySelector('.lyrics--panel .lyrics__scroll')
          if (!box) return
          box.style.scrollBehavior = 'auto'
          box.scrollTop = box.scrollTop
        })()`)
        await sleep(150)
        const aimed = await cdp.evaluate(`(() => {
          const container = document.querySelector('.lyrics--panel .lyrics__scroll')
          const box = container.getBoundingClientRect()
          const lines = [...document.querySelectorAll('.lyrics--panel .lyrics__line')]
          const active = lines.findIndex((line) => line.className.includes('--active'))
          const inside = lines
            .map((element, index) => ({ index, rect: element.getBoundingClientRect() }))
            .filter(({ rect }) => rect.top >= box.top + 4 && rect.bottom <= box.bottom - 4)
          const pick = inside.find(({ index }) => index >= active + 4) ?? inside[inside.length - 1]
          if (!pick) return null
          const x = Math.round(pick.rect.left + pick.rect.width / 2)
          const y = Math.round(pick.rect.top + pick.rect.height / 2)
          const hit = document.elementFromPoint(x, y)
          return {
            index: pick.index,
            active,
            playerTime: document.querySelector('.playerbar__time')?.textContent ?? null,
            x,
            y,
            hit: hit ? hit.tagName + '.' + hit.className : null,
            hitText: hit?.textContent?.trim().slice(0, 40) ?? null,
            focus: document.hasFocus(),
            visibility: document.visibilityState
          }
        })()`)
        if (!aimed) throw new Error('no visible lyric line to aim at')
        if (!aimed.hit?.includes('lyrics__line')) {
          throw new Error(`the aimed point is not a lyric line (${aimed.hit})`)
        }
        const audioBeforePress = await audioState()
        await pressLikeUser(aimed.x, aimed.y)
        await sleep(500)
        const picked = await cdp.evaluate(`(() => {
          const container = document.querySelector('.lyrics--panel .lyrics__scroll')
          const box = container.getBoundingClientRect()
          const lines = [...document.querySelectorAll('.lyrics--panel .lyrics__line')]
          const rect = lines[${aimed.index}].getBoundingClientRect()
          return {
            active: lines.findIndex((line) => line.className.includes('--active')),
            playerTime: document.querySelector('.playerbar__time')?.textContent ?? null,
            eyebrow: document.querySelector('.lyrics--panel .lyrics__eyebrow')?.textContent ?? null,
            inView: rect.top >= box.top - 2 && rect.bottom <= box.bottom + 2,
            centre: Math.round(rect.top + rect.height / 2 - box.top),
            viewCentre: Math.round(box.height / 2),
            scrollTop: Math.round(container.scrollTop)
          }
        })()`)
        report(
          Math.abs(picked.active - aimed.index) <= 1,
          'pressing a lyric line seeks to that line',
          `aimed ${aimed.index} (active ${aimed.active}, time ${aimed.playerTime}, hit ${aimed.hit} ${JSON.stringify(aimed.hitText)}, focus ${aimed.focus}, ${aimed.visibility}), active ${picked.active} (time ${picked.playerTime}), ${picked.eyebrow}`
        )
        const audioAfterPress = await audioState()
        report(
          Math.abs((audioAfterPress?.currentTime ?? -99) - SMOKE_LINES[aimed.index].time) <= 1.3,
          'pressing a lyric line moves playback to that line',
          `audio ${audioAfterPress?.currentTime}s (was ${audioBeforePress?.currentTime}s), line at ${SMOKE_LINES[aimed.index].time}s`
        )
        report(
          picked.inView,
          'the picked lyric line stays in view',
          `line centre ${picked.centre}px of ${picked.viewCentre}px, scrollTop ${picked.scrollTop}`
        )
        /* Resume for the big-screen checks: the grain animation is expected to
         * run while the player is playing. */
        await cdp.evaluate(`(window.__probeAudios[window.__probeAudios.length - 1]).play()`)
        await sleep(200)

        /* The lyrics menu, pressed for real. */
        const pressMenu = async (label) => {
          const found = await cdp.evaluate(`(() => {
            const item = [...document.querySelectorAll('.menu__item')]
              .find((node) => (node.textContent ?? '').includes(${JSON.stringify(label)}))
            if (!item) return null
            const rect = item.getBoundingClientRect()
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          })()`)
          if (!found) throw new Error(`no menu item "${label}"`)
          await pressLikeUser(found.x, found.y)
          await sleep(500)
        }
        const openLyricsMenu = async () => {
          const info = await cdp.evaluate(`(() => {
            const el = document.querySelector('.lyrics--panel .lyrics__head .iconbtn')
            if (!el) return null
            const rect = el.getBoundingClientRect()
            const x = Math.round(rect.left + rect.width / 2)
            const y = Math.round(rect.top + rect.height / 2)
            const hit = document.elementFromPoint(x, y)
            return {
              x,
              y,
              expanded: el.getAttribute('aria-expanded'),
              hit: hit ? hit.tagName + '.' + hit.className : null,
              hitText: hit?.textContent?.trim().slice(0, 40) ?? null
            }
          })()`)
          if (!info) throw new Error('no lyrics menu trigger')
          await pressLikeUser(info.x, info.y)
          await sleep(450)
          const menu = await cdp.evaluate(
            `[...document.querySelectorAll('.menu__item')].map((item) => item.textContent.trim())`
          )
          const expandedAfter = await cdp.evaluate(
            `document.querySelector('.lyrics--panel .lyrics__head .iconbtn')?.getAttribute('aria-expanded') ?? null`
          )
          return { ...info, menu, expandedAfter }
        }
        const menu = await openLyricsMenu()
        report(
          menu.menu.length > 0,
          'the lyrics menu opens under a real press',
          `${menu.menu.length} items ${JSON.stringify({ ...menu, menu: undefined })}`
        )

        await pressMenu('Редактировать текст')
        /* Lyrics are loaded per track, so the editor can be opened before they
         * arrive — a menu click right after a track change does exactly that.
         * It has to fill itself in once they do: an empty draft used to be
         * saved straight over the text the track already had. */
        let workshop = { open: false, lines: 0 }
        for (let attempt = 0; attempt < 24; attempt++) {
          workshop = await cdp.evaluate(`(() => {
            const area = document.querySelector('.modal__body textarea')
            return { open: !!document.querySelector('.modal'), lines: area?.value.split('\\n').length ?? 0 }
          })()`)
          if (workshop.lines === SMOKE_LINES.length) break
          await sleep(150)
        }
        report(
          workshop.open && workshop.lines === SMOKE_LINES.length,
          'the editor opens with the saved text',
          `${workshop.lines} lines`
        )
        await cdp.evaluate(`(() => {
          const area = document.querySelector('.modal__body textarea')
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
          setter.call(area, area.value + '\\nСтрока, добавленная проверкой')
          area.dispatchEvent(new Event('input', { bubbles: true }))
        })()`)
        await sleep(250)
        const saveButton = await cdp.evaluate(`(() => {
          const button = [...document.querySelectorAll('.modal button')]
            .find((node) => (node.textContent ?? '').includes('Сохранить'))
          if (!button) return null
          const rect = button.getBoundingClientRect()
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        })()`)
        if (saveButton) await pressLikeUser(saveButton.x, saveButton.y)
        await sleep(800)
        const edited = await cdp.evaluate(
          `window.kolaars.lyrics.get(${JSON.stringify({ id: track.id, title: track.title, artist: track.artist })})`
        )
        report(
          String(edited?.saved?.plain ?? '').includes('Строка, добавленная проверкой'),
          'editing the text saves the new wording'
        )
        report(
          edited?.saved?.synced?.length === SMOKE_LINES.length,
          'editing the text keeps the karaoke timings',
          `${edited?.saved?.synced?.length ?? 0} of ${SMOKE_LINES.length}`
        )

        await openLyricsMenu()
        await pressMenu('Удалить пользовательский текст')
        const deleted = await cdp.evaluate(
          `window.kolaars.lyrics.get(${JSON.stringify({ id: track.id, title: track.title, artist: track.artist })})`
        )
        report(deleted?.saved === null, 'deleting the user text removes it', JSON.stringify(deleted?.saved))

        /* The big screen: a seek bar worth the whole width and grain on the art. */
        await cdp.evaluate(`document.querySelector('.playerbar__coverbtn')?.click()`)
        await cdp.waitFor('the now playing screen', "!!document.querySelector('.nowplaying')", 10_000)
        await sleep(900)
        const screen = await cdp.evaluate(`(() => {
          const bar = document.querySelector('.seekbar--lg')
          const grain = document.querySelector('.nowplaying__grain')
          const wrap = document.querySelector('.nowplaying__artwrap')
          const size = (element) =>
            element
              ? { w: Math.round(element.getBoundingClientRect().width), h: Math.round(element.getBoundingClientRect().height) }
              : null
          return {
            window: window.innerWidth,
            bar: size(bar),
            grain: size(grain),
            grainUnderArt: Boolean(wrap && grain && wrap.contains(grain)),
            blend: grain ? getComputedStyle(grain).mixBlendMode : null
          }
        })()`)
        const share = screen.bar ? screen.bar.w / screen.window : 0
        report(
          share >= 0.6,
          'the big screen seek bar spans the window',
          `${screen.bar?.w ?? 0}px of ${screen.window}px`
        )
        report(
          Boolean(screen.grain?.w) && screen.grainUnderArt && screen.blend !== 'normal',
          'grain lies over the big screen artwork',
          JSON.stringify(screen)
        )
        const flickers = await cdp.evaluate(`(async () => {
          const canvas = document.querySelector('.nowplaying__grain')
          if (!canvas) return false
          const first = canvas.toDataURL()
          await new Promise((resolve) => setTimeout(resolve, 300))
          return canvas.toDataURL() !== first
        })()`)
        report(Boolean(flickers), 'the grain animates')
        if (shotDir) {
          mkdirSync(shotDir, { recursive: true })
          const art = await cdp.box('.nowplaying__artwrap')
          const zoom = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            clip: { x: art.x - art.w / 2, y: art.y - art.h / 2, width: art.w, height: art.h, scale: 2 }
          })
          writeFileSync(path.join(shotDir, '10-grain-zoom.png'), Buffer.from(zoom.data, 'base64'))
        }
        await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
        await sleep(400)
      }
    } catch (error) {
      failures.push(`lyrics panel and big screen: ${error.message}`)
      process.stdout.write(
        `${paint(31, ' FAIL ')} lyrics panel and big screen (${error.message})\n`
      )
    }
  } catch (error) {
    failures.push(error.message)
    process.stdout.write(`${paint(31, ' FAIL ')} ${error.message}\n`)
  }

  const log = output.join('').trim()
  if (log) {
    process.stdout.write(`\n--- electron output ---\n${log}\n`)
  }

  if (failures.length > 0) {
    process.stdout.write(`\n${paint(31, `${failures.length} problem(s):`)}\n`)
    for (const failure of failures) process.stdout.write(`  - ${failure}\n`)
    await finish(1)
  } else {
    process.stdout.write(`\n${paint(32, 'smoke test passed')}\n`)
    await finish(0)
  }
}

void main()
