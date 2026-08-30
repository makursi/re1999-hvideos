import { describe, expect, it } from 'vitest'
import { buildFrameArgs } from '../src/ffmpeg.js'

describe('buildFrameArgs', () => {
  it('decodes frame-exactly by placing -ss after -i', () => {
    const args = buildFrameArgs('src.mp4', 80, 'out.jpg', 'jpg')
    expect(args).toEqual(['-y', '-loglevel', 'error', '-i', 'src.mp4', '-ss', '80', '-frames:v', '1', '-q:v', '2', 'out.jpg'])
  })

  it('maps format-specific quality options', () => {
    expect(buildFrameArgs('src.mp4', 1, 'out.png', 'png')).toEqual(['-y', '-loglevel', 'error', '-i', 'src.mp4', '-ss', '1', '-frames:v', '1', 'out.png'])
    expect(buildFrameArgs('src.mp4', 1, 'out.webp', 'webp')).toEqual(['-y', '-loglevel', 'error', '-i', 'src.mp4', '-ss', '1', '-frames:v', '1', '-quality', '90', 'out.webp'])
  })
})