import { describe, expect, it } from 'vitest'
import {
  isSolidFrame,
  SOLID_RANGE_MAX,
  SOLID_YAVG_HIGH,
  SOLID_YAVG_LOW,
} from '../src/solid.js'

describe('isSolidFrame', () => {
  it('judges the measured black frame as solid', () => {
    // ep01 @ 165.00 (jpeg file probe): YAVG=0, YMIN=YMAX=0 — the 12KB pure-color product
    expect(isSolidFrame({ yavg: 0, ymin: 0, ymax: 0 })).toBe(true)
  })

  it('judges the measured white strobe frame as solid', () => {
    // ep01 @ 331.00: YAVG=255, YMIN=YMAX=255
    expect(isSolidFrame({ yavg: 255, ymin: 255, ymax: 255 })).toBe(true)
  })

  it('keeps measured content frames valid', () => {
    // ep01 @ 165.16 (fade-in start): YAVG=138, luminance range 0..255
    expect(isSolidFrame({ yavg: 138.228, ymin: 0, ymax: 255 })).toBe(false)
    // ep01 @ 331.08 (between strobe flashes): YAVG=89.5, range 0..255
    expect(isSolidFrame({ yavg: 89.524, ymin: 0, ymax: 255 })).toBe(false)
  })

  it('does not fire on uniform content outside the extreme range', () => {
    expect(isSolidFrame({ yavg: 128, ymin: 120, ymax: 136 })).toBe(false)
    expect(isSolidFrame({ yavg: 40, ymin: 30, ymax: 50 })).toBe(false)
  })

  it('does not fire at the extreme-range boundaries', () => {
    expect(isSolidFrame({ yavg: SOLID_YAVG_LOW + 1, ymin: 0, ymax: 0 })).toBe(false)
    expect(isSolidFrame({ yavg: SOLID_YAVG_HIGH - 1, ymin: 255, ymax: 255 })).toBe(false)
  })

  it('does not fire when the luminance range exceeds SOLID_RANGE_MAX', () => {
    // near-black but with a bright spot: not "whole frame the same brightness"
    expect(isSolidFrame({ yavg: 0, ymin: 0, ymax: SOLID_RANGE_MAX + 1 })).toBe(false)
  })

  it('exports tuned thresholds consistent with measured frames', () => {
    // every measured content frame lies strictly inside (low, high) — 59..158
    expect(SOLID_YAVG_LOW).toBeLessThan(59)
    expect(SOLID_YAVG_HIGH).toBeGreaterThan(158)
    // measured solid frames have range 0; content frames range 255
    expect(SOLID_RANGE_MAX).toBeLessThan(100)
  })
})