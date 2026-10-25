const WINDOW_SECONDS = 0.01

/**
 * Time (s) of the first sound clearly above the noise floor: the first 10 ms
 * window louder than 15 % of the loudest one. Used to suggest beat 1 (REC-21).
 */
export function detectFirstOnset(samples: Float32Array, sampleRate: number): number {
  const size = Math.max(1, Math.round(WINDOW_SECONDS * sampleRate))
  const levels: number[] = []
  for (let start = 0; start < samples.length; start += size) {
    let energy = 0
    const end = Math.min(samples.length, start + size)
    for (let i = start; i < end; i++) energy += samples[i] * samples[i]
    levels.push(Math.sqrt(energy / (end - start)))
  }
  const loudest = Math.max(0, ...levels)
  if (loudest < 1e-4) return 0
  const index = levels.findIndex((level) => level >= loudest * 0.15)
  return (index * size) / sampleRate
}

/** Min/max sample per column, for drawing a waveform `columns` pixels wide. */
export function waveformPeaks(samples: Float32Array, columns: number): { min: Float32Array; max: Float32Array } {
  const min = new Float32Array(columns)
  const max = new Float32Array(columns)
  const perColumn = samples.length / columns
  for (let c = 0; c < columns; c++) {
    const start = Math.floor(c * perColumn)
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((c + 1) * perColumn)))
    let lo = 0
    let hi = 0
    for (let i = start; i < end; i++) {
      if (samples[i] < lo) lo = samples[i]
      if (samples[i] > hi) hi = samples[i]
    }
    min[c] = lo
    max[c] = hi
  }
  return { min, max }
}

/** Seconds per metronome click: one click per beat unit of the time signature (quarter in 4/4, eighth in 6/8). */
export function secondsPerClick(tempo: number, timeSignature: [number, number]): number {
  return (60 / tempo) * (4 / timeSignature[1])
}
