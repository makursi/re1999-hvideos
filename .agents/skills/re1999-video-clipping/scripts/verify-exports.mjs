#!/usr/bin/env node
/**
 * Verify exported clips against per-unit manifests (ADR-0009 three-stage layout).
 * Checks per clip id: file exists, duration ≈ expected (out - in, ±0.05s),
 * video codec is h264, and moov atom is at the front (faststart).
 *
 * Usage: node verify-exports.mjs [manifest.json] [output-dir]
 *   - no args: scan <workDir>/<project>/clips/<unit>/manifest.json; products are
 *     verified at the mirrored <outputDir>/<project>/clips/<unit>/ directory
 *   - with a manifest path: single-file mode; the second arg overrides its product dir
 * Env: RE1999_WORK_DIR (default media/work), RE1999_OUTPUT_DIR (default media/output)
 * Exits 1 on any mismatch. Requires ffprobe on PATH (or FFPROBE_BIN env).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FFPROBE = process.env.FFPROBE_BIN ?? 'ffprobe'
const WORK_DIR = process.env.RE1999_WORK_DIR ?? 'media/work'
const OUTPUT_DIR = process.env.RE1999_OUTPUT_DIR ?? 'media/output'
const manifestArg = process.argv[2]
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
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0)
}

function loadManifest(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(manifest.clips) || manifest.clips.length === 0)
    throw new Error(`${path}: manifest.clips must be a non-empty array`)
  return manifest
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

/** work → output mirror of a spec dir, falling back to the spec dir for specs outside the work root. */
function defaultProductDirFor(specPath) {
  try {
    return mirrorToOutput(specPath)
  }
  catch {
    return dirname(specPath)
  }
}

let manifests
if (manifestArg) {
  manifests = [{ name: '', manifestPath: manifestArg, outputDir: outputArg ?? defaultProductDirFor(manifestArg), manifest: loadManifest(manifestArg) }]
}
else {
  const projects = readdirSync(WORK_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
  const found = []
  for (const project of projects) {
    let units
    try {
      units = readdirSync(join(WORK_DIR, project, 'clips'), { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
    }
    catch {
      continue // project without a clips/ dir is not a clip project
    }
    for (const unit of units) {
      const manifestPath = join(WORK_DIR, project, 'clips', unit, 'manifest.json')
      if (!existsSync(manifestPath))
        continue
      found.push({
        name: `${project}/${unit}`,
        manifestPath,
        outputDir: join(OUTPUT_DIR, project, 'clips', unit),
        manifest: loadManifest(manifestPath),
      })
    }
  }
  if (found.length === 0)
    throw new Error(`no manifests found under ${WORK_DIR}/<project>/clips/<unit>/manifest.json`)
  manifests = found
}

let failures = 0
for (const { name, outputDir, manifest } of manifests) {
  for (const clip of manifest.clips) {
    const { id } = clip
    const file = join(outputDir, `${id}.mp4`)
    if (!existsSync(file) || !statSync(file).isFile()) {
      console.log(`FAIL ${id}: missing ${file}`)
      failures++
      continue
    }
    const expected = parseTime(clip.out) - parseTime(clip.in)
    const info = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,codec_type', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }))
    const duration = Number(info.format.duration)
    const diff = Math.abs(duration - expected)
    const video = info.streams.find(s => s.codec_type === 'video')?.codec_name
    const audio = info.streams.find(s => s.codec_type === 'audio')?.codec_name ?? '-'
    const head = readFileSync(file).subarray(0, 128 * 1024)
    const faststart = head.includes(Buffer.from('moov'))
    const ok = diff < 0.05 && video === 'h264' && faststart
    if (!ok)
      failures++
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name ? `[${name}] ` : ''}${String(id).padEnd(14)} dur=${duration.toFixed(3)}s (exp ${expected}s, diff ${diff.toFixed(3)}) | ${video}/${audio} | ${Math.round(info.format.size / 1024)}KB | faststart=${faststart}`)
  }
}

if (failures > 0) {
  console.log(`=== ${failures} FAILED ===`)
  process.exit(1)
}
console.log('=== ALL PASS ===')