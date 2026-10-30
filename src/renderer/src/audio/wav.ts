/** WAV sample formats (REQUIREMENTS.md EXP-04): 16-bit and 24-bit integer PCM, or 32-bit float. */
export type WavFormat = 'pcm16' | 'pcm24' | 'float32'

export const WAV_FORMATS: { format: WavFormat; label: string }[] = [
  { format: 'pcm16', label: '16-bit' },
  { format: 'pcm24', label: '24-bit' },
  { format: 'float32', label: '32-bit float' }
]

const BYTES: Record<WavFormat, number> = { pcm16: 2, pcm24: 3, float32: 4 }

/**
 * Encodes channels as a WAV file. Integer samples are clipped to −1…1; float
 * samples are kept as they are (louder than 0 dB survives). A float file has
 * the longer format chunk and the "fact" chunk the WAV spec asks for.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number, format: WavFormat = 'pcm16'): Uint8Array {
  const channelCount = channels.length
  const frameCount = channels[0]?.length ?? 0
  const bytes = BYTES[format]
  const float = format === 'float32'
  const fmtSize = float ? 18 : 16
  const factSize = float ? 12 : 0
  const header = 12 + 8 + fmtSize + factSize + 8
  const dataSize = frameCount * channelCount * bytes
  const out = new Uint8Array(header + dataSize + (dataSize % 2))
  const view = new DataView(out.buffer)

  const writeText = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeText(0, 'RIFF')
  view.setUint32(4, out.length - 8, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, fmtSize, true)
  view.setUint16(20, float ? 3 : 1, true) // IEEE float or PCM
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channelCount * bytes, true)
  view.setUint16(32, channelCount * bytes, true)
  view.setUint16(34, bytes * 8, true)
  let offset = 36
  if (float) {
    view.setUint16(36, 0, true) // no extra format bytes
    writeText(38, 'fact')
    view.setUint32(42, 4, true)
    view.setUint32(46, frameCount, true)
    offset = 50
  }
  writeText(offset, 'data')
  view.setUint32(offset + 4, dataSize, true)

  offset += 8
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < channelCount; c++) {
      const value = channels[c][i]
      if (float) view.setFloat32(offset, value, true)
      else {
        const sample = Math.max(-1, Math.min(1, value))
        if (format === 'pcm16') view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
        else {
          const int = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff)
          view.setUint8(offset, int & 0xff)
          view.setUint8(offset + 1, (int >> 8) & 0xff)
          view.setUint8(offset + 2, (int >> 16) & 0xff)
        }
      }
      offset += bytes
    }
  }
  return out
}

/** Encodes PCM channels as a 16-bit WAV file. */
export const encodeWav16 = (channels: Float32Array[], sampleRate: number): Uint8Array => encodeWav(channels, sampleRate, 'pcm16')

/** Reads a WAV file: 16-bit or 24-bit PCM, or 32-bit float (as written by encodeWav). */
export function decodeWav(bytes: Uint8Array): { channels: Float32Array[]; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (bytes.length < 12 || text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new Error('Not a WAV file')

  let channelCount = 0
  let sampleRate = 0
  let format: WavFormat | null = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = text(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      const tag = view.getUint16(body, true)
      const bits = view.getUint16(body + 14, true)
      format = tag === 1 && bits === 16 ? 'pcm16' : tag === 1 && bits === 24 ? 'pcm24' : tag === 3 && bits === 32 ? 'float32' : null
      if (!format) throw new Error('Only 16-bit or 24-bit PCM and 32-bit float WAV are supported')
      channelCount = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
    } else if (id === 'data') {
      if (!format || !channelCount) throw new Error('WAV data before format')
      const width = BYTES[format]
      const frames = Math.floor(Math.min(size, bytes.length - body) / (width * channelCount))
      const channels = Array.from({ length: channelCount }, () => new Float32Array(frames))
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channelCount; c++) {
          const at = body + (i * channelCount + c) * width
          if (format === 'float32') channels[c][i] = view.getFloat32(at, true)
          else if (format === 'pcm16') {
            const value = view.getInt16(at, true)
            channels[c][i] = value < 0 ? value / 0x8000 : value / 0x7fff // mirrors encodeWav
          } else {
            const value = ((view.getUint8(at + 2) << 24) | (view.getUint8(at + 1) << 16) | (view.getUint8(at) << 8)) >> 8
            channels[c][i] = value < 0 ? value / 0x800000 : value / 0x7fffff
          }
        }
      }
      return { channels, sampleRate }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV file has no audio data')
}

/** The channels of an audio buffer. */
export const bufferChannels = (buffer: AudioBuffer): Float32Array[] => Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))

export function audioBufferToWav(buffer: AudioBuffer, format: WavFormat = 'pcm16'): Uint8Array {
  return encodeWav(bufferChannels(buffer), buffer.sampleRate, format)
}

/** Peak absolute sample value across all channels. */
export function peakLevel(channels: Float32Array[]): number {
  let peak = 0
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]))
  }
  return peak
}
