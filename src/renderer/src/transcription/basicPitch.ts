// Note extraction only (no TensorFlow): importing from esm/toMidi keeps the model code in the worker.
import { noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch/esm/toMidi'
import { midiToFrequency } from '../audio/chipVoice'
import type { BasicPitchRequest, BasicPitchResponse } from './basicPitch.worker'
import { toSingleNotes, type DetectedNote } from './notes'

const MODEL_SAMPLE_RATE = 22050

/** Raw Basic Pitch output for a take: per-frame note and onset probabilities. */
export interface ModelOutput {
  frames: number[][]
  onsets: number[][]
  backend: string
  seconds: number
}

export type Sensitivity = 'low' | 'normal' | 'high'

/** Higher sensitivity finds quieter and shorter notes, but also more noise. */
const THRESHOLDS: Record<Sensitivity, { onset: number; frame: number; minFrames: number }> = {
  low: { onset: 0.6, frame: 0.4, minFrames: 8 },
  normal: { onset: 0.5, frame: 0.3, minFrames: 6 },
  high: { onset: 0.35, frame: 0.25, minFrames: 4 }
}

async function resample(samples: Float32Array, sampleRate: number, targetRate: number): Promise<Float32Array> {
  if (sampleRate === targetRate) return samples
  const length = Math.ceil((samples.length * targetRate) / sampleRate)
  const offline = new OfflineAudioContext(1, length, targetRate)
  const buffer = offline.createBuffer(1, samples.length, sampleRate)
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
  const source = offline.createBufferSource()
  source.buffer = buffer
  source.connect(offline.destination)
  source.start()
  return (await offline.startRendering()).getChannelData(0)
}

/** Runs the Basic Pitch model on a take, in a Web Worker. */
export async function runBasicPitch(samples: Float32Array, sampleRate: number, onProgress: (percent: number) => void): Promise<ModelOutput> {
  const started = performance.now()
  const resampled = await resample(samples, sampleRate, MODEL_SAMPLE_RATE)
  const worker = new Worker(new URL('./basicPitch.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<ModelOutput>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<BasicPitchResponse>) => {
        const message = event.data
        if (message.type === 'progress') onProgress(message.percent)
        else if (message.type === 'done') {
          resolve({ frames: message.frames, onsets: message.onsets, backend: message.backend, seconds: (performance.now() - started) / 1000 })
        } else reject(new Error(message.message))
      }
      worker.onerror = (event) => reject(new Error(event.message || 'Basic Pitch worker failed to start'))
      const request: BasicPitchRequest = { samples: resampled }
      worker.postMessage(request)
    })
  } finally {
    worker.terminate()
  }
}

/**
 * Turns model output into single notes (TRN-03, TRN-08), limited to the pitch
 * range of the target instrument.
 */
export function extractNotes(model: ModelOutput, sensitivity: Sensitivity, range: { minPitch: number; maxPitch: number }): DetectedNote[] {
  const t = THRESHOLDS[sensitivity]
  // outputToNotesPoly modifies its inputs, so it gets copies.
  const events = outputToNotesPoly(
    model.frames.map((row) => row.slice()),
    model.onsets.map((row) => row.slice()),
    t.onset,
    t.frame,
    t.minFrames,
    true,
    midiToFrequency(range.maxPitch + 0.5),
    midiToFrequency(range.minPitch - 0.5)
  )
  const notes = noteFramesToTime(events).map((n) => ({ start: n.startTimeSeconds, duration: n.durationSeconds, pitch: n.pitchMidi, amplitude: n.amplitude }))
  return toSingleNotes(notes)
}
