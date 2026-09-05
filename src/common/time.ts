export type TimeInput = string | number

const TIME_RE = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/
const SECONDS_RE = /^\d+(?:\.\d+)?$/

/**
 * Parse a time value into seconds.
 * Accepts: number (seconds), "123.5" (seconds), "MM:SS[.mmm]", "HH:MM:SS[.mmm]".
 */
export function parseTimeToSeconds(value: TimeInput): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`invalid seconds: ${value}`)
    return value
  }

  const s = value.trim()
  if (SECONDS_RE.test(s))
    return Number(s)

  const m = TIME_RE.exec(s)
  if (!m)
    throw new Error(`invalid time "${value}" (expected [H:]MM:SS[.mmm] or seconds)`)

  const hours = Number(m[1] ?? 0)
  const minutes = Number(m[2])
  const seconds = Number(m[3])
  const fraction = m[4] ? Number(`0.${m[4]}`) : 0

  if (minutes >= 60 || seconds >= 60)
    throw new Error(`invalid time "${value}": minutes/seconds out of range`)

  return hours * 3600 + minutes * 60 + seconds + fraction
}

/** Format seconds as HH:MM:SS.mmm (trimmed fraction). */
export function formatSeconds(seconds: number): string {
  const whole = Math.floor(seconds)
  const frac = Math.round((seconds - whole) * 1000)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  const base = `${pad(h)}:${pad(m)}:${pad(s)}`
  return frac === 0 ? base : `${base}.${frac.toString().padStart(3, '0')}`
}