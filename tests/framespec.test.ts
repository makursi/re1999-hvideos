import { describe, expect, it } from 'vitest'
import { parseFrameSpec, resolveFrameEntry } from '../src/framespec.js'

describe('parseFrameSpec', () => {
  it('parses a valid spec with jpg/png/webp entries', () => {
    const spec = parseFrameSpec({
      screenshots: [
        { id: 'ep01-f01', source: 'media/raw/videos/ep01.mp4', at: '00:01:20', format: 'jpg' },
        { id: 'ep01-f02', source: 'media/raw/videos/ep01.mp4', at: 95, format: 'png' },
        { id: 'ep01-f03', source: 'media/raw/videos/ep01.mp4', at: '00:01:40.5', format: 'webp' },
      ],
    })
    expect(spec.screenshots).toHaveLength(3)
    expect(spec.screenshots[0]).toMatchObject({ id: 'ep01-f01', format: 'jpg' })
    expect(spec.screenshots[1]).toMatchObject({ at: 95, format: 'png' })
    expect(spec.screenshots[2]).toMatchObject({ format: 'webp' })
  })

  it('rejects an unknown format', () => {
    expect(() =>
      parseFrameSpec({
        screenshots: [{ id: 'f1', source: 'a.mp4', at: 1, format: 'gif' }],
      }),
    ).toThrow(/format/)
  })

  it('rejects an empty or missing screenshots array', () => {
    expect(() => parseFrameSpec({})).toThrow(/screenshots/)
    expect(() => parseFrameSpec({ screenshots: [] })).toThrow(/screenshots/)
  })

  it('rejects duplicate ids within one spec', () => {
    expect(() =>
      parseFrameSpec({
        screenshots: [
          { id: 'f1', source: 'a.mp4', at: 1, format: 'jpg' },
          { id: 'f1', source: 'a.mp4', at: 2, format: 'png' },
        ],
      }),
    ).toThrow(/duplicate/)
  })

  it('rejects an invalid at time', () => {
    expect(() =>
      parseFrameSpec({
        screenshots: [{ id: 'f1', source: 'a.mp4', at: 'not-a-time', format: 'jpg' }],
      }),
    ).toThrow()
  })

  it('rejects non-ASCII ids and dirs (path rule)', () => {
    expect(() =>
      parseFrameSpec({
        screenshots: [{ id: '帧1', source: 'a.mp4', at: 1, format: 'jpg' }],
      }),
    ).toThrow(/ASCII/)
    expect(() =>
      parseFrameSpec({
        screenshots: [{ id: 'f1', source: 'a.mp4', at: 1, format: 'jpg', dir: '集1' }],
      }),
    ).toThrow(/ASCII/)
  })

  it('rejects non-ASCII source paths (path rule)', () => {
    expect(() =>
      parseFrameSpec({
        screenshots: [{ id: 'f1', source: 'media/raw/第1集/ep01.mp4', at: 1, format: 'jpg' }],
      }),
    ).toThrow(/ASCII/)
  })
})


describe('resolveFrameEntry', () => {
  it('defaults the output dir to the spec directory', () => {
    const entry = parseFrameSpec({
      screenshots: [{ id: 'ep01-f01', source: 'a.mp4', at: '00:01:20', format: 'jpg' }],
    }).screenshots[0]!
    expect(resolveFrameEntry(entry, 'media/screenshots/ep1')).toEqual({
      at: 80,
      output: 'media/screenshots/ep1/ep01-f01.jpg',
    })
  })

  it('an explicit dir wins over the spec directory', () => {
    const entry = parseFrameSpec({
      screenshots: [{ id: 'ep01-f01', source: 'a.mp4', at: 95, format: 'webp', dir: 'media/screenshots/ep2' }],
    }).screenshots[0]!
    expect(resolveFrameEntry(entry, 'media/screenshots/ep1')).toEqual({
      at: 95,
      output: 'media/screenshots/ep2/ep01-f01.webp',
    })
  })
})