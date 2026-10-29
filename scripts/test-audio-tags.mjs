#!/usr/bin/env node
/**
 * Checks the audio tag reader against real files.
 *
 * The module is pure TypeScript with no imports, so it is compiled on its own
 * with the project's `tsc` and imported from a temp directory — the same trick
 * `test-tracklist.mjs` uses. Fixtures are generated here, so the test needs no
 * binary assets in the repository.
 *
 * Usage: npm run test:tags
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = path.join(root, 'src', 'shared', 'audio-tags.ts')

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) {
  console.error('typescript is not installed — run `npm install` first')
  process.exit(1)
}

const outDir = mkdtempSync(path.join(os.tmpdir(), 'kolaars-tags-'))
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

const { readAudioMeta } = await import(pathToFileURL(path.join(outDir, 'audio-tags.js')).href)
const { findMoovStart } = await import(pathToFileURL(path.join(outDir, 'audio-tags.js')).href)
const { tagSpan } = await import(pathToFileURL(path.join(outDir, 'audio-tags.js')).href)

/* ---------------------------------------------------------------- */
/* Fixtures                                                          */
/* ---------------------------------------------------------------- */

function u32be(value) {
  return Buffer.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

function u32le(value) {
  return Buffer.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
}

function id3TextFrame(id, value) {
  const body = Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8'), Buffer.from([0])])
  return Buffer.concat([Buffer.from(id, 'ascii'), u32be(body.length), Buffer.from([0, 0]), body])
}

function id3v24Frame(id, body) {
  const size = body.length
  const syncsafe = Buffer.from([(size >>> 21) & 0x7f, (size >>> 14) & 0x7f, (size >>> 7) & 0x7f, size & 0x7f])
  return Buffer.concat([Buffer.from(id, 'ascii'), syncsafe, Buffer.from([0, 0]), body])
}

/** A 128 kbps, 44.1 kHz MPEG-1 Layer III frame header; the audio itself is junk. */
const mp3Frame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(413)])

function makeMp3() {
  const cover = Buffer.alloc(600, 0xab)
  const apic = Buffer.concat([
    Buffer.from([3]),
    Buffer.from('image/png\0', 'latin1'),
    Buffer.from([3]),
    Buffer.from('front\0', 'latin1'),
    cover
  ])
  const frames = Buffer.concat([
    id3TextFrame('TIT2', 'Fine And Dandy'),
    id3TextFrame('TPE1', 'Art Tatum;James;Swift;Tatum'),
    id3TextFrame('TALB', 'Piano Starts Here'),
    id3TextFrame('TDRC', '1949-03-01'),
    id3TextFrame('TCON', '(8)Jazz'),
    id3v24Frame('APIC', apic)
  ])
  const size = frames.length
  const header = Buffer.from([
    0x49,
    0x44,
    0x33,
    4,
    0,
    0,
    (size >>> 21) & 0x7f,
    (size >>> 14) & 0x7f,
    (size >>> 7) & 0x7f,
    size & 0x7f
  ])
  // 1000 frames at 1152 samples / 44100 Hz ≈ 26 s; Xing carries the exact count.
  const xing = Buffer.concat([Buffer.from('Xing', 'ascii'), u32be(1), u32be(1000)])
  const first = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), xing, Buffer.alloc(200)])
  return Buffer.concat([header, frames, first, mp3Frame, mp3Frame])
}

function vorbisBlock(tags) {
  const vendor = Buffer.from('kolaars-test', 'utf8')
  const parts = [u32le(vendor.length), vendor, u32le(tags.length)]
  for (const tag of tags) {
    const entry = Buffer.from(tag, 'utf8')
    parts.push(u32le(entry.length), entry)
  }
  return Buffer.concat(parts)
}

function flacBlock(type, body, last) {
  const size = body.length
  return Buffer.concat([
    Buffer.from([(last ? 0x80 : 0) | type, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff]),
    body
  ])
}

