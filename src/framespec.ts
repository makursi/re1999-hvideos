import { readFileSync } from 'node:fs'
import { parseTimeToSeconds, type TimeInput } from './time.js'

export const FRAME_FORMATS = ['jpg', 'png', 'webp'] as const
export type FrameFormat = typeof FRAME_FORMATS[number]

const ASCII_RE = /^[A-Za-z0-9._-]+$/
const ASCII_PATH_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/

export interface FrameSpec {
  id: string
  source: string
  at: TimeInput
  format: FrameFormat
  /** Output directory override; defaults to the spec file's own directory. */
  dir?: string
}

export interface FramesSpec {
  screenshots: FrameSpec[]
}

/** Completely static shape validation — no fs, no probe. Pure and testable. */
export function parseFrameSpec(raw: unknown): FramesSpec {
  if (typeof raw !== 'object' || raw === null || !('screenshots' in raw))
    throw new Error('frames spec must be an object with a "screenshots" array')

  const { screenshots } = raw as { screenshots: unknown }
  if (!Array.isArray(screenshots) || screenshots.length === 0)
    throw new Error('frames spec.screenshots must be a non-empty array')

  const seen = new Set<string>()
  const parsed: FrameSpec[] = screenshots.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null)
      throw new Error(`screenshot[${i}]: expected an object`)
    const { id, source, at, format, dir } = entry as Record<string, unknown>

    if (typeof id !== 'string' || id.trim() === '')
      throw new Error(`screenshot[${i}]: "id" must be a non-empty string`)
    if (!ASCII_RE.test(id))
      throw new Error(`screenshot[${i}]: "id" must be ASCII [A-Za-z0-9._-] (got "${id}")`)
    if (seen.has(id))
      throw new Error(`screenshot[${i}]: duplicate screenshot id "${id}"`)
    seen.add(id)

    if (typeof source !== 'string' || source.trim() === '')
      throw new Error(`screenshot[${i}] ("${id}"): "source" must be a non-empty string`)
    if (!ASCII_PATH_RE.test(source))
      throw new Error(`screenshot[${i}] ("${id}"): "source" must be ASCII [A-Za-z0-9._-] path (got "${source}")`)

    if (typeof format !== 'string' || !(FRAME_FORMATS as readonly string[]).includes(format))
      throw new Error(`screenshot[${i}] ("${id}"): "format" must be one of ${FRAME_FORMATS.join(', ')} (got "${String(format)}")`)

    parseTimeToSeconds(at as TimeInput)

    if (dir !== undefined) {
      if (typeof dir !== 'string' || dir.trim() === '')
        throw new Error(`screenshot[${i}] ("${id}"): "dir" must be a non-empty string when present`)
      if (!ASCII_PATH_RE.test(dir))
        throw new Error(`screenshot[${i}] ("${id}"): "dir" must be ASCII [A-Za-z0-9._-] path (got "${dir}")`)
    }

    return {
      id,
      source,
      at: at as TimeInput,
      format: format as FrameFormat,
      ...(dir !== undefined ? { dir } : {}),
    }
  })

  return { screenshots: parsed }
}

/** Resolve a screenshot entry to its absolute time and output path. */
export function resolveFrameEntry(
  entry: FrameSpec,
  specDir: string,
): { at: number, output: string } {
  const at = parseTimeToSeconds(entry.at)
  const outDir = entry.dir ?? specDir
  return { at, output: `${outDir}/${entry.id}.${entry.format}` }
}

export function loadFrameSpec(path: string): FramesSpec {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  }
  catch {
    throw new Error(`cannot read frames spec: ${path}`)
  }
  try {
    return parseFrameSpec(JSON.parse(text) as unknown)
  }
  catch (error) {
    throw new Error(`cannot parse frames spec ${path}: ${(error as Error).message}`)
  }
}