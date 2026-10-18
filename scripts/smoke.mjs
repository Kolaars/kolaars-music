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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const paint = (color, text) => `\u001b[${color}m${text}\u001b[0m`

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
  },
  {
    name: 'the lyrics workshop lists the bundled public-domain pack',
    steps: [
      `document.querySelector('.lyricsdock__close')?.click()`,
      `document.querySelector('.playerbar__right .iconbtn[title^="Текст"]')?.click()`,
      `document.querySelector('.lyricsdock button[title^="Действия с текстом"]')?.click()`,
      `[...document.querySelectorAll('.menu__item')]
        .find((item) => (item.textContent ?? '').includes('Найти в открытых базах'))?.click()`,
      `(() => {
        const input = document.querySelector('.modal .searchbar--inline .input')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, 'Amazing Grace')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })()`,
      `document.querySelector('.modal .searchbar--inline .btn--primary')?.click()`
    ],
    delay: 1_000,
    assert: `[...document.querySelectorAll('.source-block')].some((block) =>
      (block.textContent ?? '').includes('Amazing Grace'))`,
    assertName: 'the bundled pack returns a match'
  },
  {
    name: 'a bundled lyric can be applied and shows up in the panel',
    steps: [
      `(() => {
        const row = [...document.querySelectorAll('.source-block .source-list__row')]
          .find((item) => (item.textContent ?? '').includes('Amazing Grace'))
        row?.querySelector('button')?.click()
      })()`,
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
    ],
    delay: 900,
    assert: `(() => {
      const dock = document.querySelector('.lyricsdock')
      if (!dock) return false
      if ((dock.textContent ?? '').includes('Текста пока нет')) return false
      return !!dock.querySelector('.lyrics__plain p, .lyrics__lines .lyrics__line')
    })()`,
    assertName: 'the lyrics dock renders the saved text'
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
      } catch {
        /* ignore */
      }
    }
    process.exit(code)
  }

  try {
    const target = await findTarget()
    cdp = await connect(target.webSocketDebuggerUrl)

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
