// Synth instruments (REQUIREMENTS.md §3.10). A patch is a flat set of settings
// so the instrument editor can show one control per field.

export type Waveform = 'pulse' | 'triangle' | 'sawtooth' | 'sine' | 'noise' | 'fm'
/** The order an arpeggio plays the notes of a chord in. */
export type ArpOrder = 'up' | 'down' | 'updown'
export type LfoTarget = 'off' | 'pitch' | 'volume' | 'duty' | 'cutoff'
export type FilterType = 'off' | 'lowpass' | 'highpass'

export interface SynthPatch {
  name: string
  waveform: Waveform
  /** Pulse width, 0–1 (0.125, 0.25 and 0.5 are the classic 8-bit values). */
  duty: number
  octave: number
  /** Fine tuning in cents. */
  fine: number
  volume: number
  attack: number
  decay: number
  sustain: number
  release: number
  /** How much velocity changes loudness (0 = not at all, 1 = fully). */
  velocity: number
  /** One note at a time; a new note glides from the previous one. */
  mono: boolean
  /** Glide time in seconds (mono only). */
  glide: number
  /** Pitch offset in semitones at the start of a note, sliding to 0 (drums, lasers). */
  pitchEnvAmount: number
  pitchEnvTime: number
  lfoTarget: LfoTarget
  lfoRate: number
  /** 0–1; what it means depends on the target (see LFO_DEPTH_SCALE). */
  lfoDepth: number
  /** Seconds after the note starts before the LFO kicks in (delayed vibrato). */
  lfoDelay: number
  filterType: FilterType
  cutoff: number
  resonance: number
  /** How many octaves the note's envelope opens the filter. */
  filterEnv: number
  /** Bitcrusher: bit depth (16 = off). */
  crushBits: number
  /** Bitcrusher: sample rate in Hz (0 = off). */
  crushRate: number
  /**
   * Arpeggio (SYN-33): notes played together sound one after the other on one
   * voice, this many per second, as chip music plays chords (0 = off).
   */
  arpRate: number
  arpOrder: ArpOrder
  /**
   * FM (SYN-34), with the 'fm' waveform: a sine (the modulator) bends the phase
   * of the sine you hear, as on the Mega Drive. Its frequency, as a ratio to the note's.
   */
  fmRatio: number
  /** How strongly it bends the sound at the note's start (the brightness). */
  fmIndex: number
  /** The share of fmIndex left once the note has settled, and the seconds it takes to fall there. */
  fmSustain: number
  fmDecay: number
  /** The modulator bending itself: grittier, up to noise. */
  fmFeedback: number
  /** Echo (SYN-32): the sound repeated after echoTime seconds, each repeat echoFeedback as loud as the one before. */
  echoTime: number
  echoFeedback: number
  /** How loud the repeats are next to the sound (0 = no echo). */
  echoMix: number
}

type NumberField = { [K in keyof SynthPatch]: SynthPatch[K] extends number ? K : never }[keyof SynthPatch]

/** Allowed range of every numeric setting; used by the editor and to clean up loaded patches. */
export const PATCH_LIMITS: Record<NumberField, [number, number]> = {
  duty: [0.05, 0.95],
  octave: [-3, 3],
  fine: [-100, 100],
  volume: [0, 1],
  attack: [0, 2],
  decay: [0, 3],
  sustain: [0, 1],
  release: [0, 4],
  velocity: [0, 1],
  glide: [0, 1],
  pitchEnvAmount: [-48, 48],
  pitchEnvTime: [0.005, 2],
  lfoRate: [0.1, 20],
  lfoDepth: [0, 1],
  lfoDelay: [0, 2],
  cutoff: [40, 18000],
  resonance: [0.5, 15],
  filterEnv: [-4, 6],
  crushBits: [1, 16],
  crushRate: [0, 44100],
  arpRate: [0, 60],
  fmRatio: [0.5, 16],
  fmIndex: [0, 10],
  fmSustain: [0, 1],
  fmDecay: [0.005, 4],
  fmFeedback: [0, 1],
  echoTime: [0.02, 1],
  echoFeedback: [0, 0.9],
  echoMix: [0, 1]
}

/** What an LFO depth of 1 means for each target. */
export const LFO_DEPTH_SCALE = { pitch: 2 /* semitones */, volume: 1, duty: 0.45, cutoff: 4 /* octaves */ } as const

