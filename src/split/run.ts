import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { CAC } from 'cac'
import { config } from '../common/config.js'
import { asString, collectUnits, defaultProductDir, dispatchCacAction, elapsedSeconds, makeListAction, probeSourceDurations, wrapAction, type Unit } from '../common/run-common.js'
import { loadTracklist, resolveTrackTimes, type ResolvedTrack, type Tracklist } from './tracklist.js'
import { buildAudioCopyArgs, probeDuration, runFfmpeg } from '../common/ffmpeg.js'
import { formatSeconds } from '../common/time.js'

/**
 * Raw parsed options as cac hands them to the action (camelCased; values may
 * be numbers because mri coerces numeric-looking tokens — see toSplitOptions).
 */
interface SplitParseOptions {
  tracklist?: unknown
  project?: unknown
  unit?: unknown
  dryRun?: unknown
  strict?: unknown
  version?: unknown
}

interface SplitOptions {
  tracklist?: string
  project?: string
  unit?: string
  dryRun: boolean
  strict: boolean
}

/**
 * Parse boundary: shape cac/mri options into the typed SplitOptions the
 * orchestration consumes (ADR-0010). String-valued options are re-stringified
 * (mri turns `--project mix` into a string but numeric tokens become numbers),
 * so tests pin the contract without invoking the pipeline.
 */
export function toSplitOptions(options: SplitParseOptions): SplitOptions {
  return {
    tracklist: asString(options.tracklist),
    project: asString(options.project),
    unit: asString(options.unit),
    dryRun: options.dryRun === true,
    strict: options.strict === true,
  }
}

/**
 * Register the `split` command of the re1999 program (ADR-0006, wiring shape
 * per ADR-0010). cac matches a command against the first argv token only, so
 * the run/list subcommands dispatch from one `split [action]` command, exactly
 * like `clip [action]` / `snap [action]`.
 */
export function registerSplit(cli: CAC): void {
  cli.command('split [action]', 'Split an audio source into per-song tracks according to a tracklist (re1999-hvideos)')
    .option('-t, --tracklist <path>', 'explicit tracklist JSON path (single-file mode)')
    .option('--project <project>', 'only this project (e.g. mix); default: all projects')
    .option('--unit <unit>', 'only this unit (e.g. old-school-90s); default: all units of the selected projects')
    .option('--dry-run', 'validate and print the plan without splitting')
    .option('--strict', 'error instead of warn when track boundaries look suspicious (e.g. long tail after the last start)')
    .action((action: string | undefined, options: SplitParseOptions) => dispatchCacAction(cli, action, options, {
      tag: 'split',
      usage: 're1999 split <run|list> [options]  (see `re1999 split run --help`)',
      run: () => {
        const splitOptions = toSplitOptions(options)
        return wrapAction('split', () => runAllUnits(collectTracklists(splitOptions), splitOptions))
      },
      list: () => makeListAction('split', () => config.workDir, 'split', 'tracklist.json', (baseDir) => `no tracklists found under ${baseDir}`, (path) => `${loadTracklist(path).tracks.length} track(s)`)(),
    }))
}

function collectTracklists(options: SplitOptions): Unit<Tracklist>[] {
  return collectUnits(config.workDir, 'split', 'tracklist.json', loadTracklist, {
    explicitPath: options.tracklist,
    project: options.project,
    unit: options.unit,
    kind: 'tracklists',
    singleName: options.tracklist ? dirname(options.tracklist) : undefined,
  })
}

interface PlanEntry {
  track: ResolvedTrack
  output: string
}

interface UnitPlan {
  project: string
  name: string
  source: string
  entries: PlanEntry[]
}

function planUnit(unit: Unit<Tracklist>, strict: boolean): UnitPlan {
  const source = unit.loaded.source
  const sourceDuration = probeSourceDurations([{ source }], probeDuration, 'audio source').get(source)!

  const resolved = resolveTrackTimes(unit.loaded, sourceDuration)
  const outDir = defaultProductDir(unit.specPath, config.workDir, config.outputDir)

  // Warn (or fail, in strict mode) when the last track's start leaves a long
  // tail — a heuristic that a DH mix may carry an unseen outro. Domain truth,
  // not a config knob.
  const GAP_THRESHOLD_SECONDS = 60
  const last = resolved[resolved.length - 1]!
  const tail = sourceDuration - last.start
  if (tail > GAP_THRESHOLD_SECONDS) {
    const message = `last track "${last.title}" starts at ${formatSeconds(last.start)} but source runs ${formatSeconds(tail)} past it (source ${formatSeconds(sourceDuration)})`
    if (strict)
      throw new Error(message)
    console.warn(`[split] warn: ${message}`)
  }

  return {
    project: unit.project,
    name: unit.name,
    source,
    entries: resolved.map(track => ({ track, output: resolve(outDir, track.filename) })),
  }
}

async function runAllUnits(units: Unit<Tracklist>[], options: SplitOptions): Promise<void> {
  const plan = units.map(unit => planUnit(unit, options.strict))

  const total = plan.reduce((sum, p) => sum + p.entries.length, 0)
  console.log(`[split] plan: ${plan.length} unit(s), ${total} track(s)`)
  for (const p of plan) {
    console.log(`[split] ${p.project}/${p.name} (${p.source}):`)
    for (const e of p.entries)
      console.log(`  ${e.track.filename}: ${formatSeconds(e.track.start)} -> ${formatSeconds(e.track.end)} (${formatSeconds(e.track.end - e.track.start)})`)
  }

  if (options.dryRun) {
    console.log('[split] dry-run: no tracks written')
    return
  }

  const startedAt = Date.now()
  for (const p of plan) {
    writeCsvRecord(p)
    for (const e of p.entries) {
      mkdirSync(dirname(e.output), { recursive: true })
      const args = buildAudioCopyArgs(p.source, e.track.start, e.track.end - e.track.start, e.output)
      console.log(`[split] cutting ${e.track.filename} ...`)
      await runFfmpeg(args)
      console.log(`  done -> ${e.output}`)
    }
  }
  const elapsed = elapsedSeconds(startedAt)
  console.log(`[split] finished ${total} track(s) in ${elapsed}s`)
}

/**
 * Write the reviewable manifest (候选核对清单): one CSV beside the products
 * recording every song's index/title/boundary/duration and output filename.
 * index,title,start,end,duration,output_file
 */
function writeCsvRecord(p: UnitPlan): void {
  const dir = dirname(p.entries[0]!.output)
  mkdirSync(dir, { recursive: true })
  const rows = p.entries.map((e, i) => {
    const start = e.track.start
    const end = e.track.end
    return [
      i + 1,
      e.track.title,
      formatSeconds(start),
      formatSeconds(end),
      formatSeconds(end - start),
      e.track.filename,
    ].join(',')
  })
  const header = 'index,title,start,end,duration,output_file'
  writeFileSync(join(dir, 'tracklist.csv'), [header, ...rows, ''].join('\n'))
}
