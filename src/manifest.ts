import { readFileSync } from 'node:fs'
import { parseTimeToSeconds, type TimeInput } from './time.js'

const ASCII_RE = /^[A-Za-z0-9._-]+$/

export interface ClipSpec {
  id: string
  source: string
  in: TimeInput
  out: TimeInput
}

export interface Manifest {
  clips: ClipSpec[]
}

/** Completely static shape validation — no fs, no probe. Pure and testable. */
export function parseManifest(raw: unknown): Manifest {
  if (typeof raw !== 'object' || raw === null || !('clips' in raw))
    throw new Error('manifest must be an object with a "clips" array')

  const { clips } = raw as { clips: unknown }
  if (!Array.isArray(clips) || clips.length === 0)
    throw new Error('manifest.clips must be a non-empty array')

  const seen = new Set<string>()
  const parsed: ClipSpec[] = clips.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null)
      throw new Error(`clip[${i}]: expected an object`)
    const { id, source, in: input, out: output } = entry as Record<string, unknown>
    if (typeof id !== 'string' || id.trim() === '')
      throw new Error(`clip[${i}]: "id" must be a non-empty string`)
    if (!ASCII_RE.test(id))
      throw new Error(`clip[${i}]: "id" must be ASCII [A-Za-z0-9._-] (got "${id}")`)
    if (seen.has(id))
      throw new Error(`clip[${i}]: duplicate clip id "${id}"`)
    seen.add(id)
    if (typeof source !== 'string' || source.trim() === '')
      throw new Error(`clip[${i}]: "source" must be a non-empty string`)

    const start = parseTimeToSeconds(input as TimeInput)
    const end = parseTimeToSeconds(output as TimeInput)
    if (end <= start)
      throw new Error(`clip[${i}] ("${id}"): out (${end}s) must be greater than in (${start}s)`)

    return { id, source, in: input as TimeInput, out: output as TimeInput }
  })

  return { clips: parsed }
}

/** Parse + attach resolved seconds to each clip. */
export function resolveClipTimes(clip: ClipSpec): { start: number, end: number } {
  return { start: parseTimeToSeconds(clip.in), end: parseTimeToSeconds(clip.out) }
}

export function loadManifest(path: string): Manifest {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  }
  catch {
    throw new Error(`cannot read manifest: ${path}`)
  }
  try {
    return parseManifest(JSON.parse(text) as unknown)
  }
  catch (error) {
    throw new Error(`cannot parse manifest ${path}: ${(error as Error).message}`)
  }
}