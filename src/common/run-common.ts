import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { discoverSpecs, type SpecKind } from './discovery.js'

/**
 * Shared orchestration glue for the clip and snap CLIs: discovering and
 * selecting per-project/per-unit specs, probing source durations,
 * list/error/elapsed reporting, the work→output product mirror (ADR-0009),
 * and the read → parse → wrap spec loader.
 *
 * ADR-0004 decouples snap from clip at the DOMAIN level: the two pipelines
 * keep separate specs (manifest.json vs frames.json), separate products
 * (mp4 vs images) and separate semantics (range in/out vs instant at). This
 * module shares only the mechanics around those models — never the models
 * themselves. Any help that starts touching "clips" or "screenshots" belongs
 * in the caller.
 *
 * ADR-0009 three-stage layout: specs live under
 * `<workDir>/<project>/<clips|screenshots>/<unit>/<spec>` and products
 * default to `<outputDir>/<project>/<clips|screenshots>/<unit>/`, mirroring
 * the spec path across the work → output roots.
 */

/**
 * One discovered per-unit spec: project, unit name, spec file path, and the
 * loaded spec value (manifest or frames spec, decided by the caller).
 */
export interface Unit<T> {
  project: string
  name: string
  specPath: string
  loaded: T
}

export interface CollectUnitsOptions {
  /** Explicit spec JSON path (single-file mode); otherwise scan baseDir. */
  explicitPath?: string
  /** Only this project (e.g. 1999); absent = all projects. */
  project?: string
  /** Only this unit (e.g. ep1); absent = all units of the selected projects. */
  unit?: string
  /** Noun describing the spec kind for the "not found" error (e.g. "manifests"). */
  kind: string
  /** Unit name fallback in explicit mode when --unit is absent. */
  singleName?: string
}

/**
 * Collect the units to run: either one explicit spec file, or every spec
 * under `<baseDir>/<project>/<kind>/<unit>/` (optionally filtered by
 * --project / --unit). Units come back project-major, numerically sorted
 * within each project. The discovery-and-select shape is identical for clip
 * and snap — only the `<kind>` subdirectory, spec filename and loader differ.
 */
export function collectUnits<T>(
  baseDir: string,
  kind: SpecKind,
  specFilename: string,
  load: (path: string) => T,
  options: CollectUnitsOptions,
): Unit<T>[] {
  if (options.explicitPath) {
    return [{
      project: options.project ?? 'explicit',
      name: options.unit ?? options.singleName ?? 'explicit',
      specPath: options.explicitPath,
      loaded: load(options.explicitPath),
    }]
  }

  const specs = discoverSpecs(baseDir, kind, specFilename)
  let selected = specs
  if (options.project) {
    const inProject = selected.filter(s => s.project === options.project)
    if (inProject.length === 0)
      throw new Error(`project not found: ${options.project} (scanned ${baseDir})`)
    selected = inProject
  }
  if (options.unit) {
    const inUnit = selected.filter(s => s.unit === options.unit)
    if (inUnit.length === 0)
      throw new Error(`unit not found: ${options.unit} (scanned ${baseDir})`)
    selected = inUnit
  }
  if (selected.length === 0)
    throw new Error(`no ${options.kind} found under ${baseDir}/<project>/<kind>/<unit>/${specFilename}`)

  return selected.map(s => ({ project: s.project, name: s.unit, specPath: s.specPath, loaded: load(s.specPath) }))
}

/**
 * Map a spec file path under the work root to the product directory under the
 * output root (ADR-0009): `media/work/<project>/<kind>/<unit>/spec.json` →
 * `media/output/<project>/<kind>/<unit>`. Paths are normalized to forward
 * slashes so the mapping is stable on Windows. Throws when the spec sits
 * outside the work root — in scan mode that is a layout bug, never a silent
 * product directory.
 */
export function mirrorSpecDirToOutput(specPath: string, workDir: string, outputDir: string): string {
  const norm = (p: string) => p.split(/[\\/]+/).filter(Boolean).join('/')
  const specDir = norm(dirname(specPath))
  const work = norm(workDir)
  if (!(specDir === work || specDir.startsWith(work + '/')))
    throw new Error(`spec is outside the work root: ${specPath} (work root: ${workDir})`)
  return norm(outputDir) + specDir.slice(work.length)
}

/**
 * Default product directory for a spec: the work→output mirror, or — when the
 * spec is not under the work root (explicit single-file mode with an
 * arbitrary path) — the spec file's own directory (legacy behaviour).
 */
export function defaultProductDir(specPath: string, workDir: string, outputDir: string): string {
  try {
    return mirrorSpecDirToOutput(specPath, workDir, outputDir)
  }
  catch {
    return dirname(specPath)
  }
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

/**
 * Commander action that lists discovered per-unit specs grouped by project,
 * with their counts. `getBaseDir` is read lazily inside the action
 * (ADR-0007), so an invalid config value surfaces through commander's error
 * handling instead of crashing even `--help` at command-build time.
 */
export function makeListAction(
  tag: string,
  getBaseDir: () => string,
  kind: SpecKind,
  specFilename: string,
  emptyMessage: (baseDir: string) => string,
  describe: (path: string) => string,
): () => void {
  return () => {
    const baseDir = getBaseDir()
    const specs = discoverSpecs(baseDir, kind, specFilename)
    if (specs.length === 0) {
      console.log(`[${tag}] ${emptyMessage(baseDir)}`)
      return
    }
    console.log(`[${tag}]`)
    let currentProject: string | undefined
    for (const spec of specs) {
      if (spec.project !== currentProject) {
        console.log(`  ${spec.project}:`)
        currentProject = spec.project
      }
      try {
        console.log(`    ${spec.unit}: ${describe(spec.specPath)}`)
      }
      catch (error) {
        console.log(`    ${spec.unit}: ERROR (${(error as Error).message})`)
      }
    }
  }
}

/** Format seconds elapsed since startedAt for the "finished in Xs" report. */
export function elapsedSeconds(startedAt: number): string {
  return ((Date.now() - startedAt) / 1000).toFixed(1)
}

/**
 * Read + JSON.parse + validate a per-unit spec file, wrapping failures in a
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