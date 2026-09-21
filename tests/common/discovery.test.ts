import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverSpecs, discoverUnitDirs } from '../../src/common/discovery.js'

let cleanup: string[] = []

afterEach(() => {
  for (const dir of cleanup)
    rmSync(dir, { recursive: true, force: true })
  cleanup = []
})

function makeBase(): string {
  const base = mkdtempSync(join(tmpdir(), 're1999-disc-'))
  cleanup.push(base)
  return base
}

describe('discoverUnitDirs', () => {
  it('returns unit dirs that contain the spec file, numerically sorted', () => {
    const base = makeBase()
    for (const ep of ['ep2', 'ep10', 'ep1'])
      mkdirSync(join(base, ep), { recursive: true })
    writeFileSync(join(base, 'ep2', 'manifest.json'), '{}')
    writeFileSync(join(base, 'ep10', 'manifest.json'), '{}')
    writeFileSync(join(base, 'ep1', 'manifest.json'), '{}')
    // ep10 sorts after ep2 numerically, not lexically (ep10 < ep2 lexically)
    expect(discoverUnitDirs(base, 'manifest.json')).toEqual(['ep1', 'ep2', 'ep10'])
  })

  it('ignores dirs that do not contain the spec file', () => {
    const base = makeBase()
    mkdirSync(join(base, 'ep1'), { recursive: true })
    writeFileSync(join(base, 'ep1', 'manifest.json'), '{}')
    mkdirSync(join(base, 'ep5'), { recursive: true }) // no spec inside
    mkdirSync(join(base, 'unrelated'), { recursive: true })
    expect(discoverUnitDirs(base, 'manifest.json')).toEqual(['ep1'])
  })

  it('returns an empty list when the base dir is missing', () => {
    const base = makeBase()
    expect(discoverUnitDirs(join(base, 'nope'), 'manifest.json')).toEqual([])
  })
})

describe('discoverSpecs', () => {
  it('walks projects and units into spec paths, project-major with numeric units', () => {
    const base = makeBase()
    for (const [project, kind, unit] of [
      ['alpha', 'screenshots', 'ep2'],
      ['alpha', 'screenshots', 'ep10'],
      ['beta', 'clips', 'ep1'],
      ['alpha', 'clips', 'ep3'], // different kind, same project
    ] as const) {
      mkdirSync(join(base, project, kind, unit), { recursive: true })
    }
    writeFileSync(join(base, 'alpha', 'screenshots', 'ep2', 'frames.json'), '{}')
    writeFileSync(join(base, 'alpha', 'screenshots', 'ep10', 'frames.json'), '{}')
    writeFileSync(join(base, 'beta', 'clips', 'ep1', 'manifest.json'), '{}')
    // alpha/clips and movie-less projects have no spec for their kind
    expect(discoverSpecs(base, 'screenshots', 'frames.json')).toEqual([
      { project: 'alpha', unit: 'ep2', specPath: join(base, 'alpha', 'screenshots', 'ep2', 'frames.json') },
      { project: 'alpha', unit: 'ep10', specPath: join(base, 'alpha', 'screenshots', 'ep10', 'frames.json') },
    ])
    // alpha/clips has a dir but no spec file — its kind walk is skipped
    expect(discoverSpecs(base, 'clips', 'manifest.json')).toEqual([
      { project: 'beta', unit: 'ep1', specPath: join(base, 'beta', 'clips', 'ep1', 'manifest.json') },
    ])
  })

  it('ignores projects whose <kind> dir has no spec file', () => {
    const base = makeBase()
    mkdirSync(join(base, 'empty', 'clips', 'ep1'), { recursive: true }) // dir exists, no spec
    expect(discoverSpecs(base, 'clips', 'manifest.json')).toEqual([])
  })

  it('returns an empty list when the base dir is missing', () => {
    const base = makeBase()
    expect(discoverSpecs(join(base, 'nope'), 'clips', 'manifest.json')).toEqual([])
  })
})