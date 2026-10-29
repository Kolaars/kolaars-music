/**
 * Minimal audio tag reader.
 *
 * The desktop reads tags with `music-metadata`, which needs Node streams. On
 * Android the bytes come from the Storage Access Framework, so this module
 * takes a plain buffer and understands the three containers that cover almost
 * every local library: MP3 (ID3v2), FLAC (Vorbis comments) and MP4/M4A (ilst).
 *
 * It reads from the *start* of the file only, because that is all the app can
 * fetch cheaply through Capacitor. Anything it cannot parse is simply absent:
 * every field is optional and callers fall back to the file name.
 */

export interface AudioMeta {
  title?: string
  artist?: string
  album?: string
  year?: number
  genres?: string[]
  duration?: number
  cover?: { format: string; data: Uint8Array }
}

/* ------------------------------------------------------------------ */
/* Bytes                                                               */
/* ------------------------------------------------------------------ */

function u16(d: Uint8Array, o: number): number {
  return ((d[o] << 8) | d[o + 1]) >>> 0
}

function u24(d: Uint8Array, o: number): number {
  return ((d[o] << 16) | (d[o + 1] << 8) | d[o + 2]) >>> 0
}

function u32(d: Uint8Array, o: number): number {
  return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0
}

function u32le(d: Uint8Array, o: number): number {
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0
}

function u16le(d: Uint8Array, o: number): number {
  return ((d[o] | (d[o + 1] << 8)) >>> 0) & 0xffff
}

function syncsafe(d: Uint8Array, o: number): number {
  return ((d[o] & 0x7f) << 21) | ((d[o + 1] & 0x7f) << 14) | ((d[o + 2] & 0x7f) << 7) | (d[o + 3] & 0x7f)
}

function ascii(d: Uint8Array, o: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(d[o + i])
  return out
}

function decodeLatin1(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i])
  return out
}

function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
  let start = 0
  let big = bigEndian
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      start = 2
      big = false
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      start = 2
      big = true
    }
  }
  let out = ''
  for (let i = start; i + 1 < bytes.length; i += 2) {
    const code = big ? (bytes[i] << 8) | bytes[i + 1] : bytes[i] | (bytes[i + 1] << 8)
    if (code === 0) break
    out += String.fromCharCode(code)
  }
  return out
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return decodeLatin1(bytes)
  }
}

function trimNulls(value: string): string {
  return value.replace(/\u0000+$/g, '').trim()
}

/* ------------------------------------------------------------------ */
/* ID3v2 (MP3)                                                         */
/* ------------------------------------------------------------------ */

function id3Text(payload: Uint8Array): string {
  if (payload.length === 0) return ''
  const encoding = payload[0]
  const body = payload.subarray(1)
  switch (encoding) {
    case 1:
      return decodeUtf16(body, false)
    case 2:
      return decodeUtf16(body, true)
    case 3:
      return decodeUtf8(body)
    default:
      return decodeLatin1(body)
  }
}

/**
 * Splits a text frame into its values. ID3v2.4 separates them with NUL, while
 * older tags — and most taggers in practice — use a semicolon instead.
 */
function id3Values(text: string): string[] {
  return text
    .split(/[\u0000;]/)
    .map((value) => trimNulls(value))
    .filter(Boolean)
}

function id3Picture(payload: Uint8Array, version: number): AudioMeta['cover'] | undefined {
  if (payload.length < 4) return undefined
  const encoding = payload[0]
  let offset = 1
  let format = 'image/jpeg'

  if (version === 2) {
    // ID3v2.2 PIC: three characters, "JPG" or "PNG".
    format = ascii(payload, offset, 3).toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg'
    offset += 3
  } else {
    let end = offset
    while (end < payload.length && payload[end] !== 0) end += 1
    const mime = decodeLatin1(payload.subarray(offset, end)).trim()
    if (mime) format = mime.includes('/') ? mime : `image/${mime}`
    offset = end + 1
  }

  offset += 1 // picture type
  // Description, terminated in the frame's own encoding.
  if (encoding === 1 || encoding === 2) {
    while (offset + 1 < payload.length && (payload[offset] !== 0 || payload[offset + 1] !== 0)) offset += 2
    offset += 2
  } else {
    while (offset < payload.length && payload[offset] !== 0) offset += 1
    offset += 1
  }

  if (offset >= payload.length) return undefined
  return { format, data: payload.subarray(offset) }
}

