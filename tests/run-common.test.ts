import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectEpisodes, elapsedSeconds, loadSpec, makeListAction, probeSourceDurations, wrapAction } from '../src/run-common.js'

let cleanup: string[] = []

afterEach(() => {
  for (const dir of cleanup)
    rmSync(dir, { recursive: true, force: true })
  cleanup = []
})

function makeBase(): string {
  const base = mkdtempSync(join(tmpdir(), 're1999-common-'))
  cleanup.push(base)
  return base
}

/** Stub loader that echoes the path, so assertions see which specs were loaded. */
const loadPath = (path: string): string => path

describe('collectEpisodes', () => {
  it('collects every episode containing the spec file, or only the --ep selection', () => {
    const base = makeBase()
    for (const ep of ['ep2', 'ep1']) {
      mkdirSync(join(base, ep), { recursive: true })
      writeFileSync(join(base, ep, 'frames.json'), '{}')
    }

    const all = collectEpisodes(base, 'frames.json', loadPath, { kind: 'frames specs' })
    expect(all.map(e => e.name)).toEqual(['ep1', 'ep2'])

    const one = collectEpisodes(base, 'frames.json', loadPath, { ep: 'ep2', kind: 'frames specs' })
    expect(one.map(e => e.name)).toEqual(['ep2'])
    expect(one[0]!.specPath).toBe(join(base, 'ep2', 'frames.json'))
    expect(one[0]!.loaded).toBe(join(base, 'ep2', 'frames.json'))
  })

  it('throws when the selected episode or the base dir has no specs', () => {
    const base = makeBase()
    mkdirSync(join(base, 'ep1'), { recursive: true })
    writeFileSync(join(base, 'ep1', 'manifest.json'), '{}')

    expect(() => collectEpisodes(base, 'manifest.json', loadPath, { ep: 'ep9', kind: 'manifests' }))
      .toThrow(/episode not found/)
    expect(() => collectEpisodes(join(base, 'empty'), 'manifest.json', loadPath, { kind: 'manifests' }))
      .toThrow(/no manifests found/)
  })

  it('explicit mode loads one spec file, --ep winning over the name fallback', () => {
    const base = makeBase()
    const specPath = join(base, 'frames.json')
    writeFileSync(specPath, '{}')

    const unnamed = collectEpisodes(base, 'frames.json', loadPath, { explicitPath: specPath, kind: 'frames specs' })
    expect(unnamed).toHaveLength(1)
    expect(unnamed[0]!.specPath).toBe(specPath)
    expect(unnamed[0]!.name).toBe('explicit')

    const named = collectEpisodes(base, 'frames.json', loadPath, { explicitPath: specPath, ep: 'ep3', kind: 'frames specs' })
    expect(named[0]!.name).toBe('ep3')
  })
})

describe('probeSourceDurations', () => {
  it('probes each distinct source exactly once, even when repeated', () => {
    const base = makeBase()
    const a = join(base, 'a.mp4')
    const b = join(base, 'b.mp4')
    writeFileSync(a, 'x')
    writeFileSync(b, 'x')

    const probes: string[] = []
    const durations = probeSourceDurations([{ source: a }, { source: b }, { source: a }], (src) => {
      probes.push(src)
      return 10
    }, 'source')

    expect(durations.get(a)).toBe(10)
    expect(durations.get(b)).toBe(10)
    expect(probes).toEqual([a, b])
  })

  it('throws with the caller noun when a source is missing', () => {
    const base = makeBase()
    const missing = join(base, 'nope.mp4')
    expect(() => probeSourceDurations([{ source: missing }], () => 0, 'screenshot source'))
      .toThrow(`screenshot source not found: ${missing}`)
  })
})

describe('loadSpec', () => {
  it('reads + JSON.parses + parses a spec file', () => {
    const base = makeBase()
    const path = join(base, 'manifest.json')
    writeFileSync(path, '{"clips": []}')

    const parsed = loadSpec(path, 'manifest', raw => ({ raw }))
    expect(parsed).toEqual({ raw: { clips: [] } })
  })

  it('wraps invalid JSON and unreadable files with the kind and path', () => {
    const base = makeBase()
    const badJson = join(base, 'broken.json')
    writeFileSync(badJson, '{oops')
    expect(() => loadSpec(badJson, 'manifest', () => ({ raw: [] })))
      .toThrow(/cannot parse manifest/)

    const missing = join(base, 'missing.json')
    expect(() => loadSpec(missing, 'frames spec', () => ({ raw: [] })))
      .toThrow(/cannot read frames spec/)
  })
})

describe('makeListAction', () => {
  it('prints one line per discovered spec via the injected describer', () => {
    const base = makeBase()
    mkdirSync(join(base, 'ep1'), { recursive: true })
    writeFileSync(join(base, 'ep1', 'frames.json'), '{}')

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      makeListAction('snap', base, 'frames.json', `no frames specs found under ${base}`, () => '3 screenshot(s)')()
      expect(log).toHaveBeenCalledWith('  ep1: 3 screenshot(s)')
    }
    finally {
      log.mockRestore()
    }
  })

  it('prints the empty message when no specs exist', () => {
    const base = makeBase()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      makeListAction('clip', base, 'manifest.json', `no manifests found under ${base}`, () => '0 clip(s)')()
      expect(log).toHaveBeenCalledWith(`[clip] no manifests found under ${base}`)
    }
    finally {
      log.mockRestore()
    }
  })

  it('reports a per-episode ERROR when the describer throws', () => {
    const base = makeBase()
    mkdirSync(join(base, 'ep1'), { recursive: true })
    writeFileSync(join(base, 'ep1', 'frames.json'), '{}')

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      makeListAction('snap', base, 'frames.json', `no frames specs found under ${base}`, () => {
        throw new Error('bad spec')
      })()
      expect(log).toHaveBeenCalledWith('  ep1: ERROR (bad spec)')
    }
    finally {
      log.mockRestore()
    }
  })
})

describe('wrapAction', () => {
  it('runs the action through and leaves the exit code unchanged on success', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prev = process.exitCode
    process.exitCode = 0
    try {
      await wrapAction('clip', async () => {})
      expect(process.exitCode).toBe(0)
      expect(error).not.toHaveBeenCalled()
    }
    finally {
      error.mockRestore()
      process.exitCode = prev
    }
  })

  it('reports the tag and sets a non-zero exit code on failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prev = process.exitCode
    process.exitCode = 0
    try {
      await wrapAction('snap', async () => {
        throw new Error('boom')
      })
      expect(error).toHaveBeenCalledWith('[snap] error: boom')
      expect(process.exitCode).toBe(1)
    }
    finally {
      error.mockRestore()
      process.exitCode = prev
    }
  })
})

describe('elapsedSeconds', () => {
  it('formats elapsed milliseconds as seconds with one decimal', () => {
    expect(elapsedSeconds(Date.now() - 1234)).toBe('1.2')
    expect(elapsedSeconds(Date.now() - 2500)).toBe('2.5')
    const started = Date.now()
    expect(elapsedSeconds(started)).toBe('0.0')
  })
})