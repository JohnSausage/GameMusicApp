import { PitchDetector } from 'pitchy'
import type { DetectedNote } from './notes'

export interface PitchTrackerOptions {
  frameSize: number
  hopSize: number
  /** MPM clarity (0–1) a frame needs to count as pitched. */
  minClarity: number
  /** Frames quieter than this (dBFS, RMS) count as silence. */
  minDb: number
  /** Loudness jump (dB within ~50 ms) that marks a new pluck. */
  onsetDb: number
  minPitch: number
  maxPitch: number
  minNoteSeconds: number
}

export const DEFAULT_TRACKER_OPTIONS: PitchTrackerOptions = {
  frameSize: 2048,
  hopSize: 256,
  minClarity: 0.88,
  minDb: -50,
  onsetDb: 6,
  minPitch: 40,
  maxPitch: 88,
  minNoteSeconds: 0.05
}

interface Frame {
  time: number
  db: number
  /** Fractional MIDI pitch, or null when unpitched. */
  pitch: number | null
}

function analyzeFrames(samples: Float32Array, sampleRate: number, o: PitchTrackerOptions): Frame[] {
  const detector = PitchDetector.forFloat32Array(o.frameSize)
  detector.minVolumeDecibels = o.minDb
  const frames: Frame[] = []
  for (let offset = 0; offset + o.frameSize <= samples.length; offset += o.hopSize) {
    const window = samples.subarray(offset, offset + o.frameSize)
    let energy = 0
    for (let i = 0; i < window.length; i++) energy += window[i] * window[i]
    const db = 10 * Math.log10(energy / window.length + 1e-12)
    const [frequency, clarity] = detector.findPitch(window, sampleRate)
    const midi = frequency > 0 ? 69 + 12 * Math.log2(frequency / 440) : NaN
    const pitched = clarity >= o.minClarity && db >= o.minDb && midi >= o.minPitch - 0.5 && midi <= o.maxPitch + 0.5
    frames.push({ time: (offset + o.frameSize / 2) / sampleRate, db, pitch: pitched ? midi : null })
  }
  return frames
}

function findOnsets(frames: Frame[], hopSeconds: number, o: PitchTrackerOptions): boolean[] {
  const lookback = Math.max(1, Math.round(0.05 / hopSeconds))
  const refractory = Math.round(0.06 / hopSeconds)
  const onsets = frames.map(() => false)
  let last = -Infinity
  for (let k = 1; k < frames.length; k++) {
    let floor = Infinity
    for (let j = Math.max(0, k - lookback); j < k; j++) floor = Math.min(floor, frames[j].db)
    if (frames[k].db >= o.minDb && frames[k].db - floor >= o.onsetDb && k - last >= refractory) {
      onsets[k] = true
      last = k
    }
  }
  return onsets
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Monophonic note tracking: McLeod pitch method per frame (pitchy), notes split
 * at loudness onsets (new pluck) or at stable pitch changes (slides, hammer-ons).
 */
export function trackNotes(samples: Float32Array, sampleRate: number, options: Partial<PitchTrackerOptions> = {}): DetectedNote[] {
  const o = { ...DEFAULT_TRACKER_OPTIONS, ...options }
  const hopSeconds = o.hopSize / sampleRate
  const frames = analyzeFrames(samples, sampleRate, o)
  const onsets = findOnsets(frames, hopSeconds, o)
  const notes: DetectedNote[] = []

  let current: { startFrame: number; pitches: number[]; peakDb: number } | null = null
  let silentRun = 0
  let changeRun = 0

  const close = (endFrame: number): void => {
    if (!current) return
    const start = frames[current.startFrame].time - (o.frameSize / 2) / sampleRate
    const end = frames[Math.min(endFrame, frames.length - 1)].time - (o.frameSize / 2) / sampleRate
    if (end - start >= o.minNoteSeconds && current.pitches.length > 0) {
      notes.push({
        start: Math.max(0, start),
        duration: end - start,
        pitch: Math.round(median(current.pitches)),
        amplitude: Math.min(1, Math.max(0, (current.peakDb - o.minDb) / -o.minDb))
      })
    }
    current = null
  }

  frames.forEach((frame, k) => {
    if (frame.pitch === null) {
      silentRun++
      if (current && silentRun >= 3) close(k - silentRun + 1)
      return
    }
    silentRun = 0
    if (!current) {
      current = { startFrame: k, pitches: [frame.pitch], peakDb: frame.db }
      changeRun = 0
      return
    }
    if (onsets[k]) {
      close(k)
      current = { startFrame: k, pitches: [frame.pitch], peakDb: frame.db }
      changeRun = 0
      return
    }
    if (Math.abs(frame.pitch - median(current.pitches)) >= 0.75) {
      changeRun++
      if (changeRun >= 3) {
        const switchFrame = k - changeRun + 1
        close(switchFrame)
        current = { startFrame: switchFrame, pitches: frames.slice(switchFrame, k + 1).map((f) => f.pitch!), peakDb: frame.db }
        changeRun = 0
      }
      return
    }
    changeRun = 0
    current.pitches.push(frame.pitch)
    current.peakDb = Math.max(current.peakDb, frame.db)
  })
  close(frames.length - 1)
  return notes
}
