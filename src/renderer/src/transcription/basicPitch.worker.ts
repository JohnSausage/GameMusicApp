// Runs Spotify's Basic Pitch model off the UI thread (REQUIREMENTS.md TRN-11).
import * as tf from '@tensorflow/tfjs'
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch'
import weightsUrl from '@spotify/basic-pitch/model/group1-shard1of1.bin?url'
import modelUrl from '@spotify/basic-pitch/model/model.json?url'
import type { DetectedNote } from './notes'

export interface BasicPitchRequest {
  /** Mono audio at 22 050 Hz. */
  samples: Float32Array
  onsetThreshold: number
  frameThreshold: number
  minNoteFrames: number
  minFrequency: number
  maxFrequency: number
}

export type BasicPitchResponse =
  | { type: 'progress'; percent: number }
  | { type: 'done'; notes: DetectedNote[]; backend: string }
  | { type: 'error'; message: string }

// tfjs-core 3.x checks `if (!window ...)` in setTimeoutCustom, which throws a
// ReferenceError in workers. Declaring it as undefined makes tfjs use setTimeout.
;(self as unknown as { window: undefined }).window = undefined

const post = (message: BasicPitchResponse): void => self.postMessage(message)

// Basic Pitch doesn't propagate some async errors to evaluateModel's promise.
self.addEventListener('unhandledrejection', (event) => {
  post({ type: 'error', message: event.reason instanceof Error ? event.reason.message : String(event.reason) })
})

let basicPitch: BasicPitch | null = null

self.onmessage = async (event: MessageEvent<BasicPitchRequest>) => {
  const request = event.data
  try {
    basicPitch ??= new BasicPitch(tf.loadGraphModel(modelUrl, { weightUrlConverter: async () => weightsUrl }))
    const frames: number[][] = []
    const onsets: number[][] = []
    await basicPitch.evaluateModel(
      request.samples,
      (f, o) => {
        frames.push(...f)
        onsets.push(...o)
      },
      (percent) => post({ type: 'progress', percent })
    )
    const events = outputToNotesPoly(
      frames,
      onsets,
      request.onsetThreshold,
      request.frameThreshold,
      request.minNoteFrames,
      true,
      request.maxFrequency,
      request.minFrequency
    )
    const notes = noteFramesToTime(events).map((n) => ({
      start: n.startTimeSeconds,
      duration: n.durationSeconds,
      pitch: n.pitchMidi,
      amplitude: n.amplitude
    }))
    post({ type: 'done', notes, backend: tf.getBackend() })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