export const DEFAULT_PATCH: SynthPatch = {
  name: 'Init',
  waveform: 'pulse',
  duty: 0.5,
  octave: 0,
  fine: 0,
  volume: 0.8,
  attack: 0.005,
  decay: 0.1,
  sustain: 0.7,
  release: 0.08,
  velocity: 0.5,
  mono: false,
  glide: 0,
  pitchEnvAmount: 0,
  pitchEnvTime: 0.1,
  lfoTarget: 'off',
  lfoRate: 5,
  lfoDepth: 0.3,
  lfoDelay: 0.2,
  filterType: 'off',
  cutoff: 8000,
  resonance: 0.7,
  filterEnv: 0,
  crushBits: 16,
  crushRate: 0,
  arpRate: 0,
  arpOrder: 'up',
  fmRatio: 1,
  fmIndex: 2,
  fmSustain: 0.3,
  fmDecay: 0.3,
  fmFeedback: 0,
  echoTime: 0.25,
  echoFeedback: 0.35,
  echoMix: 0
}

const WAVEFORMS: Waveform[] = ['pulse', 'triangle', 'sawtooth', 'sine', 'noise', 'fm']
const ARP_ORDERS: ArpOrder[] = ['up', 'down', 'updown']
const LFO_TARGETS: LfoTarget[] = ['off', 'pitch', 'volume', 'duty', 'cutoff']
const FILTER_TYPES: FilterType[] = ['off', 'lowpass', 'highpass']

/**
 * Fills in missing settings and clamps values, so patches from older project
 * files (which only had waveform, duty and ADSR) and edited preset files still work.
 */
export function normalizePatch(value: unknown): SynthPatch {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof SynthPatch, unknown>>
  const patch: SynthPatch = { ...DEFAULT_PATCH }
  if (typeof source.name === 'string') patch.name = source.name
  if (WAVEFORMS.includes(source.waveform as Waveform)) patch.waveform = source.waveform as Waveform
  if (LFO_TARGETS.includes(source.lfoTarget as LfoTarget)) patch.lfoTarget = source.lfoTarget as LfoTarget
  if (FILTER_TYPES.includes(source.filterType as FilterType)) patch.filterType = source.filterType as FilterType
  if (ARP_ORDERS.includes(source.arpOrder as ArpOrder)) patch.arpOrder = source.arpOrder as ArpOrder
  if (typeof source.mono === 'boolean') patch.mono = source.mono
  for (const [field, [min, max]] of Object.entries(PATCH_LIMITS) as [NumberField, [number, number]][]) {
    const v = source[field]
    if (typeof v === 'number' && Number.isFinite(v)) patch[field] = Math.min(max, Math.max(min, v))
  }
  return patch
}

/**
 * A variation of a sound (SYN-13): its settings nudged at random, so it stays
 * the same kind of sound (same waveform, filter and wobble, no sustain if it had
 * none) but comes out a little different, e.g. a second jump or another hit.
 * `random` returns numbers from 0 to 1.
 */
export function varyPatch(patch: SynthPatch, random: () => number = Math.random): SynthPatch {
  /** A factor between 1/spread and spread. */
  const scale = (spread: number): number => spread ** (random() * 2 - 1)
  const shift = (range: number): number => (random() * 2 - 1) * range
  const next: Partial<Record<NumberField, number>> = {
    attack: patch.attack * scale(1.5),
    decay: patch.decay * scale(1.4),
    release: patch.release * scale(1.4)
  }
  if (patch.waveform === 'pulse') next.duty = patch.duty + shift(0.1)
  if (patch.sustain > 0) next.sustain = patch.sustain + shift(0.15)
  if (patch.pitchEnvAmount !== 0) {
    next.pitchEnvAmount = patch.pitchEnvAmount * scale(1.4)
    next.pitchEnvTime = patch.pitchEnvTime * scale(1.5)
  }
  if (patch.lfoTarget !== 'off') {
    next.lfoRate = patch.lfoRate * scale(1.3)
    next.lfoDepth = patch.lfoDepth + shift(0.1)
  }
  if (patch.filterType !== 'off') {
    next.cutoff = patch.cutoff * scale(1.5)
    next.resonance = patch.resonance * scale(1.3)
    next.filterEnv = patch.filterEnv + shift(0.5)
  }
  if (patch.crushBits < 16) next.crushBits = Math.round(patch.crushBits + shift(1.5))
  if (patch.waveform === 'fm') {
    next.fmIndex = patch.fmIndex * scale(1.3)
    next.fmDecay = patch.fmDecay * scale(1.5)
    if (patch.fmFeedback > 0) next.fmFeedback = patch.fmFeedback + shift(0.1)
  }
  if (patch.echoMix > 0) {
    next.echoTime = patch.echoTime * scale(1.2)
    next.echoFeedback = patch.echoFeedback + shift(0.1)
  }
  const varied = { ...patch }
  for (const [field, value] of Object.entries(next) as [NumberField, number][]) {
    const [min, max] = PATCH_LIMITS[field]
    // Three digits are plenty to hear, and keep the numbers in the sound window and the file tidy.
    varied[field] = Math.min(max, Math.max(min, Number(value.toPrecision(3))))
  }
  return varied
}

