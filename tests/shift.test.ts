import { describe, expect, it } from 'vitest'
import {
  firstValidFrame,
  planExtraction,
  PROJECT_FPS,
  SHIFT_MAX_FRAMES,
  WindowEndError,
  type ShiftResult,
} from '../src/shift.js'

const noneSolid = () => false

describe('firstValidFrame', () => {
  it('hit: returns the first valid frame after `at` (ep01 f12 case: content resumes at +1 frame)', async () => {
    const result = await firstValidFrame(165, noneSolid)
    expect(result).toEqual({ frames: 1, time: 165 + 1 / PROJECT_FPS })
  })

  it('skips solid frames until the first valid one (ep01 f25 strobe pairs)', async () => {
    const result = await firstValidFrame(331, f => f <= 2)
    expect(result).toEqual({ frames: 3, time: 331 + 3 / PROJECT_FPS })
  })

  it('window exhausted: returns null when every frame in the window is solid', async () => {
    expect(await firstValidFrame(165, () => true)).toBeNull()
  })

  it('window truncation: a predicate throwing WindowEndError aborts the search (no silent far frame)', async () => {
    await expect(firstValidFrame(165, () => {
      throw new WindowEndError()
    })).rejects.toThrow(WindowEndError)
  })

  it('accepts async predicates (the production probing path)', async () => {
    const result = await firstValidFrame(165, async () => false)
    expect(result).toEqual({ frames: 1, time: 165.04 })
  })

  it('bounded by maxFrames and fps (frame index, not seconds, drives the search)', async () => {
    const seen: number[] = []
    const result = await firstValidFrame(0, (f) => {
      seen.push(f)
      return f <= SHIFT_MAX_FRAMES
    })
    expect(seen).toHaveLength(SHIFT_MAX_FRAMES)
    expect(seen.at(-1)).toBe(SHIFT_MAX_FRAMES)
    expect(result).toBeNull()

    const at30 = await firstValidFrame(165, f => f <= 2, SHIFT_MAX_FRAMES, 30)
    expect(at30).toEqual({ frames: 3, time: 165 + 3 / 30 })
  })

  it('exports the tuned window bound (64 frames ≈ 2.56s at 25fps)', () => {
    expect(SHIFT_MAX_FRAMES).toBe(64)
    expect(SHIFT_MAX_FRAMES / PROJECT_FPS).toBeCloseTo(2.56, 9)
  })
})

describe('planExtraction', () => {
  const find = (result: ShiftResult | null) => () => result

  it('direct when `at` itself is a valid frame (search never consulted)', () => {
    let consulted = false
    const plan = planExtraction(false, false, () => {
      consulted = true
      return { frames: 1, time: 1 }
    })
    expect(plan).toEqual({ kind: 'direct' })
    expect(consulted).toBe(false)
  })

  it('shift when `at` is solid and the window yields a valid frame', () => {
    const plan = planExtraction(true, false, find({ frames: 1, time: 165.04 }))
    expect(plan).toEqual({ kind: 'shift', frames: 1, time: 165.04 })
  })

  it('window exhausted: errors instead of silently outputting a far frame', () => {
    const plan = planExtraction(true, false, find(null))
    expect(plan.kind).toBe('error')
    if (plan.kind === 'error')
      expect(plan.reason).toMatch(/window/)
  })

  it('strict mode: judged-bad `at` errors immediately (search never consulted)', () => {
    let consulted = false
    const plan = planExtraction(true, true, () => {
      consulted = true
      return { frames: 1, time: 1 }
    })
    expect(plan.kind).toBe('error')
    if (plan.kind === 'error')
      expect(plan.reason).toMatch(/strict/)
    expect(consulted).toBe(false)
  })

  it('strict mode does not affect valid `at` entries', () => {
    expect(planExtraction(false, true, () => null)).toEqual({ kind: 'direct' })
  })
})