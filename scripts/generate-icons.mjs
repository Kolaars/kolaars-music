/**
 * Generates Kolaars Music's icon set — no design tooling required.
 *
 * Everything is drawn with plain pixel maths and encoded as PNG by hand (zlib +
 * CRC32 from Node's standard library), then wrapped into a multi-size .ico for
 * the Windows installer.
 *
 * Usage:  node scripts/generate-icons.mjs
 * Output: resources/icon.png, resources/icon.ico,
 *         resources/icons/{play,pause,previous,next}.png
 */

import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
/* ------------------------------------------------------------------ */

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
  let c = -1
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** @param {Uint8Array} rgba width*height*4 */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Multi-size PNG-embedded ICO (supported since Windows Vista). */
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(16 * images.length)
  let offset = 6 + 16 * images.length

  images.forEach((image, i) => {
    const base = i * 16
    directory[base] = image.size >= 256 ? 0 : image.size
    directory[base + 1] = image.size >= 256 ? 0 : image.size
    directory[base + 2] = 0
    directory[base + 3] = 0
    directory.writeUInt16LE(1, base + 4) // colour planes
    directory.writeUInt16LE(32, base + 6) // bits per pixel
    directory.writeUInt32LE(image.png.length, base + 8)
    directory.writeUInt32LE(offset, base + 12)
    offset += image.png.length
  })

  return Buffer.concat([header, directory, ...images.map((i) => i.png)])
}

/* ------------------------------------------------------------------ */
/* Tiny software rasteriser                                            */
/* ------------------------------------------------------------------ */

function createCanvas(width, height) {
  const data = new Uint8Array(width * height * 4)
  return { width, height, data }
}

function blend(canvas, x, y, [r, g, b], alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
  const i = (y * canvas.width + x) * 4
  const a = Math.min(1, alpha)
  const dstA = canvas.data[i + 3] / 255
  const outA = a + dstA * (1 - a)
  if (outA === 0) return
  canvas.data[i] = Math.round((r * a + canvas.data[i] * dstA * (1 - a)) / outA)
  canvas.data[i + 1] = Math.round((g * a + canvas.data[i + 1] * dstA * (1 - a)) / outA)
  canvas.data[i + 2] = Math.round((b * a + canvas.data[i + 2] * dstA * (1 - a)) / outA)
  canvas.data[i + 3] = Math.round(outA * 255)
}

/** Signed distance to a rounded rectangle. Negative inside. */
function roundedRectSdf(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius)
  const qy = Math.abs(py - cy) - (halfH - radius)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - radius
}

/**
 * Coverage-based anti-aliased fill of a rounded rectangle using an SDF.
 * 3x3 supersampling keeps edges crisp at every icon size.
 */
function fillRoundedRect(canvas, x, y, w, h, radius, colorAt) {
  const cx = x + w / 2
  const cy = y + h / 2
  const halfW = w / 2
  const halfH = h / 2
  const r = Math.min(radius, halfW, halfH)
  const samples = 4

  for (let py = Math.floor(y) - 1; py < Math.ceil(y + h) + 1; py++) {
    for (let px = Math.floor(x) - 1; px < Math.ceil(x + w) + 1; px++) {
      let hits = 0
      let sx = 0
      let sy = 0
      for (let j = 0; j < samples; j++) {
        for (let i = 0; i < samples; i++) {
          const fx = px + (i + 0.5) / samples
          const fy = py + (j + 0.5) / samples
          if (roundedRectSdf(fx, fy, cx, cy, halfW, halfH, r) <= 0) {
            hits++
            sx += fx
            sy += fy
          }
        }
      }
      if (hits === 0) continue
      const coverage = hits / (samples * samples)
      const color = colorAt((sx / hits - x) / w, (sy / hits - y) / h)
      blend(canvas, px, py, color, coverage)
    }
  }
}

/* ------------------------------------------------------------------ */
/* Brand drawing                                                       */
/* ------------------------------------------------------------------ */

const GRADIENT_FROM = [124, 92, 255] // #7C5CFF
const GRADIENT_TO = [34, 211, 238] // #22D3EE

function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ]
}

