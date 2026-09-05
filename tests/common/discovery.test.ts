import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverEpisodeDirs } from '../../src/common/discovery.js'

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

describe('discoverEpisodeDirs', () => {
  it('returns episode dirs that contain the spec file, numerically sorted', () => {
    const base = makeBase()
    for (const ep of ['ep2', 'ep10', 'ep1'])
      mkdirSync(join(base, ep), { recursive: true })
    writeFileSync(join(base, 'ep2', 'manifest.json'), '{}')
    writeFileSync(join(base, 'ep10', 'manifest.json'), '{}')
    writeFileSync(join(base, 'ep1', 'manifest.json'), '{}')
    // ep10 sorts after ep2 numerically, not lexically (ep10 < ep2 lexically)
    expect(discoverEpisodeDirs(base, 'manifest.json')).toEqual(['ep1', 'ep2', 'ep10'])
  })

  it('ignores dirs that do not contain the spec file', () => {
    const base = makeBase()
    mkdirSync(join(base, 'ep1'), { recursive: true })
    writeFileSync(join(base, 'ep1', 'manifest.json'), '{}')
    mkdirSync(join(base, 'ep5'), { recursive: true }) // no spec inside
    mkdirSync(join(base, 'unrelated'), { recursive: true })
    expect(discoverEpisodeDirs(base, 'manifest.json')).toEqual(['ep1'])
  })

  it('returns an empty list when the base dir is missing', () => {
    const base = makeBase()
    expect(discoverEpisodeDirs(join(base, 'nope'), 'manifest.json')).toEqual([])
  })
})