// AudioWorklet processors: "chip-synth" (one per synth track or live preview)
// and "bitcrusher" (master effect). Loaded with audioWorklet.addModule().
import { normalizePatch, type SynthPatch } from '../../model/synth'
import type { PitchChange } from '../../model/timing'
import { Bitcrusher, ChipSynth } from './chipSynthCore'

// AudioWorkletGlobalScope (not part of TypeScript's DOM types).
declare const sampleRate: number
declare const currentFrame: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: AudioWorkletNodeOptions)
}
declare function registerProcessor(name: string, processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor): void

export interface SynthNote {
  /** Context time in seconds. */
  time: number
  pitch: number
  velocity: number
  duration: number
  /** Hammer-ons, pull-offs and slides; their times are context times too. */
  bends?: PitchChange[]
}

export type ChipSynthMessage =
  | ({ type: 'note' } & SynthNote)
  | { type: 'on'; pitch: number; velocity: number }
  | { type: 'off'; pitch: number }
  | { type: 'patch'; patch: SynthPatch }
  | { type: 'dispose' }

export interface ChipSynthOptions {
  patch: SynthPatch
  /** Notes known up front (offline WAV export: messages aren't reliable before rendering starts). */
  notes?: SynthNote[]
}

class ChipSynthProcessor extends AudioWorkletProcessor {
  private readonly synth: ChipSynth
  private alive = true

  constructor(options: AudioWorkletNodeOptions) {
    super(options)
    const { patch, notes = [] } = options.processorOptions as ChipSynthOptions
    this.synth = new ChipSynth(sampleRate, normalizePatch(patch))
    for (const note of notes) this.scheduleNote(note)
    this.port.onmessage = (event: MessageEvent<ChipSynthMessage>) => this.handle(event.data)
  }

  private scheduleNote(note: SynthNote): void {
    const start = Math.round(note.time * sampleRate)
    this.synth.schedule({ frame: start, type: 'on', pitch: note.pitch, velocity: note.velocity })
    for (const bend of note.bends ?? []) {
      this.synth.schedule({ frame: Math.round(bend.time * sampleRate), type: 'bend', pitch: note.pitch, velocity: 0, to: bend.pitch, glide: bend.glide })
    }
    this.synth.schedule({ frame: start + Math.max(1, Math.round(note.duration * sampleRate)), type: 'off', pitch: note.pitch, velocity: 0 })
  }

  private handle(message: ChipSynthMessage): void {
    switch (message.type) {
      case 'note':
        this.scheduleNote(message)
        break
      case 'on':
        this.synth.schedule({ frame: currentFrame, type: 'on', pitch: message.pitch, velocity: message.velocity })
        break
      case 'off':
        this.synth.schedule({ frame: currentFrame, type: 'off', pitch: message.pitch, velocity: 0 })
        break
      case 'patch':
        this.synth.setPatch(normalizePatch(message.patch))
        break
      case 'dispose':
        this.synth.reset()
        this.alive = false
        break
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    if (output?.[0]) {
      this.synth.render(output[0], currentFrame)
      for (let c = 1; c < output.length; c++) output[c].set(output[0])
    }
    return this.alive
  }
}

export interface BitcrusherOptions {
  bits: number
  rate: number
}

class BitcrusherProcessor extends AudioWorkletProcessor {
  private readonly crushers: Bitcrusher[] = []
  private settings: BitcrusherOptions

  constructor(options: AudioWorkletNodeOptions) {
    super(options)
    this.settings = options.processorOptions as BitcrusherOptions
    this.port.onmessage = (event: MessageEvent<BitcrusherOptions>) => {
      this.settings = event.data
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const output = outputs[0]
    for (let c = 0; c < output.length; c++) {
      const crusher = (this.crushers[c] ??= new Bitcrusher(sampleRate))
      crusher.bits = this.settings.bits
      crusher.rate = this.settings.rate
      const source = input[c] ?? input[0]
      const target = output[c]
      for (let i = 0; i < target.length; i++) target[i] = source ? crusher.process(source[i]) : 0
    }
    return true
  }
}

registerProcessor('chip-synth', ChipSynthProcessor)
registerProcessor('bitcrusher', BitcrusherProcessor)
