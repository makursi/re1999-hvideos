import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { CAC } from 'cac'
import { config } from '../common/config.js'
import { asString, collectUnits, defaultProductDir, dispatchCacAction, elapsedSeconds, makeListAction, probeSourceDurations, wrapAction, type Unit } from '../common/run-common.js'
import { loadManifest, resolveClipTimes, type ClipSpec, type Manifest } from './manifest.js'
import { buildFfmpegArgs, probeDuration, runFfmpeg } from '../common/ffmpeg.js'
import { formatSeconds } from '../common/time.js'

/**
 * Raw parsed options as cac hands them to the action (camelCased; values may
 * be numbers because mri coerces numeric-looking tokens — see toRunOptions).
 */
interface ClipParseOptions {
  manifest?: unknown
  project?: unknown
  unit?: unknown
  dryRun?: unknown
  copy?: unknown
  crf?: unknown
  preset?: unknown
  outDir?: unknown
  version?: unknown
}

interface RunOptions {
  manifest?: string
  project?: string
  unit?: string
  dryRun: boolean
  copy: boolean
  crf: string
  preset: string
  outDir?: string
}

/** Single source for the clip run defaults (shared by the cac option config and toRunOptions). */
const CLIP_DEFAULTS = { crf: '20', preset: 'fast' } as const

/**
 * Parse boundary: shape cac/mri options into the typed RunOptions the
 * orchestration consumes (ADR-0010). String-valued options are re-stringified
 * (mri turns `--project 1999` into number 1999) and cac's option defaults are
 * applied here, so tests pin the contract without invoking the pipeline.
 */
export function toRunOptions(options: ClipParseOptions): RunOptions {
  return {
    manifest: asString(options.manifest),
    project: asString(options.project),
    unit: asString(options.unit),
    dryRun: options.dryRun === true,
    copy: options.copy === true,
    crf: asString(options.crf) ?? CLIP_DEFAULTS.crf,
    preset: asString(options.preset) ?? CLIP_DEFAULTS.preset,
    outDir: asString(options.outDir),
  }
}

/**
 * Register the `clip` command of the re1999 program (ADR-0006, wiring shape
 * per ADR-0010). cac matches commands against the first argv token only, so
 * the run/list subcommands of the commander era are dispatched from one
 * `clip [action]` command here; the user-facing surface (`pnpm clip run
 * --dry-run`, `pnpm clip list`) is unchanged (ADR-0010).
 */
export function registerClip(cli: CAC): void {
  cli.command('clip [action]', 'Clip raw videos according to per-unit manifests (re1999-hvideos)')
    .option('-m, --manifest <path>', 'explicit manifest JSON path (single-file mode)')
    .option('--project <project>', 'only this project (e.g. 1999); default: all projects')
    .option('--unit <unit>', 'only this unit (e.g. ep1); default: all units of the selected projects')
    .option('--dry-run', 'validate and print the plan without encoding')
    .option('--copy', 'draft mode: stream copy, cut points snap to keyframes')
    .option('--crf <n>', 'libx264 CRF for accurate mode', { default: CLIP_DEFAULTS.crf })
    .option('--preset <p>', 'x264 preset for accurate mode', { default: CLIP_DEFAULTS.preset })
    .option('-o, --out-dir <path>', 'output directory override (default: work→output mirror of the manifest)')
    .action((action: string | undefined, options: ClipParseOptions) => dispatchCacAction(cli, action, options, {
      tag: 'clip',
      usage: 're1999 clip <run|list> [options]  (see `re1999 clip run --help`)',
      run: () => {
        const runOptions = toRunOptions(options)
        return wrapAction('clip', () => runAllUnits(collectManifests(runOptions), runOptions))
      },
      list: () => makeListAction('clip', () => config.workDir, 'clips', 'manifest.json', (baseDir) => `no manifests found under ${baseDir}`, (path) => `${loadManifest(path).clips.length} clip(s)`)(),
    }))
}

function collectManifests(options: RunOptions): Unit<Manifest>[] {
  return collectUnits(config.workDir, 'clips', 'manifest.json', loadManifest, {
    explicitPath: options.manifest,
    project: options.project,
    unit: options.unit,
    kind: 'manifests',
    singleName: options.manifest ? dirname(options.manifest) : undefined,
  })
}

async function runAllUnits(units: Unit<Manifest>[], options: RunOptions): Promise<void> {
  // Probe every distinct source once; validate ranges against real duration.
  const durations = probeSourceDurations(units.flatMap(u => u.loaded.clips), probeDuration, 'source')

  interface PlanEntry { clip: ClipSpec, start: number, duration: number, output: string }
  const plan = units.map(unit => {
    const outDir = options.outDir ?? defaultProductDir(unit.specPath, config.workDir, config.outputDir)
    return {
      project: unit.project,
      name: unit.name,
      entries: unit.loaded.clips.map((clip) => {
        const { start, end } = resolveClipTimes(clip)
        const sourceDuration = durations.get(clip.source)!
        if (end > sourceDuration)
          throw new Error(`clip "${clip.id}": out (${formatSeconds(end)}) exceeds source duration (${formatSeconds(sourceDuration)})`)
        const output = resolve(outDir, `${clip.id}.mp4`)
        return { clip, start, duration: end - start, output } satisfies PlanEntry
      }),
    }
  })

  const total = plan.reduce((sum, p) => sum + p.entries.reduce((s, e) => s + e.duration, 0), 0)
  console.log(`[clip] plan: ${plan.length} unit(s), ${plan.reduce((s, p) => s + p.entries.length, 0)} clips, ${formatSeconds(total)} total, mode=${options.copy ? 'stream-copy' : `re-encode (crf ${options.crf}, ${options.preset})`}`)
  for (const p of plan) {
    console.log(`[clip] ${p.project}/${p.name}:`)
    for (const e of p.entries)
      console.log(`  ${e.clip.id}: ${formatSeconds(e.start)} -> ${formatSeconds(e.start + e.duration)} (${formatSeconds(e.duration)})  ->  ${e.output}`)
  }

  if (options.dryRun) {
    console.log('[clip] dry-run: no encoding performed')
    return
  }

  const startedAt = Date.now()
  for (const p of plan) {
    for (const e of p.entries) {
      mkdirSync(dirname(e.output), { recursive: true })
      const args = buildFfmpegArgs(e.clip.source, e.start, e.duration, e.output, {
        copy: options.copy,
        crf: Number(options.crf),
        preset: options.preset,
      })
      console.log(`[clip] encoding ${e.clip.id} ...`)
      await runFfmpeg(args)
      console.log(`  done -> ${e.output}`)
    }
  }
  const elapsed = elapsedSeconds(startedAt)
  console.log(`[clip] finished ${plan.reduce((s, p) => s + p.entries.length, 0)} clips in ${elapsed}s`)
}