const preset = (name: string, settings: Partial<SynthPatch>): SynthPatch => ({ ...DEFAULT_PATCH, ...settings, name })

/** Built-in starting points (SYN-10). */
export const FACTORY_PRESETS: SynthPatch[] = [
  preset('8-bit lead', { duty: 0.25, decay: 0.15, sustain: 0.6, release: 0.1, lfoTarget: 'pitch', lfoRate: 6, lfoDepth: 0.12, lfoDelay: 0.25 }),
  preset('8-bit thin lead', { duty: 0.125, decay: 0.15, sustain: 0.6, release: 0.1, lfoTarget: 'pitch', lfoRate: 6, lfoDepth: 0.1, lfoDelay: 0.3 }),
  preset('8-bit square', { duty: 0.5, decay: 0.1, sustain: 0.8, release: 0.06 }),
  preset('PWM lead', { duty: 0.3, sustain: 0.7, release: 0.12, lfoTarget: 'duty', lfoRate: 3, lfoDepth: 0.5, lfoDelay: 0 }),
  preset('Pulse bass', { duty: 0.5, attack: 0.003, decay: 0.08, sustain: 0.8, release: 0.05, velocity: 0.3 }),
  preset('Triangle bass', { waveform: 'triangle', attack: 0.003, decay: 0.05, sustain: 0.95, release: 0.04, velocity: 0.2, volume: 1 }),
  preset('Saw bass', { waveform: 'sawtooth', mono: true, glide: 0.04, decay: 0.25, sustain: 0.4, release: 0.08, filterType: 'lowpass', cutoff: 350, resonance: 4, filterEnv: 3 }),
  preset('Pluck', { attack: 0.002, decay: 0.25, sustain: 0, release: 0.12, filterType: 'lowpass', cutoff: 900, resonance: 2, filterEnv: 3 }),
  preset('Soft pad', { waveform: 'sawtooth', attack: 0.4, decay: 0.6, sustain: 0.7, release: 0.9, volume: 0.6, filterType: 'lowpass', cutoff: 900, resonance: 1, lfoTarget: 'volume', lfoRate: 4, lfoDepth: 0.15, lfoDelay: 0 }),
  preset('Chip bell', { waveform: 'sine', attack: 0.001, decay: 0.7, sustain: 0, release: 0.5, pitchEnvAmount: 12, pitchEnvTime: 0.015, crushBits: 6 }),
  preset('Laser', { duty: 0.5, attack: 0.001, decay: 0.25, sustain: 0, release: 0.05, pitchEnvAmount: 24, pitchEnvTime: 0.25 }),
  preset('Lo-fi lead', { duty: 0.25, sustain: 0.7, release: 0.1, crushBits: 5, crushRate: 11025, lfoTarget: 'pitch', lfoRate: 5.5, lfoDepth: 0.1, lfoDelay: 0.2 }),
  preset('Noise hit', { waveform: 'noise', attack: 0.001, decay: 0.12, sustain: 0, release: 0.05, velocity: 0.6 }),
  preset('Arp chords', { duty: 0.25, decay: 0.1, sustain: 0.7, release: 0.06, arpRate: 30 }),
  preset('Echo lead', { duty: 0.25, decay: 0.15, sustain: 0.6, release: 0.1, lfoTarget: 'pitch', lfoRate: 6, lfoDepth: 0.1, lfoDelay: 0.3, echoTime: 0.3, echoFeedback: 0.4, echoMix: 0.45 }),
  // FM (SYN-34): the 16-bit sounds of the Mega Drive / Genesis.
  preset('FM bass', { waveform: 'fm', attack: 0.002, decay: 0.3, sustain: 0.6, release: 0.06, fmRatio: 1, fmIndex: 4, fmSustain: 0.25, fmDecay: 0.15, fmFeedback: 0.35, velocity: 0.4 }),
  preset('FM slap bass', { waveform: 'fm', attack: 0.001, decay: 0.4, sustain: 0.3, release: 0.05, fmRatio: 0.5, fmIndex: 6, fmSustain: 0.1, fmDecay: 0.06, fmFeedback: 0.2, velocity: 0.5 }),
  preset('FM brass', { waveform: 'fm', attack: 0.06, decay: 0.2, sustain: 0.8, release: 0.12, fmRatio: 1, fmIndex: 2.5, fmSustain: 0.7, fmDecay: 0.25, fmFeedback: 0.5, lfoTarget: 'pitch', lfoRate: 5.5, lfoDepth: 0.08, lfoDelay: 0.35 }),
  preset('FM e-piano', { waveform: 'fm', attack: 0.002, decay: 1.2, sustain: 0.2, release: 0.3, fmRatio: 14, fmIndex: 1.6, fmSustain: 0, fmDecay: 0.12, velocity: 0.6 }),
  preset('FM bell', { waveform: 'fm', attack: 0.001, decay: 1.8, sustain: 0, release: 1, fmRatio: 3.5, fmIndex: 3, fmSustain: 0.2, fmDecay: 0.8 }),
  preset('FM lead', { waveform: 'fm', attack: 0.01, decay: 0.2, sustain: 0.75, release: 0.1, fmRatio: 2, fmIndex: 2, fmSustain: 0.6, fmDecay: 0.3, fmFeedback: 0.6, lfoTarget: 'pitch', lfoRate: 6, lfoDepth: 0.1, lfoDelay: 0.3 }),
  preset('FM organ', { waveform: 'fm', attack: 0.005, decay: 0.05, sustain: 0.9, release: 0.08, fmRatio: 2, fmIndex: 1.2, fmSustain: 1, fmDecay: 0.1, volume: 0.7 })
]

