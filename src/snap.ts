import { Command } from 'commander'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { discoverEpisodeDirs } from './discovery.js'
import { loadFrameSpec, resolveFrameEntry, type FrameFormat, type FramesSpec } from './framespec.js'
import { buildSequenceArgs, probeDuration, probeImageStats, runFfmpeg } from './ffmpeg.js'
import { isSolidFrame } from './solid.js'
import { firstValidFrame, planExtraction, PROJECT_FPS, SHIFT_MAX_FRAMES, WindowEndError, type ShiftResult } from './shift.js'
import { formatSeconds } from './time.js'

const SCREENSHOTS_DIR = 'media/screenshots'
const TEMP_DIR = 'media/temp'

const program = new Command()
  .name('snap')
  .description('Extract frame screenshots from raw videos per frames.json (re1999-hvideos)')
  .version('0.1.0')

interface RunOptions {
  spec?: string
  ep?: string
  dryRun: boolean
  strict: boolean
}

interface EpisodeSpec {
  name: string
  specPath: string
  spec: FramesSpec
}

type Shot =
  | { kind: 'direct', file: string, time: number }
  | { kind: 'shift', file: string, time: number, frames: number }
  | { kind: 'error', reason: string }

program
  .command('run')
  .description('Extract all screenshots in the per-episode frames specs')
  .option('-m, --spec <path>', 'explicit frames spec JSON path (single-file mode)')
  .option('--ep <ep>', 'only this episode (e.g. ep1)')
  .option('--dry-run', 'validate and print the plan without extracting')
  .option('--strict', 'error on solid frames instead of auto-shifting to a later valid frame')
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

function framePath(dir: string, frame: number, format: FrameFormat): string {
  return join(dir, `f-${String(frame).padStart(2, '0')}.${format}`)
}

/**
 * Probe one screenshot entry and decide what to capture (ADR-0005).
 *
 * The probe window is extracted ONCE as a frame-exact frame sequence starting
 * at `at`: `-ss at -frames:v (SHIFT_MAX_FRAMES + 1)` writes 65 frames — f-01 is
 * the frame at `at`, f-(k+1) is the k-th frame after it (no filtergraph, see
 * buildSequenceArgs). Each extracted image is then judged by luminance stats in
 * a separate pass, and planExtraction applies the auto-shift policy:
 * valid `at` -> direct; solid `at` -> first valid frame within the window,
 * else per-entry error (strict or exhausted window).
 */
async function resolveShot(
  source: string,
  at: number,
  format: FrameFormat,
  tempDir: string,
  strict: boolean,
): Promise<Shot> {
  mkdirSync(tempDir, { recursive: true })
  await runFfmpeg(buildSequenceArgs(source, at, SHIFT_MAX_FRAMES + 1, format, join(tempDir, 'f-%02d.' + format)))

  const solidAt = isSolidFrame(await probeImageStats(framePath(tempDir, 1, format)))

  // The same tested algorithm as unit-tested firstValidFrame drives the real
  // probing: the injected predicate judges each extracted image; WindowEndError
  // means the source ended before the window did — never a silent far frame.
  let found: ShiftResult | null = null
  if (solidAt && !strict) {
    try {
      found = await firstValidFrame(at, async (frames) => {
        const path = framePath(tempDir, frames + 1, format)
        if (!existsSync(path))
          throw new WindowEndError()
        return isSolidFrame(await probeImageStats(path))
      })
    }
    catch (error) {
      if (error instanceof WindowEndError)
        return { kind: 'error', reason: error.message }
      throw error
    }
  }

  const plan = planExtraction(solidAt, strict, () => found)
  if (plan.kind === 'direct')
    return { kind: 'direct', file: framePath(tempDir, 1, format), time: at }
  if (plan.kind === 'shift')
    return { kind: 'shift', file: framePath(tempDir, plan.frames + 1, format), time: plan.time, frames: plan.frames }
  return { kind: 'error', reason: plan.reason }
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
  console.log(`[snap] plan: ${plan.length} episode(s), ${total} screenshots${options.strict ? ', strict mode (auto-shift off)' : ''}`)
  for (const p of plan) {
    for (const e of p.entries)
      console.log(`  ${p.name} ${e.id}: at ${formatSeconds(e.at)} (${e.format})  ->  ${e.output}`)
  }

  if (options.dryRun) {
    await runPlanDry(plan, options.strict, total)
    return
  }
  await runPlan(plan, options.strict, total)
}

async function runPlanDry(
  plan: { name: string, entries: { id: string, at: number, format: FrameFormat, source: string, output: string }[] }[],
  strict: boolean,
  total: number,
): Promise<void> {
  const startedAt = Date.now()
  // Predicted failures surface via the exit code too (ADR-0005: strict mode
  // 判坏即报错、退出码非零汇总 — dry-run agrees with what a real run would do).
  let failed = 0
  for (const p of plan) {
    for (const e of p.entries) {
      const tempDir = join(TEMP_DIR, `snap-${process.pid}-${e.id}`)
      try {
        const shot = await resolveShot(e.source, e.at, e.format, tempDir, strict)
        if (shot.kind === 'direct') {
          console.log(`  ${p.name} ${e.id}: at ${formatSeconds(e.at)} is a valid frame`)
        }
        else if (shot.kind === 'shift') {
          console.log(`  ${p.name} ${e.id}: at ${formatSeconds(e.at)} is a solid frame; will auto-shift to ~${formatSeconds(shot.time)} (+${shot.frames} frame${shot.frames === 1 ? '' : 's'})`)
        }
        else {
          console.log(`  ${p.name} ${e.id}: WARN ${shot.reason}; will skip`)
          failed += 1
        }
      }
      catch (error) {
        console.log(`  ${p.name} ${e.id}: ERROR (${(error as Error).message})`)
        failed += 1
      }
      finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    }
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[snap] dry-run: probed ${total} screenshot(s) in ${elapsed}s; no products written (probe temp files cleaned)`)
  if (failed > 0)
    process.exitCode = 1
}

async function runPlan(
  plan: { name: string, entries: { id: string, at: number, format: FrameFormat, source: string, output: string }[] }[],
  strict: boolean,
  total: number,
): Promise<void> {
  const startedAt = Date.now()
  let failed = 0
  for (const p of plan) {
    for (const e of p.entries) {
      mkdirSync(dirname(e.output), { recursive: true })
      const tempDir = join(TEMP_DIR, `snap-${process.pid}-${e.id}`)
      console.log(`[snap] extracting ${p.name} ${e.id} ...`)
      try {
        const shot = await resolveShot(e.source, e.at, e.format, tempDir, strict)
        if (shot.kind === 'error') {
          console.error(`  ERROR ${e.id}: ${shot.reason}; skipped`)
          failed += 1
        }
        else {
          copyFileSync(shot.file, e.output)
          if (shot.kind === 'direct') {
            console.log(`  done -> ${e.output}`)
          }
          else {
            const offset = (shot.frames / PROJECT_FPS).toFixed(3)
            console.log(`  auto-shift: at ${formatSeconds(e.at)} is solid; took frame at ${formatSeconds(shot.time)} (+${shot.frames} frame${shot.frames === 1 ? '' : 's'} / +${offset}s)`)
            console.log(`  done -> ${e.output}`)
          }
        }
      }
      catch (error) {
        console.error(`  ERROR ${e.id}: ${(error as Error).message}; skipped`)
        failed += 1
      }
      finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    }
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[snap] finished ${total} screenshots in ${elapsed}s${failed > 0 ? `, ${failed} failed` : ''}`)
  if (failed > 0)
    process.exitCode = 1
}