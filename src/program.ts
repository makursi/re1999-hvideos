import { createRequire } from 'node:module'
import { cac, type CAC } from 'cac'
import { registerClip } from './clip/run.js'
import { registerSnap } from './snap/run.js'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

/**
 * Build the re1999 multicall program (ADR-0006, CLI framework now cac per
 * ADR-0010): one cac instance wiring the clip and snap pipelines through
 * their registrars, with a single global `-v, --version` (package.json is the
 * one source of truth) and cac-native `-h, --help`.
 *
 * parse() itself is left to the entry point (src/main.ts) so tests can drive
 * `cli.parse(argv, { run: false })` over this factory to lock the argv →
 * options mapping (tests/cli.test.ts).
 */
export function createProgram(): CAC {
  const cli = cac('re1999')
  cli.version(version)
  registerClip(cli)
  registerSnap(cli)
  cli.help()
  return cli
}