function parseId3(d: Uint8Array): { meta: AudioMeta; tagEnd: number } | null {
  if (d.length < 10 || d[0] !== 0x49 || d[1] !== 0x44 || d[2] !== 0x33) return null
  const version = d[3]
  const flags = d[5]
  const size = syncsafe(d, 6)
  const tagEnd = 10 + size
  const limit = Math.min(tagEnd, d.length)
  let offset = 10

  const meta: AudioMeta = {}

  if (flags & 0x40) {
    const extSize = version >= 4 ? syncsafe(d, 10) : u32(d, 10) + 4
    offset += Number.isFinite(extSize) ? extSize : 0
  }

  const idLength = version === 2 ? 3 : 4
  const headerLength = version === 2 ? 6 : 10

  while (offset + headerLength <= limit) {
    const id = ascii(d, offset, idLength)
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break
    const frameSize =
      version === 2 ? u24(d, offset + 3) : version >= 4 ? syncsafe(d, offset + 4) : u32(d, offset + 4)
    if (frameSize <= 0 || offset + headerLength + frameSize > limit) break
    const payload = d.subarray(offset + headerLength, offset + headerLength + frameSize)

    switch (id) {
      case 'TIT2':
      case 'TT2':
        meta.title ??= trimNulls(id3Text(payload))
        break
      case 'TPE1':
      case 'TP1':
        meta.artist ??= id3Values(id3Text(payload)).join(', ') || undefined
        break
      case 'TALB':
      case 'TAL':
        meta.album ??= trimNulls(id3Text(payload))
        break
      case 'TYER':
      case 'TYE':
      case 'TDRC':
        if (!meta.year) {
          const year = Number.parseInt(trimNulls(id3Text(payload)).slice(0, 4), 10)
          if (Number.isFinite(year) && year > 1000) meta.year = year
        }
        break
      case 'TCON':
      case 'TCO': {
        const genres = id3Values(id3Text(payload))
          .map((value) => value.replace(/^\(\d+\)\s*/, ''))
          .filter(Boolean)
        if (genres.length > 0) meta.genres = genres.slice(0, 6)
        break
      }
      case 'APIC':
      case 'PIC':
        meta.cover ??= id3Picture(payload, version)
        break
      default:
        break
    }

    offset += headerLength + frameSize
  }

  return { meta, tagEnd }
}

/**
 * Estimate of an MP3's length from its first frame (CBR) or Xing header.
 *
 * `totalBytes` is the real size of the file. When only the beginning was read,
 * the constant-bitrate estimate would divide a fraction of the audio by the
 * bitrate and report a length far too short, so it is skipped.
 */
function mp3Duration(d: Uint8Array, start: number, totalBytes: number): number | undefined {
  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
  const rates = [44100, 48000, 32000, 0]

  for (let i = start; i + 4 < d.length && i < start + 64 * 1024; i += 1) {
    if (d[i] !== 0xff || (d[i + 1] & 0xe0) !== 0xe0) continue
    const versionBits = (d[i + 1] >> 3) & 0x03
    const layerBits = (d[i + 1] >> 1) & 0x03
    if (layerBits === 0 || versionBits === 1) continue
    const bitrateIndex = (d[i + 2] >> 4) & 0x0f
    const rateIndex = (d[i + 2] >> 2) & 0x03
    if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue

    const kbps = bitrates[bitrateIndex]
    const sampleRate = rates[rateIndex] * (versionBits === 3 ? 1 : versionBits === 2 ? 0.5 : 0.25)
    if (!sampleRate) continue

    // Xing/Info lives inside the first frame: tag (4), flags (4), then the
    // optional fields, frames being the first of them.
    const searchEnd = Math.min(d.length - 12, i + 200)
    for (let j = i + 4; j < searchEnd; j += 1) {
      const tag = ascii(d, j, 4)
      if (tag !== 'Xing' && tag !== 'Info') continue
      const flags = u32(d, j + 4)
      if ((flags & 1) === 0) continue
      const frames = u32(d, j + 8)
      // Layer I is 384 samples, layer II 1152, layer III 1152 for MPEG-1 and
      // 576 for MPEG-2/2.5.
      const samplesPerFrame = layerBits === 3 ? 384 : layerBits === 2 ? 1152 : versionBits === 3 ? 1152 : 576
      if (frames > 0) return Math.round((frames * samplesPerFrame) / sampleRate)
      break
    }

    // Constant bitrate: the rest of the file divided by the frame bitrate.
    if (totalBytes > d.length) return undefined
    const bytes = (d.length - start) * 8
    if (kbps > 0) return Math.round(bytes / (kbps * 1000))
    return undefined
  }

  return undefined
}

