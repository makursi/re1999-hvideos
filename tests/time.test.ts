import { describe, expect, it } from 'vitest'
import { formatSeconds, parseTimeToSeconds } from '../src/time.js'

describe('parseTimeToSeconds', () => {
  it('parses numbers as seconds', () => {
    expect(parseTimeToSeconds(0)).toBe(0)
    expect(parseTimeToSeconds(65)).toBe(65)
    expect(parseTimeToSeconds(1.5)).toBe(1.5)
  })

  it('parses numeric strings as seconds', () => {
    expect(parseTimeToSeconds('65')).toBe(65)
    expect(parseTimeToSeconds('1.25')).toBe(1.25)
  })

  it('parses MM:SS', () => {
    expect(parseTimeToSeconds('01:23')).toBe(83)
    expect(parseTimeToSeconds('05:28')).toBe(328)
  })

  it('parses HH:MM:SS', () => {
    expect(parseTimeToSeconds('00:00:00')).toBe(0)
    expect(parseTimeToSeconds('00:00:23')).toBe(23)
    expect(parseTimeToSeconds('1:30:15')).toBe(5415)
  })

  it('parses fractional seconds', () => {
    expect(parseTimeToSeconds('00:01:02.5')).toBeCloseTo(62.5)
  })

  it('rejects bad input', () => {
    expect(() => parseTimeToSeconds('abc')).toThrow()
    expect(() => parseTimeToSeconds('-5')).toThrow()
    expect(() => parseTimeToSeconds('00:75:00')).toThrow()
    expect(() => parseTimeToSeconds(NaN)).toThrow()
    expect(() => parseTimeToSeconds(-1)).toThrow()
  })
})

describe('formatSeconds', () => {
  it('formats without fraction when exact', () => {
    expect(formatSeconds(23)).toBe('00:00:23')
    expect(formatSeconds(328)).toBe('00:05:28')
  })

  it('formats with fraction when needed', () => {
    expect(formatSeconds(62.5)).toBe('00:01:02.500')
  })
})