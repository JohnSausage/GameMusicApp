import { describe, expect, it } from 'vitest'
import { clickDelays, measureLatency } from '../src/renderer/src/audio/latency'

const RATE = 48000
const clickTimes = Array.from({ length: 8 }, (_, i) => 0.6 + i * 0.5)

/** A recording of the clicks coming back `delay` seconds late (a decaying 1 kHz tone each), with some noise. */
function recording(delay: number | ((i: number) => number), { noise = 0.002, loudness = 0.3, skip = [] as number[] } = {}): Float32Array {
  const samples = new Float32Array(Math.ceil((clickTimes[7] + 1) * RATE))
  let seed = 7
  for (let i = 0; i < samples.length; i++) samples[i] = noise * (((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1)
  clickTimes.forEach((time, k) => {
    if (skip.includes(k)) return
    const start = Math.round((time + (typeof delay === 'number' ? delay : delay(k))) * RATE)
    for (let i = 0; i < 0.05 * RATE; i++) samples[start + i] += loudness * Math.exp(-i / (0.01 * RATE)) * Math.sin((2 * Math.PI * 1000 * i) / RATE)
  })
  return samples
}

describe('recording latency (REC-07)', () => {
  it('measures how late the clicks come back', () => {
    const found = measureLatency(recording(0.042), RATE, clickTimes)!
    expect(found.heard).toBe(8)
    expect(Math.abs(found.seconds - 0.042)).toBeLessThan(0.001)
  })

  it('takes the median, so one odd click does not count', () => {
    const found = measureLatency(recording((i) => (i === 3 ? 0.2 : 0.03)), RATE, clickTimes)!
    expect(Math.abs(found.seconds - 0.03)).toBeLessThan(0.001)
  })

  it('works with half of the clicks missed', () => {
    const delays = clickDelays(recording(0.05, { skip: [0, 2, 4] }), RATE, clickTimes)
    expect(delays.filter((d) => d === null)).toHaveLength(3)
    expect(measureLatency(recording(0.05, { skip: [0, 2, 4] }), RATE, clickTimes)).not.toBeNull()
  })

  it('gives up when the clicks are lost in the noise or all over the place', () => {
    expect(measureLatency(recording(0.04, { loudness: 0.005, noise: 0.004 }), RATE, clickTimes)).toBeNull()
    expect(measureLatency(recording((i) => 0.02 + i * 0.03), RATE, clickTimes)).toBeNull()
    expect(measureLatency(new Float32Array(5 * RATE), RATE, clickTimes)).toBeNull()
  })
})
