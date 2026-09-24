import { parseTimeToSeconds, type TimeInput } from '../common/time.js'
import { loadSpec } from '../common/run-common.js'

/**
 * The `split` pipeline (ADR-0009 类 keyword, the audio-splitting twin of
 * `clips`/`screenshots`). A tracklist is the single source of truth for
 * cutting one audio source into consecutive songs (歌曲), each described by a
 * `start` timestamp — the moment the song begins — plus a `title` used as the
 * song's filename.
 *
 * The end of a song is never stored: it is derived from the next song's
 * `start`; the final song ends at the source's real duration (probeDuration
 * reads `format.duration`). This keeps the spec to a minimal fact set and
 * avoids two sources of truth for the same boundary.
 */

const ASCII_PATH_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/
// Song titles may contain spaces (and only ASCII); slashes/quotes/emoji/中
// 文 are rejected so the title maps 1:1 onto a filesystem-safe filename.
const TITLE_RE = /^[A-Za-z0-9._ -]+$/

export interface TrackSpec {
  start: TimeInput
  title: string
}

export interface Tracklist {
  source: string
  tracks: TrackSpec[]
}

/** A song with its time boundary resolved to seconds and its output filename. */
export interface ResolvedTrack {
  title: string
  start: number
  end: number
  filename: string
}

/** Completely static shape validation — no fs, no probe. Pure and testable. */
export function parseTracklist(raw: unknown): Tracklist {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('tracklist must be an object with "source" and "tracks"')

  const { source, tracks } = raw as { source?: unknown, tracks?: unknown }

  if (typeof source !== 'string' || source.trim() === '')
    throw new Error('tracklist "source" must be a non-empty string')
  if (!ASCII_PATH_RE.test(source))
    throw new Error(`tracklist "source" must be ASCII [A-Za-z0-9._-] path (got "${source}")`)

  if (!Array.isArray(tracks) || tracks.length === 0)
    throw new Error('tracklist.tracks must be a non-empty array')

  const parsed: TrackSpec[] = tracks.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null)
      throw new Error(`track[${i}]: expected an object`)
    const { start, title } = entry as Record<string, unknown>

    if (typeof title !== 'string' || title.trim() === '')
      throw new Error(`track[${i}]: "title" must be a non-empty string`)
    if (!TITLE_RE.test(title))
      throw new Error(`track[${i}] ("${title}"): "title" must be ASCII [A-Za-z0-9._ -] (got "${title}")`)

    parseTimeToSeconds(start as TimeInput)

    return { start: start as TimeInput, title }
  })

  return { source, tracks: parsed }
}

/**
 * Resolve every song's boundary to seconds. Each song ends where the next one
 * starts; the final song ends at the source's real duration. `starts` is
 * validated to be strictly increasing (non-overlapping, in-order), and the
 * final boundary must fall within the source duration.
 */
export function resolveTrackTimes(tracklist: Tracklist, sourceDuration: number): ResolvedTrack[] {
  const starts = tracklist.tracks.map(t => parseTimeToSeconds(t.start))
  for (let i = 1; i < starts.length; i++) {
    if (starts[i]! <= starts[i - 1]!)
      throw new Error(`track[${i}] (${tracklist.tracks[i]!.title}) starts at ${starts[i]}s, not after track[${i - 1}] (${starts[i - 1]}s); starts must be strictly increasing`)
  }
  if (starts.length > 0 && starts[starts.length - 1]! >= sourceDuration)
    throw new Error(`last track (${tracklist.tracks[starts.length - 1]!.title}) starts at ${starts[starts.length - 1]}s, not before source duration ${sourceDuration}s`)

  return tracklist.tracks.map((track, i) => {
    const start = starts[i]!
    const end = i + 1 < tracklist.tracks.length ? starts[i + 1]! : sourceDuration
    const filename = `${track.title}.m4a`
    return { title: track.title, start, end, filename }
  })
}

export function loadTracklist(path: string): Tracklist {
  return loadSpec(path, 'tracklist', parseTracklist)
}
