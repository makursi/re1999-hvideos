import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config, loadEnv } from '../../src/common/config.js'

const KEYS = ['RE1999_EXPORTS_DIR', 'RE1999_SCREENSHOTS_DIR', 'RE1999_TEMP_DIR', 'FFMPEG_BIN', 'FFPROBE_BIN'] as const

beforeEach(() => {
  for (const key of KEYS)
    delete process.env[key]
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('defaults', () => {
  it('falls back to the classic media/ layout when nothing is set', () => {
    expect(config.exportsDir).toBe('media/exports')
    expect(config.screenshotsDir).toBe('media/screenshots')
    expect(config.tempDir).toBe('media/temp')
    expect(config.ffmpegBin).toBe('ffmpeg')
    expect(config.ffprobeBin).toBe('ffprobe')
  })
})

describe('env override', () => {
  it('shell env wins over the default', () => {
    vi.stubEnv('RE1999_EXPORTS_DIR', '/data/out')
    vi.stubEnv('FFMPEG_BIN', '/usr/local/bin/ffmpeg')
    expect(config.exportsDir).toBe('/data/out')
    expect(config.ffmpegBin).toBe('/usr/local/bin/ffmpeg')
  })

  it('throws on an empty value', () => {
    vi.stubEnv('RE1999_EXPORTS_DIR', '')
    expect(() => config.exportsDir).toThrow(/must not be empty/)
  })

  it('throws on a whitespace-only value', () => {
    vi.stubEnv('RE1999_TEMP_DIR', '   ')
    expect(() => config.tempDir).toThrow(/must not be empty/)
  })

  it('throws on a non-ASCII value', () => {
    vi.stubEnv('RE1999_EXPORTS_DIR', '媒体/exports')
    expect(() => config.exportsDir).toThrow(/must be ASCII/)
  })

  it('rejects an empty FFMPEG_BIN', () => {
    vi.stubEnv('FFMPEG_BIN', '')
    expect(() => config.ffmpegBin).toThrow(/must not be empty/)
  })

  it('rejects a non-ASCII FFMPEG_BIN', () => {
    vi.stubEnv('FFMPEG_BIN', '我的-ff')
    expect(() => config.ffmpegBin).toThrow(/must be ASCII/)
  })
})

describe('loadEnv', () => {
  it('loads a present .env and lets its values flow into config', () => {
    const dir = mkdtempSync(join(tmpdir(), 're1999-env-'))
    const file = join(dir, '.env')
    try {
      writeFileSync(file, 'RE1999_TEMP_DIR=media/tmp-x\nFFMPEG_BIN=custom-ff\n')
      loadEnv(file)
      expect(config.tempDir).toBe('media/tmp-x')
      expect(config.ffmpegBin).toBe('custom-ff')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('shell env beats the .env file (Node loadEnvFile semantics)', () => {
    const dir = mkdtempSync(join(tmpdir(), 're1999-env-'))
    const file = join(dir, '.env')
    try {
      vi.stubEnv('RE1999_TEMP_DIR', 'shell-wins')
      writeFileSync(file, 'RE1999_TEMP_DIR=file-loses\n')
      loadEnv(file)
      expect(config.tempDir).toBe('shell-wins')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a shell empty value still beats the .env file (and is rejected)', () => {
    const dir = mkdtempSync(join(tmpdir(), 're1999-env-'))
    const file = join(dir, '.env')
    try {
      vi.stubEnv('RE1999_TEMP_DIR', '')
      writeFileSync(file, 'RE1999_TEMP_DIR=file-value\n')
      loadEnv(file)
      expect(() => config.tempDir).toThrow(/must not be empty/)
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is a no-op when the .env file is absent', () => {
    expect(() => loadEnv('/definitely/missing/.env')).not.toThrow()
  })
})