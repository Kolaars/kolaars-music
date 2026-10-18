#!/usr/bin/env node
/**
 * Unit checks for sidecar cover art lookup.
 *
 * `src/main/sidecarCover.ts` only touches the filesystem, so it is compiled on
 * its own with the project's own `tsc` and exercised against real fixture
 * directories in a temp folder. The fixtures cover the naming conventions that
 * music downloaders actually produce, including the two the user's library
 * mixes.
 *
 * Usage: npm run test:covers
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = path.join(root, 'src', 'main', 'sidecarCover.ts')

/* ---------------------------------------------------------------- */
/* Compile the module under test                                     */
/* ---------------------------------------------------------------- */

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) {
  console.error('typescript is not installed — run `npm install` first')
  process.exit(1)
}

const outDir = mkdtempSync(path.join(os.tmpdir(), 'kolaars-covers-'))
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

const { findSidecarCover } = await import(pathToFileURL(path.join(outDir, 'sidecarCover.js')).href)

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
/* Fixtures                                                          */
/* ---------------------------------------------------------------- */

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'kolaars-sidecar-'))
let scene = 0

/** Makes a throwaway folder containing `names`, each a non-empty file. */
function folder(...names) {
  const dir = path.join(fixtureRoot, `case-${++scene}`)
  mkdirSync(dir, { recursive: true })
  for (const name of names) {
    if (name.endsWith('/')) {
      mkdirSync(path.join(dir, name.slice(0, -1)), { recursive: true })
      continue
    }
    writeFileSync(path.join(dir, name), Buffer.from('x'))
  }
  return dir
}

/** Creates a zero-byte file where `folder()` would have written content. */
function touchEmpty(dir, name) {
  writeFileSync(path.join(dir, name), Buffer.alloc(0))
}

const only = (dir) => path.basename(dir) // the returned path's last segment
const found = async (dir, audio) => {
  const hit = await findSidecarCover(path.join(dir, audio))
  return hit === null ? null : path.basename(hit)
}

/* ---------------------------------------------------------------- */

group('the convention a downloader writes')
{
  const dir = folder('Song.flac', 'Song.flac.cover.jpg')
  check((await found(dir, 'Song.flac')) === 'Song.flac.cover.jpg', 'Song.flac.cover.jpg is picked up')

  const m4a = folder('Track.m4a', 'Track.m4a.cover.jpg')
  check((await found(m4a, 'Track.m4a')) === 'Track.m4a.cover.jpg', 'the same suffix works for .m4a')
}

group('the plain base name')
{
  const dir = folder('Song.flac', 'Song.jpg')
  check((await found(dir, 'Song.flac')) === 'Song.jpg', 'Song.jpg is picked up')

  const cyrillic = folder('Нервы - Батареи.flac', 'Нервы - Батареи.jpg')
  check(
    (await found(cyrillic, 'Нервы - Батареи.flac')) === 'Нервы - Батареи.jpg',
    'cyrillic names and spaces survive the round trip'
  )
}

group('a folder that mixes both conventions')
{
  const dir = folder('A - One.flac', 'A - One.flac.cover.jpg', 'B - Two.flac', 'B - Two.jpg')
  check((await found(dir, 'A - One.flac')) === 'A - One.flac.cover.jpg', 'track A gets the suffixed cover')
  check((await found(dir, 'B - Two.flac')) === 'B - Two.jpg', 'track B gets the base-name cover')
}

group('which one wins when several exist')
{
  const dir = folder('Song.flac', 'Song.flac.cover.jpg', 'Song.jpg', 'cover.jpg', 'folder.jpg')
  check(
    (await found(dir, 'Song.flac')) === 'Song.flac.cover.jpg',
    'the audio file name plus a suffix beats everything else'
  )

  const viaExtension = folder('Song.flac', 'Song.flac.jpg', 'Song.jpg')
  check((await found(viaExtension, 'Song.flac')) === 'Song.flac.jpg', 'the audio file name beats the base name')

  const baseFirst = folder('Song.flac', 'Song.jpg', 'cover.jpg')
  check((await found(baseFirst, 'Song.flac')) === 'Song.jpg', 'the base name beats a folder-level cover')
}

group('cover suffixes on the base name')
{
  const dotted = folder('Song.flac', 'Song.cover.png')
  check((await found(dotted, 'Song.flac')) === 'Song.cover.png', 'Song.cover.png is recognised')

  const dashed = folder('Song.flac', 'Song-cover.jpg')
  check((await found(dashed, 'Song.flac')) === 'Song-cover.jpg', 'Song-cover.jpg is recognised')
}

