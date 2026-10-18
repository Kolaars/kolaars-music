/**
 * Builds `data/seed-catalog.json` from live Internet Archive queries.
 *
 * Kolaars Music ships with a small, curated catalog so that a fresh install has
 * something to browse and play immediately — even before the user runs a single
 * search. This script regenerates that catalog from the same public endpoints
 * the app itself uses, which keeps the shipped data verifiable and honest.
 *
 * Usage:
 *   node scripts/build-seed-catalog.mjs [--per-shelf 24] [--out data/seed-catalog.json]
 *
 * Only public-domain and Creative Commons items are selected. Nothing is
 * downloaded: the catalog stores metadata plus a direct stream URL.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const PER_SHELF = Number(arg('per-shelf', '24'))
const OUT = path.resolve(ROOT, arg('out', 'data/seed-catalog.json'))

const SHELVES = [
  { id: 'jazz', title: 'Золотой век джаза', query: 'collection:georgeblood AND subject:"jazz"' },
  { id: 'blues', title: 'Блюз и спиричуэлс', query: 'collection:georgeblood AND (subject:"blues" OR subject:"spiritual")' },
  { id: 'country', title: 'Раннее кантри и фолк', query: 'collection:georgeblood AND subject:"country"' },
  { id: 'ragtime', title: 'Рэгтайм', query: 'collection:georgeblood AND subject:"ragtime"' },
  { id: 'dance-band', title: 'Танцевальные оркестры', query: 'collection:georgeblood AND subject:"dance"' },
  { id: 'waltz', title: 'Вальсы и салонная музыка', query: 'collection:georgeblood AND subject:"waltz"' },
  { id: 'christmas', title: 'Рождественская классика', query: 'collection:georgeblood AND subject:"christmas"' },
  { id: 'classical', title: 'Академическая классика и опера', query: 'collection:georgeblood AND (subject:"classical" OR subject:"opera")' },
  { id: 'musopen', title: 'Musopen: записи без ограничений', query: 'collection:musopen AND mediatype:audio' },
  { id: 'netlabels', title: 'Независимые лейблы (CC)', query: 'collection:netlabels AND mediatype:audio' }
]

const FIELDS = ['identifier', 'title', 'creator', 'year', 'date', 'genre', 'subject', 'licenseurl', 'collection', 'downloads']
const UA = 'KolaarsMusic-seed/1.0 (+https://github.com/kolaars/kolaars-music)'

const AUDIO_RANK = { 'VBR MP3': 0, MP3: 1, '128Kbps MP3': 2, 'Ogg Vorbis': 3, Flac: 4, '24bit Flac': 5 }

async function getJson(url, timeoutMs = 30000) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      if (attempt === 2) throw err
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
  }
}

function arr(v) {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function first(v) {
  return arr(v).map((x) => String(x ?? '').trim()).filter(Boolean)[0] ?? null
}

function parseYear(v) {
  const m = String(v ?? '').match(/(1[6-9]\d{2}|20\d{2})/)
  return m ? Number(m[1]) : null
}

function parseDuration(raw) {
  if (!raw) return null
  const v = String(raw).trim()
  if (v.includes(':')) {
    const parts = v.split(':').map(Number)
    if (parts.some((p) => !Number.isFinite(p))) return null
    return parts.reduce((a, b) => a * 60 + b, 0)
  }
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function isAudio(f) {
  if (f.format && f.format in AUDIO_RANK) return true
  return /\.(mp3|ogg|flac|wav|m4a|opus)$/i.test(f.name ?? '')
}

function pickAudioFile(files = []) {
  const audio = files.filter(isAudio)
  // Group per logical track, keep the best-ranked encoding of the first track.
  const byBase = new Map()
  for (const f of audio) {
    const base = f.name.replace(/\.[^.]+$/, '').toLowerCase()
    if (!byBase.has(base)) byBase.set(base, [])
    byBase.get(base).push(f)
  }
  const groups = [...byBase.values()]
  groups.sort((a, b) => {
    const ta = Number(a[0].track ?? NaN)
    const tb = Number(b[0].track ?? NaN)
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb
    return a[0].name.localeCompare(b[0].name, undefined, { numeric: true })
  })
  const firstGroup = groups[0] ?? audio
  if (firstGroup.length === 0) return { file: null, trackCount: 0 }
  firstGroup.sort((a, b) => (AUDIO_RANK[a.format] ?? 50) - (AUDIO_RANK[b.format] ?? 50))
  return { file: firstGroup[0], trackCount: groups.length }
}

function licenseLabel(doc, meta) {
  const url = first(doc.licenseurl) ?? first(meta?.metadata?.licenseurl)
  if (url) {
    const u = url.toLowerCase()
    if (u.includes('publicdomain') || u.includes('/zero/')) return { license: 'Общественное достояние', licenseUrl: url }
    const cc = u.match(/licenses\/([a-z-]+)\/([\d.]+)/)
    if (cc) {
      const kind = cc[1].split('-').map((p) => ({ by: 'BY', nc: 'NC', sa: 'SA', nd: 'ND' })[p] ?? p.toUpperCase()).join('-')
      return { license: `CC ${kind} ${cc[2]}`, licenseUrl: url }
    }
    return { license: url, licenseUrl: url }
  }
  const collections = arr(meta?.metadata?.collection).map(String)
  if (collections.includes('georgeblood') || collections.includes('78rpm')) {
    return { license: 'Общественное достояние', licenseUrl: 'https://archive.org/details/georgeblood' }
  }
  if (collections.includes('netlabels')) return { license: 'Creative Commons', licenseUrl: 'https://archive.org/details/netlabels' }
  if (collections.includes('musopen')) return { license: 'Общественное достояние', licenseUrl: 'https://archive.org/details/musopen' }
  return { license: 'См. страницу записи', licenseUrl: `https://archive.org/details/${first(doc.identifier) ?? meta?.metadata?.identifier}` }
}

async function searchShelf(shelf) {
  const params = new URLSearchParams()
  params.set('q', `${shelf.query} AND mediatype:(audio)`)
  for (const f of FIELDS) params.append('fl[]', f)
  params.set('rows', String(PER_SHELF))
  params.set('page', '1')
  params.set('output', 'json')
  params.append('sort[]', 'downloads desc')
  const data = await getJson(`https://archive.org/advancedsearch.php?${params}`)
  return data?.response?.docs ?? []
}

async function hydrate(doc, shelfId) {
  const identifier = doc.identifier
  const meta = await getJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`)
  const { file, trackCount } = pickAudioFile(meta?.files)
  if (!file) return null

  const md = meta?.metadata ?? {}
  const { license, licenseUrl } = licenseLabel(doc, meta)
  const multiple = trackCount > 1
  const rawTitle = String(file.title ?? '').trim() || file.name.replace(/\.[^.]+$/, '')
  const albumTitle = String(first(md.title) ?? identifier)

  return {
    id: `arc:${identifier}`,
    title: rawTitle || albumTitle,
    artist:
      arr(md.creator).map(String).map((s) => s.trim()).filter(Boolean).join(', ') ||
      'Неизвестный исполнитель',
    album: multiple ? albumTitle : (String(file.album ?? '').trim() || null),
    year: parseYear(first(md.year) ?? first(md.date) ?? first(doc.year) ?? first(doc.date)),
    genres: [...arr(file.genre), ...arr(md.genre), ...arr(md.subject), ...arr(doc.genre), ...arr(doc.subject)]
      .map((g) => String(g).trim())
      .filter(Boolean)
      .slice(0, 6),
    duration: parseDuration(file.length),
    artwork: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    source: 'seed',
    streamUrl: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`,
    identifier,
    filePath: null,
    license,
    licenseUrl,
    sourceUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    offline: false,
    addedAt: null,
    shelf: shelfId,
    trackCount
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor++
        if (i >= items.length) return
        out[i] = await fn(items[i], i)
      }
    })
  )
  return out
}

async function main() {
  const seen = new Set()
  const catalog = []

  for (const shelf of SHELVES) {
    process.stdout.write(`→ ${shelf.title} … `)
    let docs = []
    try {
      docs = await searchShelf(shelf)
    } catch (err) {
      console.log(`search failed: ${err.message}`)
      continue
    }
    let failures = 0
    const hydrated = await mapLimit(docs, 8, async (doc) => {
      if (seen.has(doc.identifier)) return null
      try {
        const t = await hydrate(doc, shelf.id)
        if (!t || !t.streamUrl || !t.title) return null
        seen.add(doc.identifier)
        return t
      } catch (err) {
        failures++
        if (failures <= 3) console.error(`\n   ! ${doc.identifier}: ${err.message}`)
        return null
      }
    })
    const kept = hydrated.filter(Boolean)
    catalog.push(...kept)
    console.log(`${kept.length}/${docs.length}`)
  }

  // Sort so the file is deterministic between runs.
  catalog.sort((a, b) => (a.shelf + a.id).localeCompare(b.shelf + b.id))

  const payload = {
    _comment:
      'Generated by scripts/build-seed-catalog.mjs from the public Internet Archive APIs. Music is public domain or Creative Commons; stream URLs point at archive.org.',
    generatedAt: new Date().toISOString(),
    trackCount: catalog.length,
    shelves: SHELVES.map((s) => ({ id: s.id, title: s.title })),
    tracks: catalog
  }

  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  console.log(`\nWrote ${catalog.length} tracks → ${path.relative(ROOT, OUT)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
