import { Command } from 'commander'
import { mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { discoverEpisodeDirs } from './discovery.js'
import { loadManifest, resolveClipTimes, type ClipSpec } from './manifest.js'
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

interface EpisodeClips {
  name: string
  manifestPath: string
  clips: ClipSpec[]
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
  .action(async (options: RunOptions) => {
    try {
      await runAllEpisodes(collectEpisodes(options), options)
    }
    catch (error) {
      console.error(`[clip] error: ${(error as Error).message}`)
      process.exitCode = 1
    }
  })

program
  .command('list')
  .description('List discovered per-episode manifests')
  .action(() => {
    const names = discoverEpisodeDirs(EXPORTS_DIR, 'manifest.json')
    if (names.length === 0) {
      console.log(`[clip] no manifests found under ${EXPORTS_DIR}`)
      return
    }
    for (const name of names) {
      try {
        const clips = loadManifest(join(EXPORTS_DIR, name, 'manifest.json')).clips
        console.log(`  ${name}: ${clips.length} clip(s)`)
      }
      catch (error) {
        console.log(`  ${name}: ERROR (${(error as Error).message})`)
      }
    }
  })

program.parse()

function collectEpisodes(options: RunOptions): EpisodeClips[] {
  if (options.manifest) {
    const clips = loadManifest(options.manifest).clips
    return [{ name: options.ep ?? dirname(options.manifest), manifestPath: options.manifest, clips }]
  }

  const names = discoverEpisodeDirs(EXPORTS_DIR, 'manifest.json')
  const selected = options.ep ? names.filter(n => n === options.ep) : names
  if (options.ep && selected.length === 0)
    throw new Error(`episode not found: ${options.ep} (scanned ${EXPORTS_DIR})`)
  if (selected.length === 0)
    throw new Error(`no manifests found under ${EXPORTS_DIR}/<ep>/manifest.json`)

  return selected.map((name) => {
    const manifestPath = join(EXPORTS_DIR, name, 'manifest.json')
    return { name, manifestPath, clips: loadManifest(manifestPath).clips }
  })
}

async function runAllEpisodes(episodes: EpisodeClips[], options: RunOptions): Promise<void> {
  // Probe every distinct source once; validate ranges against real duration.
  const durations = new Map<string, number>()
  for (const ep of episodes) {
    for (const clip of ep.clips) {
      if (!durations.has(clip.source)) {
        if (!existsSync(clip.source) || !statSync(clip.source).isFile())
          throw new Error(`source not found: ${clip.source}`)
        durations.set(clip.source, probeDuration(clip.source))
      }
    }
  }

  interface PlanEntry { clip: ClipSpec, start: number, duration: number, output: string }
  const plan = episodes.map(ep => ({
    name: ep.name,
    entries: ep.clips.map((clip) => {
      const { start, end } = resolveClipTimes(clip)
      const sourceDuration = durations.get(clip.source)!
      if (end > sourceDuration)
        throw new Error(`clip "${clip.id}": out (${formatSeconds(end)}) exceeds source duration (${formatSeconds(sourceDuration)})`)
      const outDir = options.outDir ?? dirname(ep.manifestPath)
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
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[clip] finished ${plan.reduce((s, p) => s + p.entries.length, 0)} clips in ${elapsed}s`)
}