#!/usr/bin/env node
/**
 * Unit checks for the `Range` handling behind `kmedia://`.
 *
 * Getting this wrong is invisible in code review and fatal in use: a stream
 * without ranges is reported as non-seekable by the media element, so the seek
 * bar goes dead and clicking a lyric line restarts the track. The parser is
 * compiled on its own with the project's `tsc` and checked against the shapes a
 * real Chrome/Electron media stack asks for.
 *
 * Usage: npm run test:range
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = path.join(root, 'src', 'main', 'byteRange.ts')

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) {
  console.error('typescript is not installed — run `npm install` first')
  process.exit(1)
}

const outDir = mkdtempSync(path.join(os.tmpdir(), 'kolaars-range-'))
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

const { parseByteRange, contentTypeFor } = await import(
  pathToFileURL(path.join(outDir, 'byteRange.js')).href
)

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

const MB = 1024 * 1024
const range = (header, size, expected) => {
  const got = parseByteRange(header, size)
  const actual = got ? `${got.start}-${got.end}` : 'null'
  const want = expected ? `${expected.start}-${expected.end}` : 'null'
  check(actual === want, `${JSON.stringify(header)} on ${size} → ${want}`, actual === want ? '' : `got ${actual}`)
}

group('what the media element actually asks for')
{
  range('bytes=0-', 100 * MB, { start: 0, end: 100 * MB - 1 })
  range('bytes=0-1048575', 100 * MB, { start: 0, end: 1048575 })
  range('bytes=1048576-', 100 * MB, { start: 1048576, end: 100 * MB - 1 })
  range('bytes=52428800-53477375', 100 * MB, { start: 52428800, end: 53477375 })
  range('Bytes=0-99', 1000, { start: 0, end: 99 })
}

group('clamping and the open ends')
{
  range('bytes=500-99999', 1000, { start: 500, end: 999 })
  range('bytes=999-999', 1000, { start: 999, end: 999 })
  range('bytes=-200', 1000, { start: 800, end: 999 })
  range('bytes=-5000', 1000, { start: 0, end: 999 })
  range('bytes=999-100', 1000, null)
}

group('what gets the whole file instead')
{
  range(null, 1000, null)
  range(undefined, 1000, null)
  range('', 1000, null)
  range('bytes=', 1000, null)
  range('bytes=-', 1000, null)
  range('bytes=-0', 1000, null)
  range('bytes=abc', 1000, null)
  range('items=0-10', 1000, null)
  range('bytes=0-99,200-299', 1000, null)
  range('bytes=1000-', 1000, null)
  range('bytes=2000-3000', 1000, null)
  range('bytes=0-', 0, null)
}

group('a phone-sized file is not a problem')
{
  range('bytes=0-', 3, { start: 0, end: 2 })
  range('bytes=1-', 3, { start: 1, end: 2 })
  range('bytes=-1', 3, { start: 2, end: 2 })
}

group('content types')
{
  check(contentTypeFor('C:\\Music\\Song.flac') === 'audio/flac', '.flac is audio/flac')
  check(contentTypeFor('C:\\Music\\Song.M4A') === 'audio/mp4', '.M4A is audio/mp4, case-insensitively')
  check(contentTypeFor('C:\\Music\\Song.mp3') === 'audio/mpeg', '.mp3 is audio/mpeg')
  check(contentTypeFor('/tmp/a.wav') === 'audio/wav', '.wav is audio/wav')
  check(contentTypeFor('C:\\Music\\Song.flac.cover.jpg') === 'image/jpeg', 'a sidecar cover is an image')
  check(contentTypeFor('C:\\Music\\Cover.PNG') === 'image/png', '.PNG is an image')
  check(contentTypeFor('C:\\Music\\Song') === 'application/octet-stream', 'no extension falls back')
  check(contentTypeFor('C:\\Music\\Song.xyz') === 'application/octet-stream', 'an unknown extension falls back')
}

rmSync(outDir, { recursive: true, force: true })

console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} range checks passed`)
process.exit(failed ? 1 : 0)
