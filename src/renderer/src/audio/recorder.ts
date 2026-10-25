export interface InputSettings {
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
  sampleRate?: number
  deviceLabel: string
}

export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput')
}

/** Records raw mono audio from a microphone with all voice processing disabled (REQUIREMENTS.md REC-03). */
export class MicRecorder {
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private sink: GainNode | null = null
  private chunks: Float32Array[] = []
  onLevel: ((peak: number) => void) | null = null
  inputSettings: InputSettings | null = null

  constructor(private readonly ctx: AudioContext) {}

  async start(deviceId?: string): Promise<void> {
    await this.ctx.resume()
    await this.ctx.audioWorklet.addModule('recorder-worklet.js')
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      }
    })
    const track = this.stream.getAudioTracks()[0]
    const settings = track.getSettings()
    this.inputSettings = {
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
      sampleRate: settings.sampleRate,
      deviceLabel: track.label
    }

    this.chunks = []
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'recorder')
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      this.chunks.push(event.data)
      let peak = 0
      for (let i = 0; i < event.data.length; i++) peak = Math.max(peak, Math.abs(event.data[i]))
      this.onLevel?.(peak)
    }
    // The worklet must be connected to the destination to be processed; a muted gain keeps it silent.
    this.sink = this.ctx.createGain()
    this.sink.gain.value = 0
    this.source.connect(this.node).connect(this.sink).connect(this.ctx.destination)
  }

  stop(): Float32Array {
    this.source?.disconnect()
    this.node?.disconnect()
    this.sink?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    const length = this.chunks.reduce((sum, c) => sum + c.length, 0)
    const samples = new Float32Array(length)
    let offset = 0
    for (const chunk of this.chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    this.chunks = []
    return samples
  }
}

/** Decodes an audio file (e.g. a WAV exported from Audacity) and mixes it down to mono. */
export async function importAudioFile(ctx: BaseAudioContext, file: File): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
  const samples = new Float32Array(buffer.length)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c)
    for (let i = 0; i < channel.length; i++) samples[i] += channel[i] / buffer.numberOfChannels
  }
  return { samples, sampleRate: buffer.sampleRate }
}

export function samplesToBuffer(ctx: BaseAudioContext, samples: Float32Array, sampleRate: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, samples.length, sampleRate)
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
  return buffer
}
