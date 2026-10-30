import { describe, expect, it } from 'vitest'
import { meterPosition, peakOf, toDecibels } from '../src/renderer/src/audio/meter'

describe('master level meter (PLAY-06)', () => {
  it('finds the peak of positive and negative samples', () => {
    expect(peakOf(new Float32Array([0.1, -0.7, 0.5]))).toBeCloseTo(0.7)
    expect(peakOf(new Float32Array(16))).toBe(0)
  })

  it('shows levels in decibels from -48 dB to full scale', () => {
    expect(toDecibels(1)).toBe(0)
    expect(toDecibels(0.5)).toBeCloseTo(-6.02, 2)
    expect(toDecibels(0)).toBe(-Infinity)
    expect(meterPosition(1)).toBe(1)
    expect(meterPosition(1.5)).toBe(1)
    expect(meterPosition(10 ** (-12 / 20))).toBeCloseTo(0.75)
    expect(meterPosition(10 ** (-60 / 20))).toBe(0)
    expect(meterPosition(0)).toBe(0)
  })
})