/* ------------------------------------------------------------------ */
/* FLAC                                                                */
/* ------------------------------------------------------------------ */

function flacPicture(d: Uint8Array, offset: number): AudioMeta['cover'] | undefined {
  let at = offset
  at += 4 // picture type
  const mimeLength = u32(d, at)
  at += 4
  const format = decodeLatin1(d.subarray(at, at + mimeLength)) || 'image/jpeg'
  at += mimeLength
  const descriptionLength = u32(d, at)
  at += 4 + descriptionLength
  at += 16 // width, height, depth, colours
  const dataLength = u32(d, at)
  at += 4
  if (dataLength <= 0 || at + dataLength > d.length) return undefined
  return { format, data: d.subarray(at, at + dataLength) }
}

function vorbisComments(d: Uint8Array, offset: number): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  let at = offset
  const vendorLength = u32le(d, at)
  at += 4 + vendorLength
  const count = u32le(d, at)
  at += 4
  for (let i = 0; i < count && at + 4 <= d.length; i += 1) {
    const length = u32le(d, at)
    at += 4
    if (length <= 0 || at + length > d.length) break
    const entry = decodeUtf8(d.subarray(at, at + length))
    at += length
    const split = entry.indexOf('=')
    if (split <= 0) continue
    const key = entry.slice(0, split).toUpperCase()
    const value = entry.slice(split + 1).trim()
    if (value) (map[key] ??= []).push(value)
  }
  return map
}

function parseFlac(d: Uint8Array): AudioMeta | null {
  if (d.length < 4 || ascii(d, 0, 4) !== 'fLaC') return null
  const meta: AudioMeta = {}
  let offset = 4

  while (offset + 4 <= d.length) {
    const header = d[offset]
    const isLast = (header & 0x80) !== 0
    const type = header & 0x7f
    const length = u24(d, offset + 1)
    const body = offset + 4
    if (body + length > d.length) break

    if (type === 0 && length >= 34) {
      // STREAMINFO: 20 bits of sample rate, then 36 bits of total samples.
      const rate = (d[body + 10] << 12) | (d[body + 11] << 4) | (d[body + 12] >> 4)
      const total =
        (d[body + 13] & 0x0f) * 0x100000000 +
        u32(d, body + 14) // 36 bits: 4 bits from byte 13 + 32 bits
      if (rate > 0 && total > 0) meta.duration = Math.round(total / rate)
    } else if (type === 4) {
      const comments = vorbisComments(d, body)
      meta.title ??= comments.TITLE?.[0]
      meta.artist ??= (comments.ARTIST ?? comments.ALBUMARTIST)?.join(', ')
      meta.album ??= comments.ALBUM?.[0]
      const year = Number.parseInt((comments.DATE ?? [])[0]?.slice(0, 4) ?? '', 10)
      if (Number.isFinite(year) && year > 1000) meta.year = year
      const genres = (comments.GENRE ?? []).slice(0, 6)
      if (genres.length > 0) meta.genres = genres
    } else if (type === 6) {
      meta.cover ??= flacPicture(d, body)
    }

    if (isLast) break
    offset = body + length
  }

  return meta
}

/* ------------------------------------------------------------------ */
/* MP4 / M4A                                                           */
/* ------------------------------------------------------------------ */

