import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { discoverEpisodeDirs } from './discovery.js'

/**
 * Shared orchestration glue for the clip and snap CLIs: discovering and
 * selecting per-episode specs, probing source durations, list/error/elapsed
 * reporting, and the read → parse → wrap spec loader.
 *
 * ADR-0004 decouples snap from clip at the DOMAIN level: the two pipelines
 * keep separate specs (manifest.json vs frames.json), separate products
 * (mp4 vs images) and separate semantics (range in/out vs instant at). This
 * module shares only the mechanics around those models — never the models
 * themselves. Any help that starts touching "clips" or "screenshots" belongs
 * in the caller.
 */

/**
 * One discovered per-episode spec: episode name, spec file path, and the
 * loaded spec value (manifest or frames spec, decided by the caller).
 */
export interface Episode<T> {
  name: string
  specPath: string
  loaded: T
}

export interface CollectEpisodesOptions {
  /** Explicit spec JSON path (single-file mode); otherwise scan baseDir. */
  explicitPath?: string
  /** Only this episode (e.g. ep1). */
  ep?: string
  /** Noun describing the spec kind for the "not found" error (e.g. "manifests"). */
  kind: string
  /** Episode name fallback in explicit mode when --ep is absent. */
  singleName?: string
}

/**
 * Collect the episodes to run: either one explicit spec file, or every
 * per-episode spec under baseDir (optionally filtered by --ep). The
 * discovery-and-select shape is identical for clip and snap — only the spec
 * filename and loader differ (per-episode specs follow their products).
 */
export function collectEpisodes<T>(
  baseDir: string,
  specFilename: string,
  load: (path: string) => T,
  options: CollectEpisodesOptions,
): Episode<T>[] {
  if (options.explicitPath) {
    return [{
      name: options.ep ?? options.singleName ?? 'explicit',
      specPath: options.explicitPath,
      loaded: load(options.explicitPath),
    }]
  }

  const names = discoverEpisodeDirs(baseDir, specFilename)
  const selected = options.ep ? names.filter(n => n === options.ep) : names
  if (options.ep && selected.length === 0)
    throw new Error(`episode not found: ${options.ep} (scanned ${baseDir})`)
  if (selected.length === 0)
    throw new Error(`no ${options.kind} found under ${baseDir}/<ep>/${specFilename}`)

  return selected.map((name) => {
    const specPath = join(baseDir, name, specFilename)
    return { name, specPath, loaded: load(specPath) }
  })
}

/**
 * Validate and probe every distinct source once, returning source → duration.
 * Shared by clip (manifest sources) and snap (frames-spec sources); each CLI
 * passes its own error noun so messages keep their original wording.
 */
export function probeSourceDurations(
  entries: ReadonlyArray<{ source: string }>,
  probe: (source: string) => number,
  noun: string,
): Map<string, number> {
  const durations = new Map<string, number>()
  for (const entry of entries) {
    if (durations.has(entry.source))
      continue
    if (!existsSync(entry.source) || !statSync(entry.source).isFile())
      throw new Error(`${noun} not found: ${entry.source}`)
    durations.set(entry.source, probe(entry.source))
  }
  return durations
}

/** Wrap a commander action so any error is reported with the CLI tag and a non-zero exit. */
export async function wrapAction(tag: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  }
  catch (error) {
    console.error(`[${tag}] error: ${(error as Error).message}`)
    process.exitCode = 1
  }
}

/** Commander action that lists discovered per-episode specs with their counts. */
export function makeListAction(
  tag: string,
  baseDir: string,
  specFilename: string,
  emptyMessage: string,
  describe: (path: string) => string,
): () => void {
  return () => {
    const names = discoverEpisodeDirs(baseDir, specFilename)
    if (names.length === 0) {
      console.log(`[${tag}] ${emptyMessage}`)
      return
    }
    for (const name of names) {
      try {
        console.log(`  ${name}: ${describe(join(baseDir, name, specFilename))}`)
      }
      catch (error) {
        console.log(`  ${name}: ERROR (${(error as Error).message})`)
      }
    }
  }
}

/** Format seconds elapsed since startedAt for the "finished in Xs" report. */
export function elapsedSeconds(startedAt: number): string {
  return ((Date.now() - startedAt) / 1000).toFixed(1)
}

/**
 * Read + JSON.parse + validate a per-episode spec file, wrapping failures in a
 * path-aware message. Shared by manifest.ts and framespec.ts.
 */
export function loadSpec<T>(path: string, kind: string, parse: (raw: unknown) => T): T {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  }
  catch {
    throw new Error(`cannot read ${kind}: ${path}`)
  }
  try {
    return parse(JSON.parse(text) as unknown)
  }
  catch (error) {
    throw new Error(`cannot parse ${kind} ${path}: ${(error as Error).message}`)
  }
}