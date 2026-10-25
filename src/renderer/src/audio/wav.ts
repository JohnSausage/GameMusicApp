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
