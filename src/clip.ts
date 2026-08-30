import { Command } from 'commander'
import { mkdirSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadManifest, resolveClipTimes, type ClipSpec } from './manifest.js'
import { buildFfmpegArgs, probeDuration, runFfmpeg } from './ffmpeg.js'
import { formatSeconds } from './time.js'

const program = new Command()
  .name('clip')
  .description('Clip raw videos according to manifest.json (re1999-hvideos)')
  .version('0.1.0')

interface RunOptions {
  manifest: string
  dryRun: boolean
  copy: boolean
  crf: string
  preset: string
  outDir: string
}

program
  .command('run')
  .description('Run all clips in the manifest')
  .option('-m, --manifest <path>', 'manifest JSON path', 'manifest.json')
  .option('--dry-run', 'validate and print the plan without encoding')
  .option('--copy', 'draft mode: stream copy, cut points snap to keyframes')
  .option('--crf <n>', 'libx264 CRF for accurate mode', '20')
  .option('--preset <p>', 'x264 preset for accurate mode', 'fast')
  .option('-o, --out-dir <path>', 'output directory', 'media/exports')
  .action(async (options: RunOptions) => {
    try {
      const manifest = loadManifest(options.manifest)
      await runAllClips(manifest.clips, options)
    }
    catch (error) {
      console.error(`[clip] error: ${(error as Error).message}`)
      process.exitCode = 1
    }
  })

program.parse()

async function runAllClips(clips: ClipSpec[], options: RunOptions): Promise<void> {
  // Probe every distinct source once; validate ranges against real duration.
  const durations = new Map<string, number>()
  for (const clip of clips) {
    if (!durations.has(clip.source)) {
      if (!existsSync(clip.source) || !statSync(clip.source).isFile())
        throw new Error(`source not found: ${clip.source}`)
      durations.set(clip.source, probeDuration(clip.source))
    }
  }

  const plan = clips.map((clip) => {
    const { start, end } = resolveClipTimes(clip)
    const sourceDuration = durations.get(clip.source)!
    if (end > sourceDuration)
      throw new Error(`clip "${clip.id}": out (${formatSeconds(end)}) exceeds source duration (${formatSeconds(sourceDuration)})`)
    const output = resolve(options.outDir, `${clip.id}.mp4`)
    return { clip, start, duration: end - start, output }
  })

  const total = plan.reduce((sum, p) => sum + p.duration, 0)
  console.log(`[clip] plan: ${plan.length} clips, ${formatSeconds(total)} total, mode=${options.copy ? 'stream-copy' : `re-encode (crf ${options.crf}, ${options.preset})`}`)
  for (const p of plan)
    console.log(`  ${p.clip.id}: ${formatSeconds(p.start)} -> ${formatSeconds(p.start + p.duration)} (${formatSeconds(p.duration)})  ->  ${p.output}`)

  if (options.dryRun) {
    console.log('[clip] dry-run: no encoding performed')
    return
  }

  mkdirSync(resolve(options.outDir), { recursive: true })
  const startedAt = Date.now()
  for (const p of plan) {
    const args = buildFfmpegArgs(p.clip.source, p.start, p.duration, p.output, {
      copy: options.copy,
      crf: Number(options.crf),
      preset: options.preset,
    })
    console.log(`[clip] encoding ${p.clip.id} ...`)
    await runFfmpeg(args)
    console.log(`  done -> ${p.output}`)
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[clip] finished ${plan.length} clips in ${elapsed}s`)
}