function makeFlac() {
  // STREAMINFO: 44100 Hz, 3 000 000 samples ≈ 68 s.
  const info = Buffer.alloc(34)
  info.writeUInt16BE(4096, 0)
  info.writeUInt16BE(4096, 2)
  const rate = 44100
  const total = 3000000
  info[10] = (rate >> 12) & 0xff
  info[11] = (rate >> 4) & 0xff
  info[12] = ((rate & 0x0f) << 4) | (1 << 1)
  info[13] = ((total / 0x100000000) & 0x0f) << 4 | ((total >>> 28) & 0x0f)
  info.writeUInt32BE(total >>> 0, 14)

  const comments = vorbisBlock([
    'TITLE=Blue Rondo',
    'ARTIST=Dave Brubeck',
    'ALBUM=Time Out',
    'DATE=1959',
    'GENRE=Jazz'
  ])
  const picture = Buffer.concat([
    u32be(3),
    u32be(10),
    Buffer.from('image/jpeg', 'latin1'),
    u32be(0),
    u32be(500),
    u32be(500),
    u32be(24),
    u32be(0),
    u32be(800),
    Buffer.alloc(800, 0xcd)
  ])

  return Buffer.concat([
    Buffer.from('fLaC', 'ascii'),
    flacBlock(0, info, false),
    flacBlock(4, comments, false),
    flacBlock(6, picture, true),
    Buffer.alloc(64)
  ])
}

function box(type, body) {
  return Buffer.concat([u32be(body.length + 8), Buffer.from(type, 'latin1'), body])
}

function makeM4a() {
  const data = (value) => box('data', Buffer.concat([u32be(1), u32be(0), Buffer.from(value, 'utf8')]))
  const ilst = box(
    'ilst',
    Buffer.concat([
      box('\u00a9nam', data('So What')),
      box('\u00a9ART', data('Miles Davis')),
      box('\u00a9alb', data('Kind of Blue')),
      box('\u00a9day', data('1959')),
      box('\u00a9gen', data('Jazz')),
      box('covr', box('data', Buffer.concat([u32be(14), u32be(0), Buffer.alloc(900, 0xee)])))
    ])
  )
  const meta = box('meta', Buffer.concat([u32be(0), ilst]))
  // mvhd version 0: version/flags, creation, modification, timescale, duration.
  const mvhd = box(
    'mvhd',
    Buffer.concat([u32be(0), u32be(0), u32be(0), u32be(1000), u32be(330000), Buffer.alloc(80)])
  )
  const moov = box('moov', Buffer.concat([mvhd, box('udta', meta)]))
  return Buffer.concat([box('ftyp', Buffer.from('M4A isomM4A ', 'latin1')), moov])
}

/** iTunes layout: the metadata sits after the audio, so only the tail has it. */
function makeM4aMoovLast() {
  const inner = makeM4a()
  const ftypSize = inner.readUInt32BE(0)
  const ftyp = inner.subarray(0, ftypSize)
  const moov = inner.subarray(ftypSize)
  return { head: Buffer.concat([ftyp, box('mdat', Buffer.alloc(4096, 0x11))]), moov }
}

/** 16-bit stereo 44.1 kHz: 176 400 bytes per second of audio. */
function makeWav(seconds = 3) {
  const byteRate = 44100 * 2 * 2
  const dataSize = byteRate * seconds
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'latin1')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(2, 10)
  fmt.writeUInt32LE(44100, 12)
  fmt.writeUInt32LE(byteRate, 16)
  fmt.writeUInt16LE(4, 20)
  fmt.writeUInt16LE(16, 22)
  const dataHead = Buffer.alloc(8)
  dataHead.write('data', 0, 'latin1')
  dataHead.writeUInt32LE(dataSize, 4)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(4 + fmt.length + 8 + dataSize, 4)
  header.write('WAVE', 8, 'latin1')
  return { bytes: Buffer.concat([header, fmt, dataHead, Buffer.alloc(4096, 0x22)]), size: 44 + dataSize }
}

/* ---------------------------------------------------------------- */
/* Checks                                                            */
/* ---------------------------------------------------------------- */

