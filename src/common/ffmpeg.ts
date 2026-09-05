import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import type { FrameFormat } from '../snap/framespec.js'
import type { FrameStats } from '../snap/solid.js'

export const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg'
export const FFPROBE_BIN = process.env.FFPROBE_BIN ?? 'ffprobe'

/** Per-format quality defaults (jpg: mjpeg qscale 2 = highest, webp: lossy 90). */
const FRAME_IMAGE_OPTS: Record<FrameFormat, string[]> = {
  jpg: ['-q:v', '2'],
  png: [],
  webp: ['-quality', '90'],
}

export interface EncodeOptions {
  copy: boolean
  crf: number
  preset: string
}

export function probeDuration(source: string): number {
  const out = execFileSync(
    FFPROBE_BIN,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', source],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  )
  const { format } = JSON.parse(out) as { format?: { duration?: string } }
  const duration = Number(format?.duration)
  if (!Number.isFinite(duration))
    throw new Error(`cannot probe duration of ${source}`)
  return duration
}

export function buildFfmpegArgs(
  source: string,
  start: number,
  duration: number,
  output: string,
  options: EncodeOptions,
): string[] {
  const base = ['-y', '-loglevel', 'error', '-ss', String(start), '-i', source, '-t', String(duration)]
  if (options.copy) {
    return [...base, '-c', 'copy', output]
  }
  return [
    ...base,
    '-c:v', 'libx264',
    '-preset', options.preset,
    '-crf', String(options.crf),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    output,
  ]
}

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0)
        resolve()
      else
        reject(new Error(`ffmpeg exited with code ${code}`))
    })
  })
}

const STATS_RE = /signalstats\.(YAVG|YMIN|YMAX)=([0-9.]+)/g

/**
 * Parse `signalstats,metadata=print` output (stderr or file) into the
 * luminance signals isSolidFrame judges on. Last occurrence wins — a single
 * probed image can emit its metadata twice.
 */
export function parseSignalStats(probeText: string): FrameStats {
  const stats: Partial<FrameStats> = {}
  for (const m of probeText.matchAll(STATS_RE)) {
    const key = m[1] as 'YAVG' | 'YMIN' | 'YMAX'
    const value = Number(m[2])
    if (key === 'YAVG')
      stats.yavg = value
    else if (key === 'YMIN')
      stats.ymin = value
    else
      stats.ymax = value
  }
  if (stats.yavg === undefined || stats.ymin === undefined || stats.ymax === undefined)
    throw new Error('ffmpeg signalstats produced no YAVG/YMIN/YMAX')
  return { yavg: stats.yavg, ymin: stats.ymin, ymax: stats.ymax }
}

/** Probe one image file for luminance stats via a single signalstats pass. */
export async function probeImageStats(imagePath: string): Promise<FrameStats> {
  const args = [
    '-y',
    '-loglevel', 'info',
    '-i', imagePath,
    '-vf', 'signalstats,metadata=print',
    '-f', 'null',
    '-',
  ]
  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stderr.on('data', (chunk: Buffer) => { out += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0)
        resolve(out)
      else
        reject(new Error(`ffmpeg probe exited with code ${code} for ${imagePath}`))
    })
  })
  return parseSignalStats(stderr)
}

/**
 * Extract `count` consecutive frame-exact frames starting at `at` in ONE decode
 * pass (`count=1` reproduces the ADR-0004 single-frame extraction). `-ss` stays after `-i` (output seek, ADR-0004) and there is NO filter
 * graph: on this ffmpeg build (n9.0.1) combining the output seek with a
 * filter (`even metadata=print`) makes ffmpeg decode from the stream start and
 * emit wrong frames (measured 4127+ frames / 17-37s). The plain extract stays
 * frame-exact and image2 numbers outputs sequentially (pattern %02d):
 * f-01 = the frame at `at`, f-(k+1) = the k-th frame after `at`.
 */
export function buildSequenceArgs(
  source: string,
  at: number,
  count: number,
  format: FrameFormat,
  pattern: string,
): string[] {
  return [
    '-y',
    '-loglevel', 'error',
    '-i', source,
    '-ss', String(at),
    '-frames:v', String(count),
    ...FRAME_IMAGE_OPTS[format],
    pattern,
  ]
}