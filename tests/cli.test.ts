import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from '../src/program.js'
import { toRunOptions } from '../src/clip/run.js'
import { toSnapOptions } from '../src/snap/run.js'
import { dispatchCacAction } from '../src/common/run-common.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * Parse argv (node + script + args) against a fresh program without running
 * actions, so tests observe the option mapping only (ADR-0010: cac parse seam).
 */
function parse(argv: string[]) {
  const cli = createProgram()
  const parsed = cli.parse(['node', 're1999', ...argv], { run: false })
  return { cli, parsed }
}

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = 0
})

describe('parse layer (cac, ADR-0010)', () => {
  it('maps clip run flags to camelCased options', () => {
    const { parsed } = parse(['clip', 'run', '--dry-run', '--copy', '--crf', '23', '--project', '1999', '--unit', 'ep1', '-o', 'out/x'])
    expect(parsed.args).toEqual(['run'])
    expect(parsed.options).toMatchObject({ dryRun: true, copy: true, outDir: 'out/x' })
    // cac's mri coerces numeric-looking tokens to numbers at the parse layer;
    // dispatchCacAction/toRunOptions re-stringify them (pinned in the
    // coercion describe below) so `--project 1999` compares as '1999'.
    expect(parsed.options.project).toBe(1999)
    expect(parsed.options.crf).toBe(23)
  })

  it('keeps the action token for clip list / snap run', () => {
    expect(parse(['clip', 'list']).parsed.args).toEqual(['list'])
    expect(parse(['snap', 'run', '--strict']).parsed.args).toEqual(['run'])
    expect(parse(['snap', 'run', '--strict']).parsed.options.strict).toBe(true)
  })

  it('recognizes --help and --version as flags', () => {
    // cac prints both help and version through console.info (ADR-0010).
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(parse(['--help']).parsed.options.help).toBe(true)
    expect(parse(['--version']).parsed.options.version).toBe(true)
    expect(info).toHaveBeenCalledTimes(2)
  })

  it('throws on unknown options in the run path (non-zero exit upstream)', () => {
    const cli = createProgram()
    expect(() => cli.parse(['node', 're1999', 'clip', 'run', '--bogus'])).toThrow('Unknown option')
  })

  it('throws on a missing option value in the run path', () => {
    const cli = createProgram()
    expect(() => cli.parse(['node', 're1999', 'clip', 'run', '--project'])).toThrow('value is missing')
  })

  it('throws on unexpected positional args in the run path', () => {
    const cli = createProgram()
    expect(() => cli.parse(['node', 're1999', 'clip', 'run', 'extra'])).toThrow('Unused args')
  })
})

describe('version (single source of truth)', () => {
  it('uses the package.json version on the global command', () => {
    const cli = createProgram()
    expect(cli.globalCommand.versionNumber).toBe(pkg.version)
  })
})

describe('dispatch coercion (mri numbers → strings, ADR-0010)', () => {
  it('stringifies numeric-looking values at the parse boundary for clip', () => {
    expect(toRunOptions({ project: 1999, unit: 'ep1', crf: 23, dryRun: true, copy: false }))
      .toMatchObject({ project: '1999', unit: 'ep1', dryRun: true, copy: false, crf: '23', preset: 'fast' })
    expect(toRunOptions({})).toMatchObject({ dryRun: false, copy: false, crf: '20', preset: 'fast' })
  })

  it('stringifies numeric-looking values at the parse boundary for snap', () => {
    expect(toSnapOptions({ spec: undefined, project: 1999, strict: true }))
      .toMatchObject({ project: '1999', strict: true, dryRun: false })
    expect(toSnapOptions({})).toMatchObject({ dryRun: false, strict: false })
  })
})

describe('dispatch layer (ADR-0010)', () => {
  it('prints the version instead of running when --version is set', () => {
    const cli = createProgram()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const run = vi.fn()
    dispatchCacAction(cli, 'run', { version: true }, { tag: 'clip', usage: 'u', run, list: () => {} })
    expect(run).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalled()
  })

  it('reports unknown actions with a non-zero exit code', () => {
    const cli = createProgram()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    dispatchCacAction(cli, 'bogus', {}, { tag: 'clip', usage: 'u', run: () => {}, list: () => {} })
    expect(err).toHaveBeenCalledWith('[clip] unknown action: bogus')
    expect(process.exitCode).toBe(1)
  })
})