let failures = 0
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('ID3v2.4 (MP3)')
{
  const meta = readAudioMeta(new Uint8Array(makeMp3()))
  check('title', meta.title === 'Fine And Dandy', JSON.stringify(meta.title))
  check('artist', meta.artist === 'Art Tatum, James, Swift, Tatum', JSON.stringify(meta.artist))
  check('album', meta.album === 'Piano Starts Here')
  check('year', meta.year === 1949, String(meta.year))
  check('genre number prefix is dropped', meta.genres?.[0] === 'Jazz', JSON.stringify(meta.genres))
  check('cover', meta.cover?.format === 'image/png' && meta.cover.data.length === 600)
  check('duration from Xing', meta.duration === 26, String(meta.duration))
}

console.log('FLAC')
{
  const meta = readAudioMeta(new Uint8Array(makeFlac()))
  check('title', meta.title === 'Blue Rondo')
  check('artist', meta.artist === 'Dave Brubeck')
  check('album', meta.album === 'Time Out')
  check('year', meta.year === 1959)
  check('duration from STREAMINFO', meta.duration === 68, String(meta.duration))
  check('cover', meta.cover?.format === 'image/jpeg' && meta.cover.data.length === 800)
}

console.log('MP4 / M4A')
{
  const meta = readAudioMeta(new Uint8Array(makeM4a()))
  check('title', meta.title === 'So What', JSON.stringify(meta.title))
  check('artist', meta.artist === 'Miles Davis')
  check('album', meta.album === 'Kind of Blue')
  check('year', meta.year === 1959)
  check('duration from mvhd', meta.duration === 330, String(meta.duration))
  check('cover', meta.cover?.format === 'image/png' && meta.cover.data.length === 900)
}

console.log('MP4 with metadata after the audio')
{
  const { head, moov } = makeM4aMoovLast()
  const tail = Buffer.concat([Buffer.alloc(8192, 0x22), moov])
  const found = findMoovStart(new Uint8Array(tail))
  check('moov is located in the tail', found !== null && found.size === moov.length, JSON.stringify(found))
  const meta = found ? readAudioMeta(new Uint8Array(tail.subarray(found.offset, found.offset + found.size))) : {}
  check('title from the tail', meta.title === 'So What', JSON.stringify(meta.title))
  check('duration from the tail', meta.duration === 330, String(meta.duration))
}

console.log('WAV')
{
  const { bytes, size } = makeWav(3)
  const head = new Uint8Array(bytes.subarray(0, 64))
  const meta = readAudioMeta(head, size)
  check('duration from fmt and data', meta.duration === 3, String(meta.duration))
  check('no tags to invent', !meta.title && !meta.artist)
  const unknownSize = readAudioMeta(head, 0)
  check('header alone still yields a duration', unknownSize.duration === 3, String(unknownSize.duration))
}

console.log('How much to fetch')
{
  const mp3 = new Uint8Array(makeMp3().subarray(0, 64))
  const mp3Span = tagSpan(mp3)
  check('mp3 reads its tag, not the audio', mp3Span > 64 * 1024 && mp3Span < 1024 * 1024, String(mp3Span))
  check('flac reads a megabyte', tagSpan(new Uint8Array(makeFlac().subarray(0, 64))) === 1024 * 1024)
  check('mp4 reads two megabytes', tagSpan(new Uint8Array(makeM4a().subarray(0, 64))) === 2 * 1024 * 1024)
  check('unknown container asks for nothing', tagSpan(new Uint8Array(64).fill(0x5a)) === 0)
}

console.log('Robustness')
{
  check('empty buffer', Object.keys(readAudioMeta(new Uint8Array())).length === 0)
  check('garbage', Object.keys(readAudioMeta(new Uint8Array(64).fill(0x5a))).length === 0)
  const truncated = new Uint8Array(makeMp3()).subarray(0, 40)
  const meta = readAudioMeta(truncated)
  check('truncated tag does not throw', typeof meta === 'object')

  // The Android import reads only the beginning of a file; a length guessed
  // from a fraction of the bytes would be wildly short.
  const whole = new Uint8Array(makeMp3())
  const partial = readAudioMeta(whole.subarray(0, whole.length), whole.length * 50)
  check('only the beginning read still reports the tagged length', partial.duration === 26, String(partial.duration))
}

rmSync(outDir, { recursive: true, force: true })

if (failures > 0) {
  console.log(`\n${failures} checks failed`)
  process.exit(1)
}
console.log('\nall checks passed')
