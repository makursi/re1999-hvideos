import { Command } from 'commander'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { config } from '../common/config.js'
import { collectUnits, defaultProductDir, elapsedSeconds, makeListAction, probeSourceDurations, wrapAction, type Unit } from '../common/run-common.js'
import { loadManifest, resolveClipTimes, type ClipSpec, type Manifest } from './manifest.js'
import { buildFfmpegArgs, probeDuration, runFfmpeg } from '../common/ffmpeg.js'
import { formatSeconds } from '../common/time.js'

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

/**
 * Build the `clip` subcommand of the re1999 program (ADR-0006): run/list over
 * per-unit manifests plus the clip orchestration (plan, probe, encode) that
 * the CLI wires up. Domain stays clip-only (ADR-0004: mechanics live in
 * `common/`, domain models never cross pipelines). Specs live under
 * `<workDir>/<project>/clips/<unit>/manifest.json` and products default to
 * the mirrored `outputDir` (ADR-0009).
 */
export function buildClipCommand(): Command {
  const program = new Command()
    .name('clip')
    .description('Clip raw videos according to per-unit manifests (re1999-hvideos)')
    .version('0.3.0')

  program
    .command('run')
    .description('Run all clips in the per-unit manifests')
    .option('-m, --manifest <path>', 'explicit manifest JSON path (single-file mode)')
    .option('--project <project>', 'only this project (e.g. 1999); default: all projects')
    .option('--unit <unit>', 'only this unit (e.g. ep1); default: all units of the selected projects')
    .option('--dry-run', 'validate and print the plan without encoding')
    .option('--copy', 'draft mode: stream copy, cut points snap to keyframes')
    .option('--crf <n>', 'libx264 CRF for accurate mode', '20')
    .option('--preset <p>', 'x264 preset for accurate mode', 'fast')
    .option('-o, --out-dir <path>', 'output directory override (default: work→output mirror of the manifest)')
    .action((options: RunOptions) => wrapAction('clip', () => runAllUnits(collectManifests(options), options)))

  program
    .command('list')
    .description('List discovered per-unit manifests by project')
    .action(makeListAction('clip', () => config.workDir, 'clips', 'manifest.json', (baseDir) => `no manifests found under ${baseDir}`, (path) => `${loadManifest(path).clips.length} clip(s)`))

  return program
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