/**
 * The mark: a rounded square with the brand gradient and an equaliser glyph.
 * `flat` renders monochrome (used for the transport icons).
 */
function drawAppIcon(size) {
  const canvas = createCanvas(size, size)
  const pad = size * 0.055
  const box = size - pad * 2
  const radius = box * 0.235

  // Background plate with a diagonal gradient.
  fillRoundedRect(canvas, pad, pad, box, box, radius, (u, v) => {
    const t = Math.min(1, Math.max(0, (u + v) / 2))
    return lerpColor(GRADIENT_FROM, GRADIENT_TO, t)
  })

  // Equaliser bars, centred, with the classic "music" silhouette.
  const barCount = 5
  const heights = [0.34, 0.58, 0.82, 0.52, 0.3]
  const totalWidth = box * 0.62
  const gap = totalWidth / (barCount * 1.9)
  const barWidth = (totalWidth - gap * (barCount - 1)) / barCount
  const startX = pad + (box - totalWidth) / 2
  const centerY = pad + box / 2
  const barRadius = barWidth / 2

  for (let i = 0; i < barCount; i++) {
    const h = box * heights[i]
    const x = startX + i * (barWidth + gap)
    fillRoundedRect(canvas, x, centerY - h / 2, barWidth, h, barRadius, () => [255, 255, 255])
  }

  return canvas
}

/** 32x32 monochrome transport glyphs, white on transparent. */
function drawGlyph(kind, size = 32) {
  const canvas = createCanvas(size, size)
  const white = [255, 255, 255]
  const s = size
  const inset = s * 0.16
  const body = s - inset * 2
  const cy = s / 2

  const triangle = (direction) => {
    for (let py = 0; py < s; py++) {
      for (let px = 0; px < s; px++) {
        // Barycentric test for a right-pointing triangle, mirrored if needed.
        const x = direction === 1 ? px : s - 1 - px
        const t = (x - inset) / body
        if (t < 0 || t > 1) continue
        const halfHeight = (body / 2) * (1 - t)
        if (Math.abs(py + 0.5 - cy) <= halfHeight) blend(canvas, px, py, white, 1)
      }
    }
  }

  switch (kind) {
    case 'play':
      triangle(1)
      break
    case 'previous':
      triangle(-1)
      fillRoundedRect(canvas, inset, inset, s * 0.09, body, s * 0.04, () => white)
      break
    case 'next':
      triangle(1)
      fillRoundedRect(canvas, s - inset - s * 0.09, inset, s * 0.09, body, s * 0.04, () => white)
      break
    case 'pause':
      fillRoundedRect(canvas, s * 0.29, inset, s * 0.15, body, s * 0.07, () => white)
      fillRoundedRect(canvas, s * 0.56, inset, s * 0.15, body, s * 0.07, () => white)
      break
    default:
      throw new Error(`Unknown glyph ${kind}`)
  }
  return canvas
}

/* ------------------------------------------------------------------ */

async function main() {
  const resources = path.join(ROOT, 'resources')
  const iconsDir = path.join(resources, 'icons')
  await mkdir(iconsDir, { recursive: true })

  const icon512 = drawAppIcon(512)
  await writeFile(path.join(resources, 'icon.png'), encodePng(icon512.data, 512, 512))
  console.log('resources/icon.png (512x512)')

  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoImages = icoSizes.map((size) => {
    const canvas = drawAppIcon(size)
    return { size, png: encodePng(canvas.data, size, size) }
  })
  await writeFile(path.join(resources, 'icon.ico'), encodeIco(icoImages))
  console.log(`resources/icon.ico (${icoSizes.join(', ')})`)

  // A 256x256 PNG is also handy for installers that want a separate file.
  const icon256 = drawAppIcon(256)
  await writeFile(path.join(resources, 'icon-256.png'), encodePng(icon256.data, 256, 256))

  for (const kind of ['play', 'pause', 'previous', 'next']) {
    const canvas = drawGlyph(kind, 32)
    await writeFile(path.join(iconsDir, `${kind}.png`), encodePng(canvas.data, 32, 32))
    console.log(`resources/icons/${kind}.png (32x32)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
