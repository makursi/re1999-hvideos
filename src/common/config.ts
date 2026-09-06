import { existsSync } from 'node:fs'

/**
 * Environment-driven configuration surface (ADR-0007).
 *
 * The whole config surface is exactly five knobs: the spec scan bases and
 * temp workspace (`RE1999_*`) plus the ffmpeg/ffprobe binaries (kept under
 * their widely-known unprefixed names). Domain constants — 25 fps, shift
 * window, solid-frame thresholds, epNN naming, the ASCII path rule — are
 * domain truth (see CONTEXT.md), never configuration. Raw `source` paths in
 * the versioned spec JSONs are data, not configuration either.
 *
 * Values are read lazily through getters so `loadEnv()` can run first in
 * main.ts, and tests can inject via `vi.stubEnv` without touching the real
 * environment. Precedence (Q6): CLI flags > environment (shell beats .env —
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
  /** Scan base for per-episode manifests (clip list/run discovery). */
  get exportsDir(): string {
    return envString('RE1999_EXPORTS_DIR', 'media/exports')
  },
  /** Scan base for per-episode frames specs (snap list/run discovery). */
  get screenshotsDir(): string {
    return envString('RE1999_SCREENSHOTS_DIR', 'media/screenshots')
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