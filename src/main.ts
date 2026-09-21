import { loadEnv } from './common/config.js'
import { createProgram } from './program.js'

/**
 * Single CLI entry for re1999-hvideos (ADR-0006; CLI framework now cac per
 * ADR-0010).
 *
 * The clip and snap pipelines stay domain-decoupled (ADR-0004) but share one
 * argv surface: `clip` (manifest-driven video clipping) and `snap`
 * (frames-spec screenshots) are commands of this program. `pnpm clip` /
 * `pnpm snap` in package.json forward here, so routine operations keep their
 * muscle memory; `pnpm re1999` exposes the combined program.
 *
 * cac 7 (ADR-0010) leaves error handling to the host: unknown options, missing
 * values and unused args throw CACError out of parse() (caught below), unknown
 * commands surface as a `command:*` event, and a bare invocation parses with no
 * matched command — so help is printed explicitly.
 */
loadEnv()

const cli = createProgram()

// cac matches registered commands only; an unmatched first token is an unknown
// command. Report it and fail instead of cac's silent exit 0. (--help/--version
// were already handled inside parse(), so args that rode along with them are
// not treated as unknown commands.)
cli.addEventListener('command:*', () => {
  if (cli.options.help || cli.options.version)
    return
  console.error(`[re1999] unknown command: ${cli.args[0]}`)
  process.exitCode = 1
})

try {
  const parsed = cli.parse()
  if (!cli.matchedCommandName && parsed.args.length === 0 && !parsed.options.help && !parsed.options.version) {
    // Root-level unknown flags never reach a command's runMatchedCommand
    // checks; validate them here so `re1999 --bogus` fails loudly too
    // (ADR-0010), then show help for a plain bare invocation.
    cli.globalCommand.checkUnknownOptions()
    cli.outputHelp()
  }
}
catch (error) {
  console.error(`[re1999] error: ${(error as Error).message}`)
  process.exitCode = 1
}