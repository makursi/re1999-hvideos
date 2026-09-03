import { describe, expect, it } from 'vitest'
import { buildSequenceArgs, parseSignalStats } from '../src/ffmpeg.js'

describe('parseSignalStats', () => {
  it('parses YAVG/YMIN/YMAX from a real probe emission', () => {
    const text = `
[Parsed_metadata_1 @ 00000181b4dfcd40] lavfi.signalstats.YMIN=0
[Parsed_metadata_1 @ 00000181b4dfcd40] lavfi.signalstats.YLOW=35
[Parsed_metadata_1 @ 00000181b4dfcd40] lavfi.signalstats.YAVG=89.5243
[Parsed_metadata_1 @ 00000181b4dfcd40] lavfi.signalstats.YHIGH=158
[Parsed_metadata_1 @ 00000181b4dfcd40] lavfi.signalstats.YMAX=255
`
    expect(parseSignalStats(text)).toEqual({ yavg: 89.5243, ymin: 0, ymax: 255 })
  })

  it('takes the last occurrence when a frame is emitted twice', () => {
    const text = `
lavfi.signalstats.YAVG=9
lavfi.signalstats.YAVG=16
lavfi.signalstats.YMIN=8
lavfi.signalstats.YMIN=15
lavfi.signalstats.YMAX=8
lavfi.signalstats.YMAX=15
`
    expect(parseSignalStats(text)).toEqual({ yavg: 16, ymin: 15, ymax: 15 })
  })

  it('throws when the probe carries no luminance stats', () => {
    expect(() => parseSignalStats('no stats here')).toThrow(/signalstats/)
  })
})

describe('buildSequenceArgs', () => {
  it('extracts `count` consecutive frame-exact frames in one decode pass (no filtergraph)', () => {
    const args = buildSequenceArgs('src.mp4', 165, 65, 'jpg', 'media/temp/f-%02d.jpg')
    expect(args).toEqual([
      '-y', '-loglevel', 'error',
      '-i', 'src.mp4',
      '-ss', '165',
      '-frames:v', '65',
      '-q:v', '2',
      'media/temp/f-%02d.jpg',
    ])
  })

  it('maps per-format quality options', () => {
    const png = buildSequenceArgs('src.mp4', 1, 65, 'png', 'out-%d.png')
    expect(png.slice(-2)).toEqual(['65', 'out-%d.png'])
    const webp = buildSequenceArgs('src.mp4', 1, 65, 'webp', 'out-%d.webp')
    expect(webp.slice(-3)).toEqual(['-quality', '90', 'out-%d.webp'])
  })

  it('count=1 reproduces the ADR-0004 single-frame extraction (output seek, frame-exact)', () => {
    expect(buildSequenceArgs('src.mp4', 80, 1, 'jpg', 'out.jpg')).toEqual([
      '-y', '-loglevel', 'error', '-i', 'src.mp4', '-ss', '80', '-frames:v', '1', '-q:v', '2', 'out.jpg',
    ])
  })
})