import { describe, expect, it } from 'vitest'
import { parseManifest, resolveClipTimes } from '../../src/clip/manifest.js'

describe('parseManifest', () => {
  it('rejects non-ASCII ids (path rule)', () => {
    expect(() =>
      parseManifest({
        clips: [{ id: '片段1', source: 'a.mp4', in: 0, out: 1 }],
      }),
    ).toThrow(/ASCII/)
  })
})

describe('resolveClipTimes', () => {  it('resolves string times to seconds', () => {
    const clip = { id: 'c1', source: 'a.mp4', in: '00:01:30', out: '00:02:10' }
    expect(resolveClipTimes(clip)).toEqual({ start: 90, end: 130 })
  })

  it('resolves numeric seconds', () => {
    const clip = { id: 'c1', source: 'a.mp4', in: 0, out: 23 }
    expect(resolveClipTimes(clip)).toEqual({ start: 0, end: 23 })
  })
})