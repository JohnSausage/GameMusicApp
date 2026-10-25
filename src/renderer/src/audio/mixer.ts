import type { SynthPatch } from '../model/synth'
import type { BitcrusherOptions, ChipSynthOptions, SynthNote } from './synth/chipSynth.worklet'
import chipSynthWorkletUrl from './synth/chipSynth.worklet.ts?worker&url'

/** Loads the chip synth + bitcrusher processors into a (live or offline) context. */
export function loadSynthWorklet(ctx: BaseAudioContext): Promise<void> {
  return ctx.audioWorklet.addModule(chipSynthWorkletUrl)
}

/** One chip synth (a whole track or the live preview). Notes can be passed up front or sent later. */
export function createChipSynth(ctx: BaseAudioContext, patch: SynthPatch, notes?: SynthNote[]): AudioWorkletNode {
  const processorOptions: ChipSynthOptions = { patch, notes }
  return new AudioWorkletNode(ctx, 'chip-synth', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions })
}

export function createBitcrusher(ctx: BaseAudioContext, settings: BitcrusherOptions): AudioWorkletNode {
  return new AudioWorkletNode(ctx, 'bitcrusher', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    processorOptions: settings
  })
}

export function crushActive(settings: BitcrusherOptions | undefined): settings is BitcrusherOptions {
  return settings !== undefined && (settings.bits < 16 || (settings.rate > 0 && settings.rate < 44100))
}

/** Per-track volume + pan, feeding the master bus. */
export function createTrackBus(ctx: BaseAudioContext, master: AudioNode, volume: number, pan: number): GainNode {
  const gain = ctx.createGain()
  gain.gain.value = volume
  const panner = ctx.createStereoPanner()
  panner.pan.value = pan
  gain.connect(panner).connect(master)
  return gain
}
