import { existsSync } from 'node:fs'

/**
 * Environment-driven configuration surface (ADR-0007, revised by ADR-0009).
 *
 * The whole config surface is exactly five knobs: the three-stage media roots
 * — spec scan base (`RE1999_WORK_DIR`), product default root
 * (`RE1999_OUTPUT_DIR`) and temp workspace (`RE1999_TEMP_DIR`) — plus the
 * ffmpeg/ffprobe binaries (kept under their widely-known unprefixed names).
 * There is deliberately no input knob: raw `source` paths in the versioned
 * spec JSONs are data, not configuration (plugins live under
 * `media/input/<project>` per ADR-0009). Domain constants — 25 fps, shift
 * window, solid-frame thresholds, the ASCII path rule — are domain truth (see
 * CONTEXT.md), never configuration.
 *
 * Values are read lazily through getters so `loadEnv()` can run first in
 * main.ts, and tests can inject via `vi.stubEnv` without touching the real
 * environment. Precedence: CLI flags > environment (shell beats .env —
 * `process.loadEnvFile` never overrides an already-set variable) > defaults.
 */
export function loadEnv(path = '.env'): void {
  if (existsSync(path))
    process.loadEnvFile(path)
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name]
  if (raw === undefined)
    return fallback
  if (raw.trim() === '')
    throw new Error(`config error: ${name} must not be empty`)
  if (hasNonAscii(raw))
    throw new Error(`config error: ${name} must be ASCII (non-ASCII pipeline paths break ffprobe/Node tooling)`)
  return raw
}

function hasNonAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x7F)
      return true
  }
  return false
}

/** The env-driven configuration surface (ADR-0007). */
export const config = {
  /**
   * Spec scan root: per-project spec trees live under
   * `<workDir>/<project>/<clips|screenshots>/<unit>/` (clip run/list and
   * snap run/list discovery, ADR-0009).
   */
  get workDir(): string {
    return envString('RE1999_WORK_DIR', 'media/work')
  },
  /**
   * Default product root: products land at `<outputDir>/<project>/<clips|screenshots>/<unit>/`,
   * mirroring the spec path under the work root (ADR-0009). Explicit `dir` /
   * `-o` overrides still win.
   */
  get outputDir(): string {
    return envString('RE1999_OUTPUT_DIR', 'media/output')
  },
  /** Snap probe workspace root (per-shot temp dirs live under it). */
  get tempDir(): string {
    return envString('RE1999_TEMP_DIR', 'media/temp')
  },
  get ffmpegBin(): string {
    return envString('FFMPEG_BIN', 'ffmpeg')
  },
  get ffprobeBin(): string {
    return envString('FFPROBE_BIN', 'ffprobe')
  },
}