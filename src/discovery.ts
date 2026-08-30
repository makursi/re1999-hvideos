import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Discover episode directories under `baseDir` that contain `specFilename`
 * (e.g. "manifest.json" under media/exports, "frames.json" under media/screenshots).
 * Returns episode names sorted numerically (ep1 < ep2 < ep10), or [] if baseDir is missing.
 */
export function discoverEpisodeDirs(baseDir: string, specFilename: string): string[] {
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
    .sort(compareEpisodeNames)
}

function compareEpisodeNames(a: string, b: string): number {
  const numA = Number(a.match(/\d+/)?.[0] ?? NaN)
  const numB = Number(b.match(/\d+/)?.[0] ?? NaN)
  if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB)
    return numA - numB
  return a.localeCompare(b)
}