import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'

export const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg'
export const FFPROBE_BIN = process.env.FFPROBE_BIN ?? 'ffprobe'

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