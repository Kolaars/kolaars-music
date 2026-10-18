#!/usr/bin/env node
/**
 * Unit checks for the track-list parser and playlist serialisers.
 *
 * `src/shared/tracklist.ts` is pure, dependency-free TypeScript, so it is
 * compiled on its own (with the project's own `tsc`) into a temp directory and
 * imported from there. That keeps the checks honest — they run the real module,
 * not a copy — and avoids depending on how Node's type stripping is enabled.
 *
 * Usage: npm run test:tracklist
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = path.join(root, 'src', 'shared', 'tracklist.ts')

/* ---------------------------------------------------------------- */
/* Compile the module under test                                     */
/* ---------------------------------------------------------------- */

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) {
  console.error('typescript is not installed — run `npm install` first')
  process.exit(1)
}

const outDir = mkdtempSync(path.join(os.tmpdir(), 'kolaars-tracklist-'))
const compiled = spawnSync(
  process.execPath,
  [
    tsc,
    source,
    '--outDir',
    outDir,
    '--module',
    'esnext',
    '--target',
    'es2022',
    '--moduleResolution',
    'bundler',
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

const {
  parseTrackList,
  normalizeForMatch,
  matchKey,
  serializePlaylist
} = await import(pathToFileURL(path.join(outDir, 'tracklist.js')).href)

/* ---------------------------------------------------------------- */
/* Tiny assertion harness                                            */
/* ---------------------------------------------------------------- */

let failed = 0
let passed = 0

function check(ok, name, detail = '') {
  if (ok) passed++
  else failed++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

function group(title) {
  console.log(`\n${title}`)
}

/* ---------------------------------------------------------------- */

group('plain text')
{
  const [emDash] = parseTrackList('Кино — Звезда по имени Солнце')
  check(
    emDash.artist === 'Кино' && emDash.title === 'Звезда по имени Солнце',
    'an em dash splits artist and title',
    JSON.stringify(emDash)
  )

  const [hyphen] = parseTrackList('Кино - Звезда по имени Солнце')
  check(hyphen.artist === 'Кино' && hyphen.title === 'Звезда по имени Солнце', 'a hyphen splits too')

  const [numbered] = parseTrackList('01. Кино - Звезда')
  check(numbered.artist === 'Кино' && numbered.title === 'Звезда', 'a leading track number is dropped', JSON.stringify(numbered))

  const [tabbed] = parseTrackList('Аквариум\tГород золотой')
  check(tabbed.artist === 'Аквариум' && tabbed.title === 'Город золотой', 'a tab splits artist and title')

  const [lonely] = parseTrackList('Просто название без исполнителя')
  check(lonely.artist === '' && lonely.title === 'Просто название без исполнителя', 'a bare title is kept as a title')

  const [multi] = parseTrackList('Кино - Песня - Ремикс 2024')
  check(multi.artist === 'Кино' && multi.title === 'Песня - Ремикс 2024', 'only the first separator splits')

  check(parseTrackList('\n\n  \nКино - Звезда\n').length === 1, 'blank lines are dropped')
  check(parseTrackList('# комментарий\nКино - Звезда').length === 1, 'comment lines are skipped')
  check(parseTrackList('').length === 0, 'empty input yields nothing')
}

group('csv')
{
  const rows = parseTrackList('artist,title\nКино,Звезда по имени Солнце\nАквариум,"Город, золотой"')
  check(rows.length === 2, 'the header row is not an entry', String(rows.length))
  check(rows[0].artist === 'Кино' && rows[0].title === 'Звезда по имени Солнце', 'columns follow the header')
  check(rows[1].title === 'Город, золотой', 'a quoted cell keeps its comma', JSON.stringify(rows[1]))

  const spotify = parseTrackList('Track name,Artist name\nЗвезда,Кино')
  check(spotify[0].artist === 'Кино' && spotify[0].title === 'Звезда', 'title-first exports still map correctly')

  const russian = parseTrackList('Название;Исполнитель\nЗвезда;Кино')
  check(russian[0].artist === 'Кино' && russian[0].title === 'Звезда', 'a semicolon + russian header works')

  const loose = parseTrackList('Кино - Звезда, часть 1\nАквариум - Город')
  check(loose.length === 2 && loose[0].title === 'Звезда, часть 1', 'without a header a comma is just text')
}

group('m3u')
{
  const lines = parseTrackList(
    [
      '#EXTM3U',
      '#EXTINF:214,Кино - Звезда по имени Солнце',
      'music/01 - Звезда.mp3',
      '#EXTINF:-1,Аквариум - Город золотой'
    ].join('\n')
  )
  check(lines.length === 3, 'extinf and bare paths both become entries', String(lines.length))
  check(lines[0].title === 'Звезда по имени Солнце', 'extinf entries keep the label')
  check(lines[1].artist === '' && lines[1].title === 'Звезда', 'a file path is reduced to its base name', JSON.stringify(lines[1]))
  check(lines[2].title === 'Город золотой', 'an extinf without a duration still parses')
}

group('matching')
{
  check(normalizeForMatch('Björk — Jóga!') === 'bjork joga', 'accents and punctuation are folded', normalizeForMatch('Björk — Jóga!'))
  check(normalizeForMatch('Звезда (Remastered 2011)') === 'звезда', 'bracketed suffixes are dropped')
  check(matchKey('Кино', 'Звезда') === matchKey('кино', 'звезда!'), 'keys ignore case and punctuation')
  check(matchKey('', 'Звезда') === '|звезда', 'a missing artist still keys on the title')
}

group('export')
{
  const tracks = [
    { artist: 'Кино', title: 'Звезда по имени Солнце', album: 'Группа крови', duration: 214 },
    { artist: 'Аквариум', title: 'Город, золотой', album: null, duration: 128 }
  ]

  const csv = serializePlaylist('csv', 'Тест', tracks)
  const csvBack = parseTrackList(csv)
  check(csvBack.length === 2, 'csv round-trips through our own parser', String(csvBack.length))
  check(csvBack[1].title === 'Город, золотой', 'csv round-trips a title containing a comma')

  const m3u = serializePlaylist('m3u8', 'Тест', tracks)
  check(m3u.startsWith('#EXTM3U'), 'm3u starts with the required header')
  check(parseTrackList(m3u).length === 2, 'm3u round-trips through our own parser')
  check(
    serializePlaylist('m3u8', 'Тест', [{ ...tracks[0], path: 'D:\\music\\01.mp3' }]).includes('D:\\music\\01.mp3'),
    'm3u writes a real path when the track has one'
  )
  check(
    serializePlaylist('m3u8', 'Тест', [tracks[0]]).includes('# Кино - Звезда по имени Солнце'),
    'm3u comments entries that have no file'
  )

  const json = JSON.parse(serializePlaylist('json', 'Тест', tracks))
  check(json.count === 2 && json.name === 'Тест', 'json carries the name and count')
  check(json.tracks[0].title === 'Звезда по имени Солнце', 'json carries the titles')

  // Nothing may smuggle a media location out of the profile.
  const everything = [csv, m3u, JSON.stringify(json)].join('\n')
  check(!everything.includes('kmedia://'), 'no export contains an internal media url')
  check(!everything.includes('archive.org'), 'no export contains a stream url')
}

/* ---------------------------------------------------------------- */

rmSync(outDir, { recursive: true, force: true })

console.log(
  failed
    ? `\n${failed} failed, ${passed} passed`
    : `\nall ${passed} tracklist checks passed`
)
process.exit(failed ? 1 : 0)
