// Recording latency (REQUIREMENTS.md REC-07): how much later a sound played in
// time with the metronome shows up in a recording, through the speakers (or
// headphones) and back in through the input. Measured by recording clicks.
import { readPref, writePref } from '../prefs'
import { median } from './tuner'

const PREF_KEY = 'recordingLatency'

/** The latency used for recordings, in seconds; `measured` if it was measured or typed in, not estimated. */
export interface RecordingLatency {
  seconds: number
  measured: boolean
}

/** What the audio output reports: a guess that leaves out the input's own delay. */
export const estimatedLatency = (ctx: BaseAudioContext & { outputLatency?: number; baseLatency?: number }): number => (ctx.outputLatency || 0) + (ctx.baseLatency || 0)

/** The latency saved on this computer, else the estimate. */
export function recordingLatency(ctx: AudioContext): RecordingLatency {
  const saved = readPref<number | null>(PREF_KEY, null)
  return typeof saved === 'number' && Number.isFinite(saved) && saved >= 0 && saved < 1 ? { seconds: saved, measured: true } : { seconds: estimatedLatency(ctx), measured: false }
}

/** Saves a measured (or typed) latency; null goes back to the estimate. */
export function saveRecordingLatency(seconds: number | null): void {
  writePref(PREF_KEY, seconds)
}

/** Clicks played when measuring: enough to take the median, at 120 BPM. */
export const CALIBRATION_CLICKS = 8
export const CALIBRATION_INTERVAL = 0.5
/** Silence recorded before the first click, to know the noise floor. */
export const CALIBRATION_LEAD = 0.6
/** A click is looked for this long after it was played. */
const SEARCH_SECONDS = 0.4

export interface LatencyMeasurement {
  /** Median delay from playing a click to hearing it in the recording, in seconds. */
  seconds: number
  /** Clicks heard, of all played. */
  heard: number
  /** How much the delays differ (median distance from the median), in seconds. */
  spread: number
}

/**
 * The delay of each click in a recording that started at time 0: where the
 * sound first rises clearly above the noise after it was played; null where it
 * doesn't. `clickTimes` are when the clicks were played, in recording seconds.
 */
export function clickDelays(samples: Float32Array, sampleRate: number, clickTimes: number[]): (number | null)[] {
  const before = Math.max(1, Math.min(samples.length, Math.floor(clickTimes[0] * sampleRate)))
  let energy = 0
  for (let i = 0; i < before; i++) energy += samples[i] * samples[i]
  const noise = Math.sqrt(energy / before)
  return clickTimes.map((time) => {
    const start = Math.max(0, Math.floor(time * sampleRate))
    const end = Math.min(samples.length, start + Math.floor(SEARCH_SECONDS * sampleRate))
    let peak = 0
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]))
    if (end <= start || peak < Math.max(8 * noise, 0.005)) return null
    const threshold = Math.max(5 * noise, 0.25 * peak)
    for (let i = start; i < end; i++) if (Math.abs(samples[i]) >= threshold) return (i - start) / sampleRate
    return null
  })
}

/** The latency from a recording of calibration clicks, or null if too few were heard clearly and steadily. */
export function measureLatency(samples: Float32Array, sampleRate: number, clickTimes: number[]): LatencyMeasurement | null {
  const delays = clickDelays(samples, sampleRate, clickTimes).filter((d): d is number => d !== null)
  if (delays.length < Math.ceil(clickTimes.length / 2)) return null
  const middle = median(delays)
  const spread = median(delays.map((d) => Math.abs(d - middle)))
  if (spread > 0.01) return null
  return { seconds: middle, heard: delays.length, spread }
}
