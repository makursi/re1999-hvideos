import { describe, expect, it } from 'vitest'
import { parseTracklist, resolveTrackTimes } from '../../src/split/tracklist.js'

describe('parseTracklist', () => {
  it('parses a well-formed tracklist', () => {
    const tl = parseTracklist({
      source: 'media/input/mix/a.m4a',
      tracks: [
        { start: '00:00:00', title: 'Intro' },
        { start: '00:02:51', title: 'Second Song' },
      ],
    })
    expect(tl.source).toBe('media/input/mix/a.m4a')
    expect(tl.tracks).toHaveLength(2)
    expect(tl.tracks[0]).toEqual({ start: '00:00:00', title: 'Intro' })
  })

  it('rejects a non-object', () => {
    expect(() => parseTracklist('x')).toThrow(/tracklist must be an object/)
  })

  it('rejects a missing/non-string source', () => {
    expect(() => parseTracklist({ tracks: [{ start: 0, title: 'a' }] }))
      .toThrow(/"source" must be a non-empty string/)
  })

  it('rejects a non-ASCII source path', () => {
    expect(() => parseTracklist({ source: 'media/input/音乐/源.m4a', tracks: [{ start: 0, title: 'a' }] }))
      .toThrow(/ASCII/)
  })

  it('rejects an empty or missing tracks array', () => {
    expect(() => parseTracklist({ source: 'a.m4a' })).toThrow(/tracks must be a non-empty array/)
    expect(() => parseTracklist({ source: 'a.m4a', tracks: [] })).toThrow(/tracks must be a non-empty array/)
  })

  it('rejects a non-ASCII title (path rule)', () => {
    expect(() => parseTracklist({ source: 'a.m4a', tracks: [{ start: 0, title: '歌曲' }] }))
      .toThrow(/ASCII/)
  })

  it('rejects a title with a path-unsafe char (slash, quote, emoji)', () => {
    expect(() => parseTracklist({ source: 'a.m4a', tracks: [{ start: 0, title: 'A/B' }] }))
      .toThrow(/ASCII/)
    expect(() => parseTracklist({ source: 'a.m4a', tracks: [{ start: 0, title: 'A"B' }] }))
      .toThrow(/ASCII/)
  })

  it('accepts titles with spaces and hyphens', () => {
    const tl = parseTracklist({ source: 'a.m4a', tracks: [{ start: 0, title: 'South Bay Night Frequencies - Live' }] })
    expect(tl.tracks[0]!.title).toBe('South Bay Night Frequencies - Live')
  })

  it('rejects an invalid start time', () => {
    expect(() => parseTracklist({ source: 'a.m4a', tracks: [{ start: 'abc', title: 'a' }] }))
      .toThrow(/invalid time/)
  })
})

describe('resolveTrackTimes', () => {
  const tl = {
    source: 'a.m4a',
    tracks: [
      { start: '00:00:00', title: 'One' },
      { start: '00:00:10', title: 'Two' },
      { start: '00:00:30', title: 'Three' },
    ],
  }

  it('derives each end from the next start and the last end from duration', () => {
    const resolved = resolveTrackTimes(tl, 45)
    expect(resolved).toEqual([
      { title: 'One', start: 0, end: 10, filename: '1 - One.m4a' },
      { title: 'Two', start: 10, end: 30, filename: '2 - Two.m4a' },
      { title: 'Three', start: 30, end: 45, filename: '3 - Three.m4a' },
    ])
  })

  it('zero-pads filenames to the track count width', () => {
    const many = {
      source: 'a.m4a',
      tracks: Array.from({ length: 12 }, (_, i) => ({ start: i * 10, title: `T${i}` })),
    }
    const resolved = resolveTrackTimes(many, 200)
    expect(resolved[0]!.filename).toBe('01 - T0.m4a')
    expect(resolved[11]!.filename).toBe('12 - T11.m4a')
  })

  it('throws on non-strictly-increasing starts', () => {
    const bad = {
      source: 'a.m4a',
      tracks: [
        { start: '00:00:10', title: 'First' },
        { start: '00:00:10', title: 'Dup' },
      ],
    }
    expect(() => resolveTrackTimes(bad, 100)).toThrow(/strictly increasing/)
  })

  it('throws when the last start is not before the source duration', () => {
    expect(() => resolveTrackTimes(tl, 30)).toThrow(/not before source duration/)
  })
})
