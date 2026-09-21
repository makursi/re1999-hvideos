import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The pipeline "kind" subdirectory under each project in the work root
 * (ADR-0009): `clips` for manifest specs, `screenshots` for frames specs.
 * This is the 类 concept from CONTEXT.md — a union, not a free-form string.
 */
export type SpecKind = 'clips' | 'screenshots'

/**
 * One discovered spec file: its project, unit name, and absolute-in-repo path.
 */
export interface DiscoveredSpec {
  project: string
  unit: string
  specPath: string
}

/**
 * Discover unit directories under `baseDir` that contain `specFilename`
 * (e.g. "manifest.json" under media/work/<project>/clips, "frames.json" under
 * media/work/<project>/screenshots). Returns unit names sorted numerically
 * (ep1 < ep2 < ep10), or [] if baseDir is missing.
 */
export function discoverUnitDirs(baseDir: string, specFilename: string): string[] {
  let entries
  try {
    entries = readdirSync(baseDir, { withFileTypes: true })
  }
  catch {
    return []
  }
  return entries
    .filter(e => e.isDirectory() && existsSync(join(baseDir, e.name, specFilename)))
    .map(e => e.name)
    .sort(compareUnitNames)
}

/**
 * Walk the whole three-stage spec tree under `baseDir`
 * (`<baseDir>/<project>/<kind>/<unit>/<specFilename>`, ADR-0009) into a flat
 * list of discovered specs, project-major (ASCII sort) with units numerically
 * sorted within each project. Projects whose `<kind>` dir has no spec file are
 * skipped; returns [] when the base dir is missing.
 */
export function discoverSpecs(baseDir: string, kind: SpecKind, specFilename: string): DiscoveredSpec[] {
  let entries
  try {
    entries = readdirSync(baseDir, { withFileTypes: true })
  }
  catch {
    return []
  }
  const specs: DiscoveredSpec[] = []
  for (const project of entries.filter(e => e.isDirectory()).map(e => e.name).sort()) {
    const unitDir = join(baseDir, project, kind)
    for (const unit of discoverUnitDirs(unitDir, specFilename))
      specs.push({ project, unit, specPath: join(unitDir, unit, specFilename) })
  }
  return specs
}

function compareUnitNames(a: string, b: string): number {
  const numA = Number(a.match(/\d+/)?.[0] ?? NaN)
  const numB = Number(b.match(/\d+/)?.[0] ?? NaN)
  if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB)
    return numA - numB
  return a.localeCompare(b)
}