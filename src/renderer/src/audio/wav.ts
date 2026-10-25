/** Encodes PCM channels as a 16-bit WAV file. */
export function encodeWav16(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length
  const frameCount = channels[0]?.length ?? 0
  const dataSize = frameCount * channelCount * 2
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)

  const writeText = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channelCount * 2, true)
  view.setUint16(32, channelCount * 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < channelCount; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return bytes
}

/** Reads a 16-bit PCM WAV file (as written by encodeWav16). */
export function decodeWav16(bytes: Uint8Array): { channels: Float32Array[]; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (bytes.length < 12 || text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new Error('Not a WAV file')

  let channelCount = 0
  let sampleRate = 0
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = text(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      if (view.getUint16(body, true) !== 1 || view.getUint16(body + 14, true) !== 16) throw new Error('Only 16-bit PCM WAV is supported')
      channelCount = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
    } else if (id === 'data') {
      if (!channelCount) throw new Error('WAV data before format')
      const frames = Math.floor(Math.min(size, bytes.length - body) / (2 * channelCount))
      const channels = Array.from({ length: channelCount }, () => new Float32Array(frames))
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channelCount; c++) {
          const value = view.getInt16(body + (i * channelCount + c) * 2, true)
          channels[c][i] = value < 0 ? value / 0x8000 : value / 0x7fff // mirrors encodeWav16
        }
      }
      return { channels, sampleRate }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV file has no audio data')
}

export function audioBufferToWav16(buffer: AudioBuffer): Uint8Array {
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  return encodeWav16(channels, buffer.sampleRate)
}

/** Peak absolute sample value across all channels. */
export function peakLevel(channels: Float32Array[]): number {
  let peak = 0
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]))
  }
  return peak
}
