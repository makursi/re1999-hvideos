import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config, loadEnv } from '../../src/common/config.js'

const KEYS = ['RE1999_WORK_DIR', 'RE1999_OUTPUT_DIR', 'RE1999_TEMP_DIR', 'FFMPEG_BIN', 'FFPROBE_BIN'] as const

beforeEach(() => {
  for (const key of KEYS)
    delete process.env[key]
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('defaults', () => {
  it('falls back to the three-stage media/ layout when nothing is set', () => {
    expect(config.workDir).toBe('media/work')
    expect(config.outputDir).toBe('media/output')
    expect(config.tempDir).toBe('media/temp')
    expect(config.ffmpegBin).toBe('ffmpeg')
    expect(config.ffprobeBin).toBe('ffprobe')
  })
})

describe('env override', () => {
  it('shell env wins over the default', () => {
    vi.stubEnv('RE1999_WORK_DIR', '/data/work')
    vi.stubEnv('FFMPEG_BIN', '/usr/local/bin/ffmpeg')
    expect(config.workDir).toBe('/data/work')
    expect(config.ffmpegBin).toBe('/usr/local/bin/ffmpeg')
  })

  it('throws on an empty value', () => {
    vi.stubEnv('RE1999_OUTPUT_DIR', '')
    expect(() => config.outputDir).toThrow(/must not be empty/)
  })

  it('throws on a whitespace-only value', () => {
    vi.stubEnv('RE1999_TEMP_DIR', '   ')
    expect(() => config.tempDir).toThrow(/must not be empty/)
  })

  it('throws on a non-ASCII value', () => {
    vi.stubEnv('RE1999_WORK_DIR', '媒体/work')
    expect(() => config.workDir).toThrow(/must be ASCII/)
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
      writeFileSync(file, 'RE1999_WORK_DIR=media/work-x\nFFMPEG_BIN=custom-ff\n')
      loadEnv(file)
      expect(config.workDir).toBe('media/work-x')
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
      vi.stubEnv('RE1999_WORK_DIR', 'shell-wins')
      writeFileSync(file, 'RE1999_WORK_DIR=file-loses\n')
      loadEnv(file)
      expect(config.workDir).toBe('shell-wins')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a shell empty value still beats the .env file (and is rejected)', () => {
    const dir = mkdtempSync(join(tmpdir(), 're1999-env-'))
    const file = join(dir, '.env')
    try {
      vi.stubEnv('RE1999_OUTPUT_DIR', '')
      writeFileSync(file, 'RE1999_OUTPUT_DIR=file-value\n')
      loadEnv(file)
      expect(() => config.outputDir).toThrow(/must not be empty/)
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is a no-op when the .env file is absent', () => {
    expect(() => loadEnv('/definitely/missing/.env')).not.toThrow()
  })
})