/** Bitcrusher sample rates offered in the UI (0 = off). */
export const CRUSH_RATES = [0, 22050, 16000, 11025, 8000, 5512, 4000, 2000]

export function formatSampleRate(rate: number): string {
  if (rate === 0) return 'Off'
  const k = rate / 1000
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10} kHz`
}

/** One piece of a synth drum kit: which drum (General MIDI note) and how it sounds. */
export interface DrumSound {
  note: number
  /** The pitch the synth plays for this piece (pitch sweeps and noise color depend on it). */
  pitch: number
  patch: SynthPatch
}

const drum = (note: number, pitch: number, name: string, settings: Partial<SynthPatch>): DrumSound => ({
  note,
  pitch,
  patch: { ...DEFAULT_PATCH, attack: 0.001, sustain: 0, release: 0.02, velocity: 0.7, ...settings, name }
})

/** The 8-bit drum kit (SYN-20): triangle sweeps for kick and toms, LFSR noise for snare and cymbals. */
export function eightBitKit(): DrumSound[] {
  return [
    drum(49, 90, '8-bit crash', { waveform: 'noise', decay: 0.9, volume: 0.55 }),
    drum(51, 100, '8-bit ride', { waveform: 'noise', decay: 0.35, volume: 0.35 }),
    drum(46, 96, '8-bit open hat', { waveform: 'noise', decay: 0.25, volume: 0.45 }),
    drum(42, 96, '8-bit closed hat', { waveform: 'noise', decay: 0.035, volume: 0.45 }),
    drum(50, 52, '8-bit high tom', { waveform: 'triangle', decay: 0.25, pitchEnvAmount: 7, pitchEnvTime: 0.12, volume: 1 }),
    drum(47, 47, '8-bit mid tom', { waveform: 'triangle', decay: 0.28, pitchEnvAmount: 7, pitchEnvTime: 0.12, volume: 1 }),
    drum(38, 72, '8-bit snare', { waveform: 'noise', decay: 0.15, volume: 0.7 }),
    drum(45, 43, '8-bit low tom', { waveform: 'triangle', decay: 0.3, pitchEnvAmount: 7, pitchEnvTime: 0.12, volume: 1 }),
    drum(36, 33, '8-bit kick', { waveform: 'triangle', decay: 0.18, pitchEnvAmount: 24, pitchEnvTime: 0.06, volume: 1 })
  ]
}

export function factoryPreset(name: string): SynthPatch {
  return { ...(FACTORY_PRESETS.find((p) => p.name === name) ?? DEFAULT_PATCH) }
}
