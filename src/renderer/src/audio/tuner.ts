// Chromatic tuner (REQUIREMENTS.md REC-11): the pitch of the note being played,
// found with the YIN method (de Cheveigné & Kawahara, 2002), and how far it is
// from the nearest note.

export interface PitchReading {
  frequency: number
  /** 0–1: how clearly the sound repeats (1 = a pure tone). */
  clarity: number
}

/** Lowest pitch looked for: a little below a five-string bass's low B (31 Hz). */
const MIN_HZ = 28
const MAX_HZ = 1400
/** A period is taken where the normalized difference first dips below this. */
const THRESHOLD = 0.15
/** Without such a dip, the deepest one counts if it's below this; otherwise there's no clear note. */
const UNCLEAR = 0.35
/** Quieter than this (RMS) is no note. */
const SILENCE = 0.003

/** Samples to analyze at once: two periods of the lowest pitch, at 48 kHz. */
export const TUNER_WINDOW = 4096

/** In tune: within this many cents of the note. */
export const IN_TUNE_CENTS = 5

/** The pitch of a sound, or null if it's silent or has no clear pitch. */
export function detectPitch(samples: Float32Array, sampleRate: number): PitchReading | null {
  let energy = 0
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i]
  if (Math.sqrt(energy / samples.length) < SILENCE) return null

  const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(samples.length / 2) - 1)
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ))
  const size = samples.length - maxLag - 1
  // How different the sound is from itself `lag` samples later…
  const difference = new Float32Array(maxLag + 2)
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let sum = 0
    for (let i = 0; i < size; i++) {
      const d = samples[i] - samples[i + lag]
      sum += d * d
    }
    difference[lag] = sum
  }
  // …relative to the average for shorter lags, so the period's first dip stands out from those of its multiples.
  const normalized = new Float32Array(maxLag + 2)
  normalized[0] = 1
  let running = 0
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    running += difference[lag]
    normalized[lag] = running > 0 ? (difference[lag] * lag) / running : 1
  }

  let period = -1
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (normalized[lag] >= THRESHOLD) continue
    while (lag < maxLag && normalized[lag + 1] < normalized[lag]) lag++
    period = lag
    break
  }
  if (period < 0) {
    let deepest = minLag
    for (let lag = minLag; lag <= maxLag; lag++) if (normalized[lag] < normalized[deepest]) deepest = lag
    if (normalized[deepest] > UNCLEAR) return null
    period = deepest
  }

  // Between samples: the bottom of a parabola through the dip and its neighbours.
  const [a, b, c] = [difference[period - 1], difference[period], difference[period + 1]]
  const curve = a - 2 * b + c
  const shift = curve > 0 ? (a - c) / (2 * curve) : 0
  return { frequency: sampleRate / (period + Math.max(-1, Math.min(1, shift))), clarity: Math.max(0, 1 - normalized[period]) }
}

/** The nearest note (MIDI number, A4 = 440 Hz) and how many cents the frequency is above (+) or below (−) it. */
export function nearestNote(frequency: number): { pitch: number; cents: number } {
  const exact = 69 + 12 * Math.log2(frequency / 440)
  const pitch = Math.round(exact)
  return { pitch, cents: (exact - pitch) * 100 }
}

/** The middle value: steadier than the average when one reading jumps an octave. */
export function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
