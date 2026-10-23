#!/usr/bin/env node
/**
 * Unit checks for the Discord presence snapshot.
 *
 * The important rule is legal, not cosmetic: only open Internet Archive tracks
 * with a direct public file may expose a "download" button. External players
 * must fall back to their public page, and local files must have no button.
 *
 * Usage: npm run test:discord
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const presenceSource = path.join(root, 'src', 'shared', 'discordPresence.ts')
const defaultsSource = path.join(root, 'src', 'shared', 'defaults.ts')

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) {
  console.error('typescript is not installed — run `npm install` first')
  process.exit(1)
}

const outDir = mkdtempSync(path.join(os.tmpdir(), 'kolaars-discord-'))
const compiled = spawnSync(
  process.execPath,
  [
    tsc,
    presenceSource,
    defaultsSource,
    '--outDir',
    outDir,
    '--module',
    'commonjs',
    '--target',
    'es2022',
    '--moduleResolution',
    'node',
    '--skipLibCheck',
    '--strict'
  ],
  { cwd: root, encoding: 'utf8' }
)

if (compiled.status !== 0) {
  console.error(compiled.stdout ?? '')
  console.error(compiled.stderr ?? '')
  rmSync(outDir, { recursive: true, force: true })
  process.exit(1)
}

const require = createRequire(import.meta.url)
const {
  buildDiscordPresence,
  buildDiscordButtons,
  APP_DOWNLOAD_URL
} = require(path.join(outDir, 'discordPresence.js'))
const { DEFAULT_SETTINGS } = require(path.join(outDir, 'defaults.js'))

let failed = 0
let passed = 0

function check(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed++
  else failed++
  console.log(
    `${ok ? '  ok  ' : ' FAIL '} ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`
  )
}

function group(title) {
  console.log(`\n${title}`)
}

function track(overrides) {
  return {
    id: 'arc:item',
    title: 'Track',
    artist: 'Artist',
    album: null,
    artwork: null,
    source: 'online',
    streamUrl: 'https://archive.org/download/item/file.mp3',
    sourceUrl: 'https://archive.org/details/item',
    external: null,
    ...overrides
  }
}

const playback = { position: 12, duration: 120, playing: true }

group('defaults')
{
  check(DEFAULT_SETTINGS.discordRpc, false, 'Rich Presence stays opt-in')
  check(
    DEFAULT_SETTINGS.discordRpcClientId,
    '1563179865014804490',
    'the official Discord application ID is built in'
  )
  check(
    /^\d{17,20}$/.test(DEFAULT_SETTINGS.discordRpcClientId),
    true,
    'the built-in ID has the shape Discord accepts'
  )
}

group('open archive tracks')
{
  const presence = buildDiscordPresence(track({}), playback)
  check(presence.downloadUrl, 'https://archive.org/download/item/file.mp3', 'online track gets a direct download URL')
  check(presence.sourceUrl, 'https://archive.org/details/item', 'the item page stays available as a source')
  check(presence.provider, null, 'Internet Archive is the app default, so no provider suffix is needed')
  check(presence.position, 12, 'position is carried over')
  check(presence.playing, true, 'playback state is carried over')
}
{
  const presence = buildDiscordPresence(
    track({ source: 'seed', artist: 'Seed artist', album: 'Seed album' }),
    playback
  )
  check(presence.downloadUrl, 'https://archive.org/download/item/file.mp3', 'bundled seed tracks can be downloaded')
  check(presence.album, 'Seed album', 'album is carried over')
}

group('external official players')
{
  const presence = buildDiscordPresence(
    track({
      source: 'external',
      streamUrl: '',
      sourceUrl: null,
      external: {
        provider: 'youtube',
        id: 'abc 123',
        pageUrl: 'https://www.youtube.com/watch?v=abc%20123',
        embeddable: true
      }
    }),
    playback
  )
  check(presence.downloadUrl, null, 'YouTube has no file URL to label as a download')
  check(
    presence.sourceUrl,
    'https://music.youtube.com/watch?v=abc%20123',
    'YouTube links open in YouTube Music'
  )
  check(presence.provider, 'YouTube Music', 'the provider has a human name')
}
{
  const presence = buildDiscordPresence(
    track({
      source: 'external',
      streamUrl: '',
      sourceUrl: null,
      external: {
        provider: 'soundcloud',
        id: '42',
        pageUrl: 'https://soundcloud.com/artist/track',
        embeddable: true
      }
    }),
    playback
  )
  check(presence.downloadUrl, null, 'SoundCloud has no file URL to label as a download')
  check(presence.sourceUrl, 'https://soundcloud.com/artist/track', 'SoundCloud keeps its public page')
  check(presence.provider, 'SoundCloud', 'SoundCloud has a human provider name')
}

group('local and metadata-only tracks')
{
  const presence = buildDiscordPresence(
    track({
      source: 'local',
      streamUrl: 'kmedia:///C:/Music/track.flac',
      sourceUrl: null,
      filePath: 'C:\\Music\\track.flac'
    }),
    playback
  )
  check(presence.downloadUrl, null, 'a local file has no public download URL')
  check(
    presence.sourceUrl,
    'https://music.youtube.com/search?q=Artist%20Track',
    'a local file falls back to a YouTube Music search'
  )
  check(presence.sourceLabel, 'Найти в YouTube Music', 'the fallback is labelled as a search, not a play link')
  check(presence.provider, 'Локальный файл', 'the local source is explained in the state line')
}
{
  const presence = buildDiscordPresence(
    track({
      source: 'local',
      artist: '  ',
      title: '',
      streamUrl: 'kmedia:///C:/Music/track.flac',
      sourceUrl: null
    }),
    playback
  )
  check(presence.sourceUrl, null, 'an empty artist and title produce no search button')
  check(presence.sourceLabel, null, 'no label without a search URL')
}
{
  const presence = buildDiscordPresence(
    track({ source: 'list', streamUrl: '', sourceUrl: 'https://example.com/song' }),
    playback
  )
  check(presence.downloadUrl, null, 'a list entry is not assumed to be downloadable')
  check(presence.sourceUrl, 'https://example.com/song', 'a public source page can still be shown')
}

group('URL filtering')
{
  const presence = buildDiscordPresence(
    track({ streamUrl: 'https://archive.org/download/item/file.mp3?x=1&y=2' }),
    playback
  )
  check(presence.downloadUrl, 'https://archive.org/download/item/file.mp3?x=1&y=2', 'query strings survive')
}
{
  const presence = buildDiscordPresence(
    track({ streamUrl: 'kmedia:///C:/Music/file.mp3' }),
    playback
  )
  check(presence.downloadUrl, null, 'a non-http stream is never a public download')
}
{
  const presence = buildDiscordPresence(
    track({ streamUrl: `https://archive.org/${'x'.repeat(520)}` }),
    playback
  )
  check(presence.downloadUrl, null, 'URLs longer than Discord accepts are dropped')
}

group('artwork')
{
  const presence = buildDiscordPresence(
    track({ artwork: 'https://archive.org/services/img/item' }),
    playback
  )
  check(
    presence.artworkUrl,
    'https://archive.org/services/img/item',
    'a public archive cover is passed to Discord'
  )
}
{
  const presence = buildDiscordPresence(
    track({
      source: 'external',
      artwork: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      external: {
        provider: 'youtube',
        id: 'abc123',
        pageUrl: 'https://www.youtube.com/watch?v=abc123',
        embeddable: true
      }
    }),
    playback
  )
  check(
    presence.artworkUrl,
    'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
    'YouTube thumbnails are public https images'
  )
}
{
  const presence = buildDiscordPresence(
    track({
      source: 'local',
      artwork: 'kmedia:///C:/Music/cover.jpg',
      streamUrl: 'kmedia:///C:/Music/track.flac'
    }),
    playback
  )
  check(presence.artworkUrl, null, 'a local cover path is not sent to Discord')
}
{
  const presence = buildDiscordPresence(
    track({ artwork: 'http://example.com/cover.jpg' }),
    playback
  )
  check(presence.artworkUrl, null, 'plain http artwork is dropped')
}
{
  const presence = buildDiscordPresence(
    track({ artwork: `https://example.com/${'x'.repeat(520)}.jpg` }),
    playback
  )
  check(presence.artworkUrl, null, 'artwork URLs longer than Discord accepts are dropped')
}

group('buttons')
{
  const presence = buildDiscordPresence(
    track({
      source: 'local',
      artist: 'whyspurky',
      title: 'Вещий',
      streamUrl: 'kmedia:///C:/Music/veshchiy.m4a',
      sourceUrl: null
    }),
    playback
  )
  check(
    buildDiscordButtons(presence),
    [
      {
        label: 'Найти в YouTube Music',
        url: 'https://music.youtube.com/search?q=whyspurky%20%D0%92%D0%B5%D1%89%D0%B8%D0%B9'
      },
      { label: 'Скачать Kolaars Music', url: APP_DOWNLOAD_URL }
    ],
    'a local track gets its search plus the app download link'
  )
}
{
  const presence = buildDiscordPresence(track({}), playback)
  check(
    buildDiscordButtons(presence),
    [
      { label: 'Скачать', url: 'https://archive.org/download/item/file.mp3' },
      { label: 'Источник', url: 'https://archive.org/details/item' }
    ],
    'an archive track keeps download + source and leaves no room for promotion'
  )
}
{
  const presence = buildDiscordPresence(
    track({
      source: 'external',
      streamUrl: '',
      sourceUrl: null,
      external: {
        provider: 'youtube',
        id: 'abc',
        pageUrl: 'https://www.youtube.com/watch?v=abc',
        embeddable: true
      }
    }),
    playback
  )
  check(
    buildDiscordButtons(presence),
    [
      { label: 'Открыть в YouTube Music', url: 'https://music.youtube.com/watch?v=abc' },
      { label: 'Скачать Kolaars Music', url: APP_DOWNLOAD_URL }
    ],
    'a YouTube track gets its page plus the app download link'
  )
}
{
  const buttons = buildDiscordButtons(
    buildDiscordPresence(track({ source: 'list', artwork: null }), playback)
  )
  check(buttons.length <= 2, true, 'Discord never receives more than two buttons')
}

group('paused playback')
{
  const presence = buildDiscordPresence(track({}), { position: 12, duration: 120, playing: false })
  check(presence.playing, false, 'paused state is carried over')
  check(presence.position, 12, 'the last position is still available')
}

console.log(`\n${passed} checks passed${failed ? `, ${failed} failed` : ''}`)
rmSync(outDir, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