interface Box {
  type: string
  start: number
  body: number
  end: number
}

function boxes(d: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = []
  let offset = start
  while (offset + 8 <= end) {
    let size = u32(d, offset)
    const type = ascii(d, offset + 4, 4)
    let body = offset + 8
    if (size === 1) {
      if (offset + 16 > end) break
      const high = u32(d, offset + 8)
      const low = u32(d, offset + 12)
      size = high * 0x100000000 + low
      body = offset + 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < 8 || offset + size > end) break
    out.push({ type, start: offset, body, end: offset + size })
    offset += size
  }
  return out
}

function findBox(d: Uint8Array, start: number, end: number, path: string[]): Box | null {
  const list = boxes(d, start, end)
  for (const box of list) {
    if (box.type !== path[0]) continue
    if (path.length === 1) return box
    return findBox(d, box.body, box.end, path.slice(1))
  }
  return null
}

function mp4Text(d: Uint8Array, item: Box): string {
  for (const child of boxes(d, item.body, item.end)) {
    if (child.type !== 'data') continue
    // 4 bytes type flags + 4 bytes locale, then the value.
    const start = child.body + 8
    return trimNulls(decodeUtf8(d.subarray(start, child.end)))
  }
  return ''
}

function parseMp4(d: Uint8Array): AudioMeta | null {
  const moov = findBox(d, 0, d.length, ['moov'])
  if (!moov) return null
  const meta: AudioMeta = {}

  const mvhd = boxes(d, moov.body, moov.end).find((box) => box.type === 'mvhd')
  if (mvhd) {
    const version = d[mvhd.body]
    if (version === 1) {
      const timescale = u32(d, mvhd.body + 20)
      const duration = u32(d, mvhd.body + 24) * 0x100000000 + u32(d, mvhd.body + 28)
      if (timescale > 0 && duration > 0) meta.duration = Math.round(duration / timescale)
    } else {
      const timescale = u32(d, mvhd.body + 12)
      const duration = u32(d, mvhd.body + 16)
      if (timescale > 0 && duration > 0) meta.duration = Math.round(duration / timescale)
    }
  }

  // `meta` is a FullBox: four bytes of version/flags before its children, and
  // it sits either directly under `moov` or inside `udta`.
  const moovChildren = boxes(d, moov.body, moov.end)
  let metaBox = moovChildren.find((box) => box.type === 'meta') ?? null
  if (!metaBox) {
    const udta = moovChildren.find((box) => box.type === 'udta')
    if (udta) metaBox = boxes(d, udta.body, udta.end).find((box) => box.type === 'meta') ?? null
  }
  if (!metaBox) return meta
  const ilst = findBox(d, metaBox.body + 4, metaBox.end, ['ilst'])
  if (!ilst) return meta
  for (const item of boxes(d, ilst.body, ilst.end)) {
    switch (item.type) {
      case '\u00a9nam':
        meta.title ??= mp4Text(d, item) || undefined
        break
      case '\u00a9ART':
      case 'aART':
        meta.artist ??= mp4Text(d, item) || undefined
        break
      case '\u00a9alb':
        meta.album ??= mp4Text(d, item) || undefined
        break
      case '\u00a9day': {
        const year = Number.parseInt(mp4Text(d, item).slice(0, 4), 10)
        if (Number.isFinite(year) && year > 1000) meta.year = year
        break
      }
      case '\u00a9gen': {
        const genre = mp4Text(d, item)
        if (genre) meta.genres = [genre]
        break
      }
      case 'covr': {
        for (const child of boxes(d, item.body, item.end)) {
          if (child.type !== 'data') continue
          const kind = u32(d, child.body) & 0xffffff
          meta.cover ??= {
            format: kind === 14 ? 'image/png' : 'image/jpeg',
            data: d.subarray(child.body + 8, child.end)
          }
        }
        break
      }
      default:
        break
    }
  }

  return meta
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Reads what it can from a byte range of a file. Never throws: an exotic
 * container just yields an empty result and the caller keeps file-name names.
 *
 * `totalBytes` is the size of the whole file, which lets the MP3 fallback know
 * whether it is looking at all of the audio or only at its beginning.
 */
/**
 * RIFF/WAVE carries no tags worth reading on a phone, but its `fmt ` and
 * `data` chunks give the duration without decoding a single sample:
 * data bytes ÷ byte rate. Odd-sized chunks are padded to an even boundary.
 */
function parseWav(data: Uint8Array, totalBytes: number): AudioMeta {
  const meta: AudioMeta = {}
  let byteRate = 0
  let offset = 12
  while (offset + 8 <= data.length) {
    const id = ascii(data, offset, 4)
    const size = u32le(data, offset + 4)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= data.length) {
      const channels = u16le(data, body + 2)
      const sampleRate = u32le(data, body + 4)
      const bits = u16le(data, body + 14)
      byteRate = u32le(data, body + 8) || Math.round((channels * sampleRate * Math.max(8, bits)) / 8)
    } else if (id === 'data') {
      const bytes = size > 0 && size !== 0xffffffff ? size : Math.max(0, totalBytes - body)
      if (byteRate > 0 && bytes > 0) meta.duration = Math.round(bytes / byteRate)
      break
    }
    if (size === 0 || size === 0xffffffff) break
    offset = body + size + (size % 2)
  }
  return meta
}

