// OGG Vorbis export: smaller files than WAV, and the compressed format Unity
// imports (it doesn't read Opus). The Vorbis encoder is the reference one,
// compiled to WebAssembly (wasm-media-encoders); its .wasm is loaded as a file,
// so the package's other (MP3) encoder stays out of the app.
import { createEncoder } from 'wasm-media-encoders'
import oggWasmUrl from 'wasm-media-encoders/wasm/ogg.wasm?url'

let wasm: Promise<WebAssembly.Module> | null = null

function loadEncoder(): Promise<WebAssembly.Module> {
  wasm ??= fetch(oggWasmUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load the OGG encoder (${response.status})`)
      return response.arrayBuffer()
    })
    .then((bytes) => WebAssembly.compile(bytes))
  wasm.catch(() => (wasm = null))
  return wasm
}

/** Vorbis quality from −1 (smallest) to 10 (best); about 64, 112, 160, 192 and 256 kbit/s in stereo. */
export const OGG_QUALITIES: { quality: number; label: string }[] = [
  { quality: 0, label: 'small (about 64 kbit/s)' },
  { quality: 3, label: 'good (about 112 kbit/s)' },
  { quality: 5, label: 'high (about 160 kbit/s)' },
  { quality: 6, label: 'very high (about 192 kbit/s)' },
  { quality: 8, label: 'best (about 256 kbit/s)' }
]

/** Seconds encoded at a time; the page gets a moment in between, to stay responsive and show progress. */
const CHUNK_SECONDS = 2

/** Encodes mono or stereo channels as an OGG Vorbis file. */
export async function encodeOgg(channels: Float32Array[], sampleRate: number, quality = 5, onProgress?: (done: number) => void): Promise<Uint8Array> {
  if (channels.length < 1 || channels.length > 2) throw new Error('OGG export is for mono or stereo')
  const encoder = await createEncoder('audio/ogg', await loadEncoder())
  encoder.configure({ channels: channels.length as 1 | 2, sampleRate, vbrQuality: quality })
  const frames = channels[0].length
  const chunk = Math.round(CHUNK_SECONDS * sampleRate)
  const parts: Uint8Array[] = []
  for (let start = 0; start < frames; start += chunk) {
    // The encoder owns what it returns until the next call: copy it.
    parts.push(encoder.encode(channels.map((c) => c.subarray(start, start + chunk))).slice())
    onProgress?.(Math.min(1, (start + chunk) / frames))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  parts.push(encoder.finalize().slice())
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
