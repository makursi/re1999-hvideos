#!/usr/bin/env node
/**
 * Verify exported clips against per-episode manifests.
 * Checks per clip id: file exists, duration ≈ expected (out - in, ±0.05s),
 * video codec is h264, and moov atom is at the front (faststart).
 *
 * Usage: node scripts/verify-exports.mjs [manifest.json] [exports-dir]
 *   - no args: scan media/exports per-episode manifest.json files (each in its own dir)
 *   - with a manifest path: single-file mode; second arg overrides its dir
 * Exits 1 on any mismatch. Requires ffprobe on PATH (or FFPROBE_BIN env).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FFPROBE = process.env.FFPROBE_BIN ?? 'ffprobe'
const manifestArg = process.argv[2]
const exportsDir = process.argv[3] ?? 'media/exports'

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

let manifests
if (manifestArg) {
  manifests = [{ name: '', manifestPath: manifestArg, manifest: loadManifest(manifestArg) }]
}
else {
  const names = readdirSync(exportsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(exportsDir, e.name, 'manifest.json')))
    .map(e => e.name)
  if (names.length === 0)
    throw new Error(`no manifests found under ${exportsDir}/<ep>/manifest.json`)
  manifests = names.map(name => ({
    name,
    manifestPath: join(exportsDir, name, 'manifest.json'),
    manifest: loadManifest(join(exportsDir, name, 'manifest.json')),
  }))
}

let failures = 0
for (const { name, manifestPath, manifest } of manifests) {
  const outDir = process.argv[3] ?? dirname(manifestPath)
  for (const clip of manifest.clips) {
    const { id } = clip
    const file = join(outDir, `${id}.mp4`)
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