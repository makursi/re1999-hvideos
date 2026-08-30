import { Command } from 'commander'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { discoverEpisodeDirs } from './discovery.js'
import { loadFrameSpec, resolveFrameEntry, type FrameFormat, type FramesSpec } from './framespec.js'
import { buildFrameArgs, probeDuration, runFfmpeg } from './ffmpeg.js'
import { formatSeconds } from './time.js'

const SCREENSHOTS_DIR = 'media/screenshots'

const program = new Command()
  .name('snap')
  .description('Extract frame screenshots from raw videos per frames.json (re1999-hvideos)')
  .version('0.1.0')

interface RunOptions {
  spec?: string
  ep?: string
  dryRun: boolean
}

interface EpisodeSpec {
  name: string
  specPath: string
  spec: FramesSpec
}

program
  .command('run')
  .description('Extract all screenshots in the per-episode frames specs')
  .option('-m, --spec <path>', 'explicit frames spec JSON path (single-file mode)')
  .option('--ep <ep>', 'only this episode (e.g. ep1)')
  .option('--dry-run', 'validate and print the plan without extracting')
  .action(async (options: RunOptions) => {
    try {
      await runAllEpisodes(collectEpisodes(options), options)
    }
    catch (error) {
      console.error(`[snap] error: ${(error as Error).message}`)
      process.exitCode = 1
    }
  })

program
  .command('list')
  .description('List discovered per-episode frames specs')
  .action(() => {
    const names = discoverEpisodeDirs(SCREENSHOTS_DIR, 'frames.json')
    if (names.length === 0) {
      console.log(`[snap] no frames specs found under ${SCREENSHOTS_DIR}`)
      return
    }
    for (const name of names) {
      try {
        const spec = loadFrameSpec(join(SCREENSHOTS_DIR, name, 'frames.json'))
        console.log(`  ${name}: ${spec.screenshots.length} screenshot(s)`)
      }
      catch (error) {
        console.log(`  ${name}: ERROR (${(error as Error).message})`)
      }
    }
  })

program.parse()

function collectEpisodes(options: RunOptions): EpisodeSpec[] {
  if (options.spec) {
    const spec = loadFrameSpec(options.spec)
    return [{ name: options.ep ?? 'explicit', specPath: options.spec, spec }]
  }

  const names = discoverEpisodeDirs(SCREENSHOTS_DIR, 'frames.json')
  const selected = options.ep ? names.filter(n => n === options.ep) : names
  if (options.ep && selected.length === 0)
    throw new Error(`episode not found: ${options.ep} (scanned ${SCREENSHOTS_DIR})`)
  if (selected.length === 0)
    throw new Error(`no frames specs found under ${SCREENSHOTS_DIR}/<ep>/frames.json`)

  return selected.map((name) => {
    const specPath = join(SCREENSHOTS_DIR, name, 'frames.json')
    return { name, specPath, spec: loadFrameSpec(specPath) }
  })
}

async function runAllEpisodes(episodes: EpisodeSpec[], options: RunOptions): Promise<void> {
  // Probe distinct sources once; validate range against real duration.
  const durations = new Map<string, number>()
  for (const ep of episodes) {
    for (const s of ep.spec.screenshots) {
      if (!durations.has(s.source)) {
        if (!existsSync(s.source) || !statSync(s.source).isFile())
          throw new Error(`screenshot source not found: ${s.source}`)
        durations.set(s.source, probeDuration(s.source))
      }
    }
  }

  interface PlanEntry { id: string, at: number, format: FrameFormat, source: string, output: string }
  const plan = episodes.map(ep => ({
    name: ep.name,
    entries: ep.spec.screenshots.map((s) => {
      const { at, output } = resolveFrameEntry(s, dirname(ep.specPath))
      const sourceDuration = durations.get(s.source)!
      if (at >= sourceDuration)
        throw new Error(`screenshot "${s.id}": at (${formatSeconds(at)}) is not before source duration (${formatSeconds(sourceDuration)})`)
      return { id: s.id, at, format: s.format, source: s.source, output } satisfies PlanEntry
    }),
  }))

  const total = plan.reduce((sum, p) => sum + p.entries.length, 0)
  console.log(`[snap] plan: ${plan.length} episode(s), ${total} screenshots`)
  for (const p of plan) {
    for (const e of p.entries)
      console.log(`  ${p.name} ${e.id}: at ${formatSeconds(e.at)} (${e.format})  ->  ${e.output}`)
  }

  if (options.dryRun) {
    console.log('[snap] dry-run: no extraction performed')
    return
  }

  const startedAt = Date.now()
  for (const p of plan) {
    for (const e of p.entries) {
      mkdirSync(dirname(e.output), { recursive: true })
      const args = buildFrameArgs(e.source, e.at, e.output, e.format)
      console.log(`[snap] extracting ${p.name} ${e.id} ...`)
      await runFfmpeg(args)
      console.log(`  done -> ${e.output}`)
    }
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[snap] finished ${total} screenshots in ${elapsed}s`)
}