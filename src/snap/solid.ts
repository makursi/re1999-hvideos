/**
 * Solid-frame detection (ADR-0005).
 *
 * A solid frame is a no-content frame whose pixels are almost entirely one
 * brightness: black gap (YAVG ≈ 0 via jpeg), white strobe (YAVG ≈ 255).
 * Two signals, both required:
 *   - extreme mean brightness (YAVG), and
 *   - luminance uniformity. ADR-0005 names the standard deviation (YSTD);
 *     this ffmpeg build's `signalstats` does not emit YSTD, so uniformity is
 *     measured as YMAX - YMIN (entire-frame-same pixels ⇔ ≈ 0).
 * Measured on ep01 (jpeg file probes): black 165.00 → (0, 0, 0), white
 * 331.00 → (255, 255, 255), content 165.16/331.08 → YAVG 138/89.5, range 255.
 */

export const SOLID_YAVG_LOW = 20
export const SOLID_YAVG_HIGH = 235
export const SOLID_RANGE_MAX = 16

export interface FrameStats {
  yavg: number
  ymin: number
  ymax: number
}

export function isSolidFrame({ yavg, ymin, ymax }: FrameStats): boolean {
  const extreme = yavg <= SOLID_YAVG_LOW || yavg >= SOLID_YAVG_HIGH
  const uniform = ymax - ymin <= SOLID_RANGE_MAX
  return extreme && uniform
}