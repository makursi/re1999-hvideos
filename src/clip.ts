import { Command } from 'commander'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { collectEpisodes, elapsedSeconds, makeListAction, probeSourceDurations, wrapAction, type Episode } from './run-common.js'
import { loadManifest, resolveClipTimes, type ClipSpec, type Manifest } from './manifest.js'
import { buildFfmpegArgs, probeDuration, runFfmpeg } from './ffmpeg.js'
import { formatSeconds } from './time.js'

const EXPORTS_DIR = 'media/exports'

const program = new Command()
  .name('clip')
  .description('Clip raw videos according to per-episode manifests (re1999-hvideos)')
  .version('0.1.0')

interface RunOptions {
  manifest?: string
  ep?: string
  dryRun: boolean
  copy: boolean
  crf: string
  preset: string
  outDir?: string
}

program
  .command('run')
  .description('Run all clips in the per-episode manifests')
  .option('-m, --manifest <path>', 'explicit manifest JSON path (single-file mode)')
  .option('--ep <ep>', 'only this episode (e.g. ep1)')
  .option('--dry-run', 'validate and print the plan without encoding')
  .option('--copy', 'draft mode: stream copy, cut points snap to keyframes')
  .option('--crf <n>', 'libx264 CRF for accurate mode', '20')
  .option('--preset <p>', 'x264 preset for accurate mode', 'fast')
  .option('-o, --out-dir <path>', 'output directory override (default: each manifest dir)')
  .action((options: RunOptions) => wrapAction('clip', () => runAllEpisodes(collectManifests(options), options)))

program
  .command('list')
  .description('List discovered per-episode manifests')
  .action(makeListAction('clip', EXPORTS_DIR, 'manifest.json', `no manifests found under ${EXPORTS_DIR}`, (path) => `${loadManifest(path).clips.length} clip(s)`))

program.parse()

function collectManifests(options: RunOptions): Episode<Manifest>[] {
  return collectEpisodes(EXPORTS_DIR, 'manifest.json', loadManifest, {
    explicitPath: options.manifest,
    ep: options.ep,
    kind: 'manifests',
    singleName: options.manifest ? dirname(options.manifest) : undefined,
  })
}

async function runAllEpisodes(episodes: Episode<Manifest>[], options: RunOptions): Promise<void> {
  // Probe every distinct source once; validate ranges against real duration.
  const durations = probeSourceDurations(episodes.flatMap(ep => ep.loaded.clips), probeDuration, 'source')

  interface PlanEntry { clip: ClipSpec, start: number, duration: number, output: string }
  const plan = episodes.map(ep => ({
    name: ep.name,
    entries: ep.loaded.clips.map((clip) => {
      const { start, end } = resolveClipTimes(clip)
      const sourceDuration = durations.get(clip.source)!
      if (end > sourceDuration)
        throw new Error(`clip "${clip.id}": out (${formatSeconds(end)}) exceeds source duration (${formatSeconds(sourceDuration)})`)
      const outDir = options.outDir ?? dirname(ep.specPath)
      const output = resolve(outDir, `${clip.id}.mp4`)
      return { clip, start, duration: end - start, output } satisfies PlanEntry
    }),
  }))

  const total = plan.reduce((sum, p) => sum + p.entries.reduce((s, e) => s + e.duration, 0), 0)
  console.log(`[clip] plan: ${plan.length} episode(s), ${plan.reduce((s, p) => s + p.entries.length, 0)} clips, ${formatSeconds(total)} total, mode=${options.copy ? 'stream-copy' : `re-encode (crf ${options.crf}, ${options.preset})`}`)
  for (const p of plan) {
    console.log(`[clip] ep ${p.name}:`)
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