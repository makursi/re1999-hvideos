import { Command } from 'commander'
import { buildClipCommand } from './clip/run.js'
import { buildSnapCommand } from './snap/run.js'

/**
 * Single CLI entry for re1999-hvideos (ADR-0006).
 *
 * The clip and snap pipelines stay domain-decoupled (ADR-0004) but share one
 * argv surface: `clip` (manifest-driven video clipping) and `snap`
 * (frames-spec screenshots) are subcommands of this program. `pnpm clip` /
 * `pnpm snap` in package.json forward here, so routine operations keep their
 * muscle memory; `pnpm re1999` exposes the combined program.
 */
const program = new Command()
  .name('re1999')
  .description('re1999-hvideos: clip raw videos per manifests, extract screenshots per frames specs')
  .version('0.1.0')
  .addCommand(buildClipCommand())
  .addCommand(buildSnapCommand())

program.parse()