export function readAudioMeta(data: Uint8Array, totalBytes = data?.length ?? 0): AudioMeta {
  try {
    if (!data || data.length < 12) return {}

    if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
      const parsed = parseId3(data)
      if (!parsed) return {}
      const meta = parsed.meta
      meta.duration ??= mp3Duration(data, parsed.tagEnd, totalBytes)
      return clean(meta)
    }

    if (ascii(data, 0, 4) === 'fLaC') {
      return clean(parseFlac(data) ?? {})
    }

    const probe = ascii(data, 4, 4)
    if (probe === 'ftyp' || probe === 'moov') {
      return clean(parseMp4(data) ?? {})
    }

    if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WAVE') {
      return clean(parseWav(data, totalBytes))
    }

    // No container header: maybe a bare MPEG stream.
    const duration = mp3Duration(data, 0, totalBytes)
    return duration ? { duration } : {}
  } catch {
    return {}
  }
}

/**
 * How many leading bytes are worth fetching to read a file's tags.
 *
 * Covers live at the end of an ID3 tag, so the whole tag plus the first audio
 * frame is the useful span — usually a couple of hundred kilobytes, not the
 * megabytes a blind read would take. `0` means the container is unknown.
 */
export function tagSpan(head: Uint8Array): number {
  if (!head || head.length < 10) return 0
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    return Math.min(10 + syncsafe(head, 6) + 64 * 1024, 16 * 1024 * 1024)
  }
  if (ascii(head, 0, 4) === 'fLaC') return 1024 * 1024
  if (ascii(head, 4, 4) === 'ftyp') return 2 * 1024 * 1024
  return 0
}

/**
 * Where the metadata of an MP4/M4A lives, when it is not in the first bytes.
 *
 * iTunes-style files put `moov` at the end, after the audio. Scanning for the
 * box signature is enough to find its header again, and the caller can then
 * re-read exactly that range and hand it to `readAudioMeta`.
 */
export function findMoovStart(tail: Uint8Array): { offset: number; size: number } | null {
  for (let i = tail.length - 8; i >= 4; i -= 1) {
    if (tail[i] !== 0x6d || tail[i + 1] !== 0x6f || tail[i + 2] !== 0x6f || tail[i + 3] !== 0x76) continue
    const size = u32(tail, i - 4)
    if (size < 8 || size > 64 * 1024 * 1024) continue
    return { offset: i - 4, size }
  }
  return null
}

/** Drops empty strings so callers can use `??` for their fallbacks. */
function clean(meta: AudioMeta): AudioMeta {
  return {
    title: meta.title || undefined,
    artist: meta.artist || undefined,
    album: meta.album || undefined,
    year: meta.year,
    genres: meta.genres?.filter(Boolean).slice(0, 6),
    duration: meta.duration && meta.duration > 0 ? meta.duration : undefined,
    cover: meta.cover && meta.cover.data.length > 32 ? meta.cover : undefined
  }
}
