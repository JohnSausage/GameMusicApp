import type { BasicPitchRequest, BasicPitchResponse } from './basicPitch.worker'
import type { DetectedNote } from './notes'

const MODEL_SAMPLE_RATE = 22050

export interface BasicPitchResult {
  notes: DetectedNote[]
  backend: string
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

/** Polyphonic transcription with Spotify Basic Pitch, run in a Web Worker. */
export async function runBasicPitch(
  samples: Float32Array,
  sampleRate: number,
  onProgress: (percent: number) => void
): Promise<BasicPitchResult> {
  const resampled = await resample(samples, sampleRate, MODEL_SAMPLE_RATE)
  const worker = new Worker(new URL('./basicPitch.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<BasicPitchResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<BasicPitchResponse>) => {
        const message = event.data
        if (message.type === 'progress') onProgress(message.percent)
        else if (message.type === 'done') resolve({ notes: message.notes, backend: message.backend })
        else reject(new Error(message.message))
      }
      worker.onerror = (event) => reject(new Error(event.message || 'Basic Pitch worker failed to start'))
      const request: BasicPitchRequest = {
        samples: resampled,
        onsetThreshold: 0.5,
        frameThreshold: 0.3,
        minNoteFrames: 6,
        minFrequency: 75,
        maxFrequency: 1400
      }
      worker.postMessage(request)
    })
  } finally {
    worker.terminate()
  }
}
