// Runs Spotify's Basic Pitch model off the UI thread (REQUIREMENTS.md TRN-11).
// It returns the raw model output; turning that into notes is cheap and happens
// on the main thread, so changing the sensitivity doesn't re-run the model.
import * as tf from '@tensorflow/tfjs'
import { BasicPitch } from '@spotify/basic-pitch'
import weightsUrl from '@spotify/basic-pitch/model/group1-shard1of1.bin?url'
import modelUrl from '@spotify/basic-pitch/model/model.json?url'

export interface BasicPitchRequest {
  /** Mono audio at 22 050 Hz. */
  samples: Float32Array
}

export type BasicPitchResponse =
  | { type: 'progress'; percent: number }
  | { type: 'done'; frames: number[][]; onsets: number[][]; backend: string }
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
  try {
    basicPitch ??= new BasicPitch(tf.loadGraphModel(modelUrl, { weightUrlConverter: async () => weightsUrl }))
    const frames: number[][] = []
    const onsets: number[][] = []
    await basicPitch.evaluateModel(
      event.data.samples,
      (f, o) => {
        frames.push(...f)
        onsets.push(...o)
      },
      (percent) => post({ type: 'progress', percent })
    )
    post({ type: 'done', frames, onsets, backend: tf.getBackend() })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
