import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import type { FrameFormat } from './framespec.js'

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

/**
 * Extract one frame at an exact timestamp.
 * `-ss` is placed AFTER `-i` (output seek): decode from the previous keyframe to
 * the exact frame. Input seek (-ss before -i) would snap to a keyframe up to
 * ~7s away (ADR-0001 fact: GOP 4-7s) — unacceptable for screenshots.
 */
export function buildFrameArgs(
  source: string,
  at: number,
  output: string,
  format: FrameFormat,
): string[] {
  return [
    '-y',
    '-loglevel', 'error',
    '-i', source,
    '-ss', String(at),
    '-frames:v', '1',
    ...FRAME_IMAGE_OPTS[format],
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