group('folder-level fallback')
{
  const cover = folder('Song.flac', 'cover.jpg')
  check((await found(cover, 'Song.flac')) === 'cover.jpg', 'cover.jpg is used when nothing else matches')

  const albumFolder = folder('Song.flac', 'folder.jpg')
  check((await found(albumFolder, 'Song.flac')) === 'folder.jpg', 'folder.jpg is used the same way')

  const png = folder('Song.flac', 'cover.png')
  check((await found(png, 'Song.flac')) === 'cover.png', 'the folder fallback accepts other image types')
}

group('image extensions')
{
  for (const extension of ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']) {
    const dir = folder('Song.flac', `Song${extension}`)
    check((await found(dir, 'Song.flac')) === `Song${extension}`, `${extension} is recognised`)
  }
}

group('case-insensitive lookup, real casing returned')
{
  const dir = folder('Song.flac', 'SONG.JPG')
  check((await found(dir, 'Song.flac')) === 'SONG.JPG', 'an upper-case cover is found and returned as spelled')

  const mixed = folder('Song.flac', 'Song.Cover.JpG')
  check((await found(mixed, 'Song.flac')) === 'Song.Cover.JpG', 'mixed casing works too')
}

group('things that are not cover art')
{
  const none = folder('Song.flac')
  check((await found(none, 'Song.flac')) === null, 'a folder with no image returns null')

  const directory = folder('Song.flac', 'Song.jpg/')
  check((await found(directory, 'Song.flac')) === null, 'a directory named Song.jpg is not a cover')

  const emptyDir = folder('Song.flac')
  touchEmpty(emptyDir, 'Song.jpg')
  check((await found(emptyDir, 'Song.flac')) === null, 'an empty file is not a cover')

  const nearMisses = folder('Song.flac', 'Song 2.jpg', 'Song.flac2.jpg', 'Songbook.jpg')
  check((await found(nearMisses, 'Song.flac')) === null, 'a similar but different name is never matched')

  const missingDir = path.join(fixtureRoot, 'does-not-exist')
  check(
    (await findSidecarCover(path.join(missingDir, 'Song.flac'))) === null,
    'an unreadable directory returns null instead of throwing'
  )
}

group('awkward but real shapes')
{
  const noExtension = folder('Song', 'Song.jpg')
  check((await found(noExtension, 'Song')) === 'Song.jpg', 'an audio file with no extension still matches')

  const dotted = folder('Artist - 2007 год.flac', 'Artist - 2007 год.flac.cover.jpg')
  check((await found(dotted, 'Artist - 2007 год.flac')) === 'Artist - 2007 год.flac.cover.jpg', 'dots and spaces in the name')

  const manyDots = folder('a.b.c - Title.flac', 'a.b.c - Title.jpg')
  check((await found(manyDots, 'a.b.c - Title.flac')) === 'a.b.c - Title.jpg', 'a name with several dots')
}

group('a whole folder of tracks')
{
  const names = [
    '!aesly - A kiss goodbye.flac',
    '1NZZiDENT - i dont know.flac',
    '55x55 - 2007 год.flac',
    'ANIKV, SALUKI - Огни.m4a',
    'Нервы - Батареи.flac'
  ]
  const dir = path.join(fixtureRoot, 'case-many')
  mkdirSync(dir, { recursive: true })
  for (const [index, name] of names.entries()) {
    writeFileSync(path.join(dir, name), Buffer.from('x'))
    // Every other track uses the suffixed convention, the rest the base name.
    const cover = index % 2 === 0 ? `${name}.cover.jpg` : `${name.replace(/\.[^.]+$/, '')}.jpg`
    writeFileSync(path.join(dir, cover), Buffer.from('x'))
  }

  let resolved = 0
  for (const [index, name] of names.entries()) {
    const expected = index % 2 === 0 ? `${name}.cover.jpg` : `${name.replace(/\.[^.]+$/, '')}.jpg`
    if ((await found(dir, name)) === expected) resolved++
  }
  check(resolved === names.length, 'every track in a mixed folder gets its own cover', `${resolved}/${names.length}`)
  check(only(dir) === 'case-many', 'the fixture folder is the one we built')
}

/* ---------------------------------------------------------------- */

rmSync(fixtureRoot, { recursive: true, force: true })
rmSync(outDir, { recursive: true, force: true })

console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} cover checks passed`)
process.exit(failed ? 1 : 0)
