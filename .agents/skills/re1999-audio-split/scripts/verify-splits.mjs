#!/usr/bin/env node
/**
 * Verify split audio tracks against per-unit tracklists (ADR-0009 three-stage
 * layout). Checks per song: product file exists, duration ≈ expected
 * (end - start, ±0.5s — stream-copy snaps cuts to AAC frame boundaries, so the
 * tolerance is looser than clip's re-encode ±0.05s), and the audio codec is
 * aac (stream copy preserves the source codec).
 *
 * The expected end of each song is derived exactly like the pipeline
 * (src/split/tracklist.ts resolveTrackTimes): a song ends where the next song
 * starts; the final song ends at the source's real duration, probed here with
 * ffprobe. This is independent of the exported tracklist.csv, so a wrong CSV
 * cannot mask a wrong product.
 *
 * Usage: node verify-splits.mjs [tracklist.json] [output-dir]
 *   - no args: scan <workDir>/<project>/split/<unit>/tracklist.json; products
 *     are verified at the mirrored <outputDir>/<project>/split/<unit>/ dir
 *   - with a tracklist path: single-file mode; the second arg overrides its
 *     product dir
 * Env: RE1999_WORK_DIR (default media/work), RE1999_OUTPUT_DIR (default
 *      media/output), FFPROBE_BIN (default ffprobe).
 * Exits 1 on any mismatch or missing product.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FFPROBE = process.env.FFPROBE_BIN ?? 'ffprobe'
const WORK_DIR = process.env.RE1999_WORK_DIR ?? 'media/work'
const OUTPUT_DIR = process.env.RE1999_OUTPUT_DIR ?? 'media/output'
const DURATION_TOLERANCE = 0.5 // seconds; stream-copy AAC-frame snap tolerance
const tracklistArg = process.argv[2]
const outputArg = process.argv[3]

function parseTime(value) {
  if (typeof value === 'number')
    return value
  const s = String(value).trim()
  if (/^\d+(?:\.\d+)?$/.test(s))
    return Number(s)
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(s)
  if (!m)
    throw new Error(`invalid time: ${value}`)
  const minutes = Number(m[2])
  const seconds = Number(m[3])
  if (minutes >= 60 || seconds >= 60)
    throw new Error(`invalid time "${value}": minutes/seconds out of range`)
  return Number(m[1] ?? 0) * 3600 + minutes * 60 + seconds + (m[4] ? Number(`0.${m[4]}`) : 0)
}

function probeDuration(source) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', source], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  const duration = Number(JSON.parse(out).format?.duration)
  if (!Number.isFinite(duration))
    throw new Error(`cannot probe duration of ${source}`)
  return duration
}

function loadTracklist(path) {
  const tl = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof tl.source !== 'string' || tl.source.trim() === '')
    throw new Error(`${path}: tracklist.source must be a non-empty string`)
  if (!Array.isArray(tl.tracks) || tl.tracks.length === 0)
    throw new Error(`${path}: tracklist.tracks must be a non-empty array`)
  return tl
}

/**
 * Derive each song's [start, end, filename] exactly as the pipeline does:
 * end = next start, final end = source real duration; filename = bare title
 * `Title.m4a` (no index prefix).
 */
function resolveTracks(tl, sourceDuration) {
  const starts = tl.tracks.map(t => parseTime(t.start))
  return tl.tracks.map((track, i) => {
    const start = starts[i]
    const end = i + 1 < tl.tracks.length ? starts[i + 1] : sourceDuration
    const filename = `${track.title}.m4a`
    return { title: track.title, start, end, filename }
  })
}

/** work → output mirror of a spec dir (same rule as the pipeline, ADR-0009). */
function mirrorToOutput(specPath) {
  const norm = p => p.split(/[\\/]+/).filter(Boolean).join('/')
  const specDir = norm(dirname(specPath))
  const work = norm(WORK_DIR)
  if (!(specDir === work || specDir.startsWith(work + '/')))
    throw new Error(`spec is outside the work root: ${specPath} (work root: ${WORK_DIR})`)
  return norm(OUTPUT_DIR) + specDir.slice(work.length)
}

function defaultProductDirFor(specPath) {
  try {
    return mirrorToOutput(specPath)
  }
  catch {
    return dirname(specPath)
  }
}

let tracklists
if (tracklistArg) {
  tracklists = [{
    name: '',
    tracklistPath: tracklistArg,
    outputDir: outputArg ?? defaultProductDirFor(tracklistArg),
    tracklist: loadTracklist(tracklistArg),
  }]
}
else {
  let projects
  try {
    projects = readdirSync(WORK_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
  }
  catch {
    projects = []
  }
  const found = []
  for (const project of projects) {
    let units
    try {
      units = readdirSync(join(WORK_DIR, project, 'split'), { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
    }
    catch {
      continue // project without a split/ dir is not a split project
    }
    for (const unit of units) {
      const tracklistPath = join(WORK_DIR, project, 'split', unit, 'tracklist.json')
      if (!existsSync(tracklistPath))
        continue
      found.push({
        name: `${project}/${unit}`,
        tracklistPath,
        outputDir: join(OUTPUT_DIR, project, 'split', unit),
        tracklist: loadTracklist(tracklistPath),
      })
    }
  }
  if (found.length === 0)
    throw new Error(`no tracklists found under ${WORK_DIR}/<project>/split/<unit>/tracklist.json`)
  tracklists = found
}

let failures = 0
for (const { name, outputDir, tracklist } of tracklists) {
  const sourceDuration = probeDuration(tracklist.source)
  const tracks = resolveTracks(tracklist, sourceDuration)

  // Count reconcile: the product dir must hold exactly one .m4a per track —
  // no missing and no stray files. Also cross-check the exported CSV row count.
  let productCount = 0
  try {
    productCount = readdirSync(outputDir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.m4a'))
      .length
  }
  catch {
    // dir missing: every per-track check below will already report the miss
  }
  if (productCount !== tracks.length) {
    console.log(`FAIL ${name ? `[${name}] ` : ''}product count ${productCount} != ${tracks.length} track(s) in ${outputDir}`)
    failures++
  }

  let csvCount = null
  const csvPath = join(outputDir, 'tracklist.csv')
  if (existsSync(csvPath)) {
    const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(l => l.trim() !== '')
    csvCount = lines.length - 1 // drop header
    if (csvCount !== tracks.length) {
      console.log(`FAIL ${name ? `[${name}] ` : ''}tracklist.csv has ${csvCount} row(s), expected ${tracks.length}`)
      failures++
    }
  }

  for (const track of tracks) {
    const file = join(outputDir, track.filename)
    if (!existsSync(file) || !statSync(file).isFile()) {
      console.log(`FAIL ${name ? `[${name}] ` : ''}${track.filename}: missing ${file}`)
      failures++
      continue
    }
    const expected = track.end - track.start
    const info = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,codec_type', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }))
    const duration = Number(info.format.duration)
    const diff = Math.abs(duration - expected)
    const audio = info.streams.find(s => s.codec_type === 'audio')?.codec_name ?? '-'
    const ok = diff < DURATION_TOLERANCE && audio === 'aac'
    if (!ok)
      failures++
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name ? `[${name}] ` : ''}${track.filename.padEnd(40)} dur=${duration.toFixed(3)}s (exp ${expected.toFixed(3)}s, diff ${diff.toFixed(3)}) | ${audio} | ${Math.round(info.format.size / 1024)}KB`)
  }
}

if (failures > 0) {
  console.log(`=== ${failures} FAILED ===`)
  process.exit(1)
}
console.log('=== ALL PASS ===')
