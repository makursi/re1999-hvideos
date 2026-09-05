/**
 * Auto-shift planning (ADR-0005).
 *
 * When a screenshot's `at` lands on a solid frame (black gap / white strobe),
 * snap re-targets the nearest valid frame AFTER `at` — black gaps and strobes
 * finish and content resumes further in (measured on ep01: black gap ends at
 * 165.00 with content at +0.04s; white strobes recur every ~0.24s). The search
 * is deterministic: frame by frame, from at+1 frame to the window bound, and
 * returns the FIRST valid frame — never a far-away one.
 */

/** Auto-shift window: at most this many frames after `at` (≈2.56s at 25fps). */
export const SHIFT_MAX_FRAMES = 64

/** Project source frame rate (all ep01..ep07 are 1080p25). */
export const PROJECT_FPS = 25

export interface ShiftResult {
  /** Frame offset from `at` (1-based) at which the first valid frame sits. */
  frames: number
  /** Absolute timestamp of that frame. */
  time: number
}

/**
 * Window-truncation sentinel shared with the probing side (snap.ts): the probe
 * predicate throws it when the candidate frame does not exist (the window ran
 * past the source end), so the search aborts instead of judging a non-frame
 * "valid" or silently outputting a far-away frame.
 */
export class WindowEndError extends Error {
  constructor() {
    super('search window ended before a valid frame (source end)')
    this.name = 'WindowEndError'
  }
}

/**
 * Frame-by-frame forward search for the first valid frame within the window.
 * `isSolid(FramesAfterAt, absoluteTime)` is injected so the search stays pure
 * and fps-agnostic at extraction time (frame indices, not timestamps, drive
 * the probing); it may be async (snap.ts probes image files per frame) or
 * synchronous (unit tests). Returns null when the whole window is solid;
 * throws WindowEndError when the predicate says the window ran out of frames.
 */
export async function firstValidFrame(
  at: number,
  isSolid: (frames: number, time: number) => boolean | Promise<boolean>,
  maxFrames: number = SHIFT_MAX_FRAMES,
  fps: number = PROJECT_FPS,
): Promise<ShiftResult | null> {
  for (let frames = 1; frames <= maxFrames; frames++) {
    const time = at + frames / fps
    if (!(await isSolid(frames, time)))
      return { frames, time }
  }
  return null
}

export type ExtractionPlan =
  | { kind: 'direct' }
  | { kind: 'shift', frames: number, time: number }
  | { kind: 'error', reason: string }

/**
 * Decide what to do for one screenshot entry (ADR-0005 policy):
 * - `at` itself is valid            -> direct
 * - solid `at`, strict mode         -> error (judged-bad means per-entry error)
 * - solid `at`, auto-shift on       -> shift to the first valid frame
 * - solid `at`, window exhausted    -> error (never silently output a far frame)
 * Pure: `search` is injected (wired to real probing in snap.ts).
 */
export function planExtraction(
  atSolid: boolean,
  strict: boolean,
  search: () => ShiftResult | null,
): ExtractionPlan {
  if (!atSolid)
    return { kind: 'direct' }
  if (strict)
    return { kind: 'error', reason: 'strict mode: at is a solid frame' }
  const found = search()
  if (found)
    return { kind: 'shift', ...found }
  return {
    kind: 'error',
    reason: `no valid frame within ${SHIFT_MAX_FRAMES}-frame window after at`,
  }
}