import { describe, expect, it } from 'vitest'
import { detectPitch, median, nearestNote, TUNER_WINDOW } from '../src/renderer/src/audio/tuner'

const RATE = 48000

/** A plucked-string-like tone: harmonics getting quieter, optionally a weak fundamental. */
function tone(frequency: number, { fundamental = 1, harmonics = 6, noise = 0 } = {}): Float32Array {
  const samples = new Float32Array(TUNER_WINDOW)
  let seed = 1
  const random = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let i = 0; i < samples.length; i++) {
    let value = 0
    for (let h = 1; h <= harmonics; h++) value += ((h === 1 ? fundamental : 1) / h) * Math.sin((2 * Math.PI * frequency * h * i) / RATE + h)
    samples[i] = 0.2 * value + noise * random()
  }
  return samples
}

const cents = (found: number, expected: number): number => 1200 * Math.log2(found / expected)

describe('tuner (REC-11)', () => {
  it('finds the pitch of guitar and bass strings within a cent', () => {
    // Low B of a five-string bass, low E of a bass, the guitar's strings, and a high fret.
    for (const frequency of [30.87, 41.2, 82.41, 110, 146.83, 196, 246.94, 329.63, 880]) {
      const found = detectPitch(tone(frequency), RATE)!
      expect(Math.abs(cents(found.frequency, frequency)), `${frequency} Hz`).toBeLessThan(1)
    }
  })

  it('is not fooled by a weak fundamental (no octave jump up)', () => {
    const found = detectPitch(tone(82.41, { fundamental: 0.15 }), RATE)!
    expect(Math.abs(cents(found.frequency, 82.41))).toBeLessThan(2)
  })

  it('reads a slightly noisy tone, and nothing in silence or noise', () => {
    expect(Math.abs(cents(detectPitch(tone(196, { noise: 0.05 }), RATE)!.frequency, 196))).toBeLessThan(3)
    expect(detectPitch(new Float32Array(TUNER_WINDOW), RATE)).toBeNull()
    expect(detectPitch(tone(196, { harmonics: 0, noise: 0.3 }), RATE)).toBeNull()
  })

  it('names the nearest note and how far off it is', () => {
    expect(nearestNote(440)).toEqual({ pitch: 69, cents: 0 })
    const sharp = nearestNote(445)
    expect(sharp.pitch).toBe(69)
    expect(sharp.cents).toBeCloseTo(19.56, 1)
    const flat = nearestNote(81)
    expect(flat.pitch).toBe(40) // E2, 82.41 Hz
    expect(flat.cents).toBeCloseTo(-29.8, 1)
    // Past half a semitone it's the next note down: D♯2, sharp.
    expect(nearestNote(80).pitch).toBe(39)
  })

  it('smooths readings with the median', () => {
    expect(median([110, 220, 110.5, 109.8, 110.2])).toBe(110.2)
    expect(median([1, 3])).toBe(2)
  })
})
