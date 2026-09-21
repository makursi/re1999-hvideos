import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectUnits, defaultProductDir, elapsedSeconds, loadSpec, makeListAction, mirrorSpecDirToOutput, probeSourceDurations, wrapAction } from '../../src/common/run-common.js'

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

describe('collectUnits', () => {
  it('collects every unit across projects (project-major, units numeric), or filters by project/unit', () => {
    const base = makeBase()
    for (const [project, kind, unit] of [
      ['alpha', 'clips', 'ep2'],
      ['alpha', 'clips', 'ep10'],
      ['beta', 'clips', 'ep1'],
    ] as const) {
      mkdirSync(join(base, project, kind, unit), { recursive: true })
      writeFileSync(join(base, project, kind, unit, 'manifest.json'), '{}')
    }

    const all = collectUnits(base, 'clips', 'manifest.json', loadPath, { kind: 'manifests' })
    expect(all.map(e => `${e.project}/${e.name}`)).toEqual(['alpha/ep2', 'alpha/ep10', 'beta/ep1'])

    const oneProject = collectUnits(base, 'clips', 'manifest.json', loadPath, { project: 'beta', kind: 'manifests' })
    expect(oneProject.map(e => `${e.project}/${e.name}`)).toEqual(['beta/ep1'])

    const oneUnit = collectUnits(base, 'clips', 'manifest.json', loadPath, { unit: 'ep10', kind: 'manifests' })
    expect(oneUnit.map(e => `${e.project}/${e.name}`)).toEqual(['alpha/ep10'])
    expect(oneUnit[0]!.specPath).toBe(join(base, 'alpha', 'clips', 'ep10', 'manifest.json'))
    expect(oneUnit[0]!.loaded).toBe(join(base, 'alpha', 'clips', 'ep10', 'manifest.json'))
  })

  it('throws when the selected project, unit, or the base dir has no specs', () => {
    const base = makeBase()
    mkdirSync(join(base, 'alpha', 'clips', 'ep1'), { recursive: true })
    writeFileSync(join(base, 'alpha', 'clips', 'ep1', 'manifest.json'), '{}')

    expect(() => collectUnits(base, 'clips', 'manifest.json', loadPath, { project: 'nope', kind: 'manifests' }))
      .toThrow(/project not found/)
    expect(() => collectUnits(base, 'clips', 'manifest.json', loadPath, { unit: 'ep9', kind: 'manifests' }))
      .toThrow(/unit not found/)
    expect(() => collectUnits(join(base, 'empty'), 'clips', 'manifest.json', loadPath, { kind: 'manifests' }))
      .toThrow(/no manifests found/)
  })

  it('explicit mode loads one spec file, --unit and --project winning over the fallbacks', () => {
    const base = makeBase()
    const specPath = join(base, 'frames.json')
    writeFileSync(specPath, '{}')

    const unnamed = collectUnits(base, 'screenshots', 'frames.json', loadPath, { explicitPath: specPath, kind: 'frames specs' })
    expect(unnamed).toHaveLength(1)
    expect(unnamed[0]!.specPath).toBe(specPath)
    expect(unnamed[0]!.project).toBe('explicit')
    expect(unnamed[0]!.name).toBe('explicit')

    const named = collectUnits(base, 'screenshots', 'frames.json', loadPath, { explicitPath: specPath, project: '1999', unit: 'ep3', kind: 'frames specs' })
    expect(named[0]!.project).toBe('1999')
    expect(named[0]!.name).toBe('ep3')
  })
})

describe('mirrorSpecDirToOutput', () => {
  it('mirrors a spec path under the work root to the output root (work -> output)', () => {
    expect(mirrorSpecDirToOutput('media/work/1999/screenshots/ep1/frames.json', 'media/work', 'media/output'))
      .toBe('media/output/1999/screenshots/ep1')
    expect(mirrorSpecDirToOutput('media/work/movie-y/clips/ep2/manifest.json', 'media/work', 'media/output'))
      .toBe('media/output/movie-y/clips/ep2')
  })

  it('keeps nested unit names intact', () => {
    expect(mirrorSpecDirToOutput('media/work/1999/screenshots/ep10/frames.json', 'media/work', 'media/output'))
      .toBe('media/output/1999/screenshots/ep10')
  })

  it('throws when the spec sits outside the work root', () => {
    expect(() => mirrorSpecDirToOutput('media/other/manifest.json', 'media/work', 'media/output'))
      .toThrow(/outside the work root/)
  })
})

describe('defaultProductDir', () => {
  it('mirrors specs inside the work root and falls back to the spec dir otherwise', () => {
    expect(defaultProductDir('media/work/1999/clips/ep1/manifest.json', 'media/work', 'media/output'))
      .toBe('media/output/1999/clips/ep1')
    // explicit single-file mode with an arbitrary path keeps the legacy default
    expect(defaultProductDir('/abs/path/frames.json', 'media/work', 'media/output'))
      .toBe('/abs/path')
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
  it('prints specs grouped by project then unit via the injected describer', () => {
    const base = makeBase()
    for (const unit of ['ep1', 'ep2']) {
      mkdirSync(join(base, '1999', 'screenshots', unit), { recursive: true })
      writeFileSync(join(base, '1999', 'screenshots', unit, 'frames.json'), '{}')
    }

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      makeListAction('snap', () => base, 'screenshots', 'frames.json', () => `no frames specs found under ${base}`, () => '3 screenshot(s)')()
      expect(log).toHaveBeenNthCalledWith(1, '[snap]')
      expect(log).toHaveBeenNthCalledWith(2, '  1999:')
      expect(log).toHaveBeenNthCalledWith(3, '    ep1: 3 screenshot(s)')
      expect(log).toHaveBeenNthCalledWith(4, '    ep2: 3 screenshot(s)')
    }
    finally {
      log.mockRestore()
    }
  })

  it('prints the empty message when no specs exist', () => {
    const base = makeBase()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      makeListAction('clip', () => base, 'clips', 'manifest.json', () => `no manifests found under ${base}`, () => '0 clip(s)')()
      expect(log).toHaveBeenCalledWith(`[clip] no manifests found under ${base}`)
    }
    finally {
      log.mockRestore()
    }
  })

  it('reports a per-unit ERROR when the describer throws', () => {
    const base = makeBase()
    mkdirSync(join(base, '1999', 'screenshots', 'ep1'), { recursive: true })
    writeFileSync(join(base, '1999', 'screenshots', 'ep1', 'frames.json'), '{}')

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      makeListAction('snap', () => base, 'screenshots', 'frames.json', () => `no frames specs found under ${base}`, () => {
        throw new Error('bad spec')
      })()
      expect(log).toHaveBeenNthCalledWith(1, '[snap]')
      expect(log).toHaveBeenNthCalledWith(2, '  1999:')
      expect(log).toHaveBeenNthCalledWith(3, '    ep1: ERROR (bad spec)')
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