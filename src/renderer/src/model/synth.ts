// Synth instruments (REQUIREMENTS.md §3.10). A patch is a flat set of settings
// so the instrument editor can show one control per field.

export type Waveform = 'pulse' | 'triangle' | 'sawtooth' | 'sine' | 'noise'
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
  crushRate: [0, 44100]
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
  crushRate: 0
}

const WAVEFORMS: Waveform[] = ['pulse', 'triangle', 'sawtooth', 'sine', 'noise']
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
  if (typeof source.mono === 'boolean') patch.mono = source.mono
  for (const [field, [min, max]] of Object.entries(PATCH_LIMITS) as [NumberField, [number, number]][]) {
    const v = source[field]
    if (typeof v === 'number' && Number.isFinite(v)) patch[field] = Math.min(max, Math.max(min, v))
  }
  return patch
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
  preset('Noise hit', { waveform: 'noise', attack: 0.001, decay: 0.12, sustain: 0, release: 0.05, velocity: 0.6 })
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
