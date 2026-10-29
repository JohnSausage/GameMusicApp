// Sound effects of the game (jump, coin, laser, …), kept in the project next to
// the song, so they can be heard together and exported in one go. Each effect is
// a short piece of music of its own: one track with its own sound and notes, at
// its own tempo. It is edited as a song of its own (effectSong), as a part of the
// arrangement is, and saved as a WAV file that ends when its sound has faded.
import { emptyBar, TICKS_PER_QUARTER, type Cursor, type EditResult } from './edit'
import { uniqueFileNames } from './fileNames'
import { rollToBars } from './keys'
import { createTrack, keyRow, newId, type Song, type SoundEffect } from './song'
import { DEFAULT_PATCH, factoryPreset, varyPatch, type SynthPatch } from './synth'
import { buildTimeline } from './timing'

export const EFFECT_TEMPO = 120

/** Where the cursor starts in an effect: the first beat, at middle C. */
export const EFFECT_CURSOR: Cursor = { track: 0, bar: 0, beat: 0, string: keyRow(60) }

const effectSongs = new WeakMap<SoundEffect, Song>()

/**
 * An effect as a song of its own, to edit and play: its track, named after it,
 * in 4/4 at its tempo. setEffectSong() puts an edited one back. The same effect
 * gives the same song, so editors only render again when the effect changed.
 */
export function effectSong(effect: SoundEffect): Song {
  let song = effectSongs.get(effect)
  if (!song) {
    song = { title: '', tempo: effect.tempo, timeSignature: [4, 4], tracks: [{ ...effect.track, name: effect.name }], sections: [], takes: [] }
    effectSongs.set(effect, song)
  }
  return song
}

export function findEffect(song: Song, id: string): SoundEffect | null {
  return song.effects?.find((e) => e.id === id) ?? null
}

/** The song with an effect's edited song (see effectSong) put back: its track and tempo. */
export function setEffectSong(song: Song, id: string, edited: Song): Song {
  return { ...song, effects: song.effects?.map((e) => (e.id === id ? { ...e, tempo: edited.tempo, track: edited.tracks[0] } : e)) }
}

/** A name not taken by another effect: `name`, else it numbered ("Jump 2"). */
function freeName(song: Song, name: string): string {
  const taken = new Set((song.effects ?? []).map((e) => e.name))
  if (!taken.has(name)) return name
  const numbered = /^(.*\S) (\d+)$/.exec(name)
  const base = numbered ? numbered[1] : name
  let n = numbered ? Number(numbered[2]) + 1 : 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/** A ready-made sound effect to start from: a sound and its notes. */
export interface EffectTemplate {
  name: string
  /** What it sounds like, for the menu. */
  description: string
  /** Its color in the list (see PART_COLOR_NAMES). */
  color: number
  tempo: number
  /** The 8-bit sound: changes to the default patch. */
  sound: Partial<SynthPatch>
  /** Its notes: pitch (MIDI), and start and length in 32nd notes. */
  notes: { pitch: number; at: number; length: number }[]
}

/** Built-in starting points for sound effects (SYN-37). Sweeps come from the pitch envelope, so most are one note. */
export const EFFECT_TEMPLATES: EffectTemplate[] = [
  {
    name: 'Jump',
    description: 'A short rising sweep',
    color: 1,
    tempo: 120,
    sound: { duty: 0.25, attack: 0.002, decay: 0.22, sustain: 0, release: 0.03, pitchEnvAmount: -10, pitchEnvTime: 0.16 },
    notes: [{ pitch: 72, at: 0, length: 4 }]
  },
  {
    name: 'Coin',
    description: 'Two quick high notes, a pickup',
    color: 6,
    tempo: 120,
    sound: { duty: 0.5, attack: 0.001, decay: 0.45, sustain: 0, release: 0.05 },
    notes: [
      { pitch: 83, at: 0, length: 2 },
      { pitch: 88, at: 2, length: 8 }
    ]
  },
  {
    name: 'Laser',
    description: 'A falling zap',
    color: 7,
    tempo: 120,
    sound: { duty: 0.25, attack: 0.001, decay: 0.2, sustain: 0, release: 0.03, pitchEnvAmount: 24, pitchEnvTime: 0.2 },
    notes: [{ pitch: 76, at: 0, length: 4 }]
  },
  {
    name: 'Hit',
    description: 'A short crunch of noise, e.g. for damage',
    color: 4,
    tempo: 120,
    sound: { waveform: 'noise', attack: 0.001, decay: 0.16, sustain: 0, release: 0.03, pitchEnvAmount: 18, pitchEnvTime: 0.12, velocity: 0.3, crushBits: 8 },
    notes: [{ pitch: 55, at: 0, length: 4 }]
  },
  {
    name: 'Explosion',
    description: 'A long falling rumble of noise',
    color: 2,
    tempo: 120,
    sound: {
      waveform: 'noise',
      volume: 1,
      attack: 0.002,
      decay: 1.2,
      sustain: 0,
      release: 0.2,
      velocity: 0.3,
      pitchEnvAmount: 12,
      pitchEnvTime: 0.8,
      filterType: 'lowpass',
      cutoff: 2500,
      filterEnv: 1.5
    },
    notes: [{ pitch: 43, at: 0, length: 16 }]
  },
  {
    name: 'Power-up',
    description: 'A fast rising arpeggio',
    color: 5,
    tempo: 150,
    sound: { duty: 0.25, attack: 0.001, decay: 0.08, sustain: 0.5, release: 0.06 },
    notes: [60, 64, 67, 72, 76, 79, 84, 88].map((pitch, i) => ({ pitch, at: i, length: i === 7 ? 4 : 1 }))
  },
  {
    name: 'Blip',
    description: 'A tiny high beep, e.g. for menus',
    color: 3,
    tempo: 120,
    sound: { duty: 0.125, attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 },
    notes: [{ pitch: 81, at: 0, length: 2 }]
  }
]

const THIRTY_SECOND = TICKS_PER_QUARTER / 8

/**
 * A new effect at the end of the list: from a template, or one empty bar for an
 * 8-bit sound. It is named after the template ("Jump", "Jump 2", …) and has its color.
 */
export function addEffect(song: Song, cursor: Cursor, template?: EffectTemplate): { result: EditResult; id: string } {
  const name = freeName(song, template?.name ?? 'Effect 1')
  const bar = template
    ? rollToBars(
        template.notes.map((n) => ({ row: keyRow(n.pitch), start: n.at * THIRTY_SECOND, length: n.length * THIRTY_SECOND, velocity: 100 })),
        1,
        TICKS_PER_QUARTER * 4
      )[0]
    : emptyBar({ ...song, timeSignature: [4, 4] })
  const track = createTrack('keys', [bar], name)
  track.instrument = { kind: 'synth', patch: template ? { ...DEFAULT_PATCH, ...template.sound, name: template.name } : factoryPreset('8-bit square') }
  const effect: SoundEffect = { id: newId(), name, tempo: template?.tempo ?? EFFECT_TEMPO, track, ...(template && { color: template.color }) }
  return { result: { song: { ...song, effects: [...(song.effects ?? []), effect] }, cursor }, id: effect.id }
}

/** Nudges the 8-bit sound of an effect at random (see varyPatch). Null for other sounds. */
export function varyEffect(song: Song, cursor: Cursor, id: string, random: () => number = Math.random): EditResult | null {
  const instrument = findEffect(song, id)?.track.instrument
  if (instrument?.kind !== 'synth') return null
  const patch = varyPatch(instrument.patch, random)
  return { song: { ...song, effects: song.effects!.map((e) => (e.id === id ? { ...e, track: { ...e.track, instrument: { kind: 'synth', patch } } } : e)) }, cursor }
}

/** A copy of an effect right after it, to try a variation. */
export function duplicateEffect(song: Song, cursor: Cursor, id: string): { result: EditResult; id: string } | null {
  const effects = song.effects ?? []
  const index = effects.findIndex((e) => e.id === id)
  if (index < 0) return null
  const original = effects[index]
  const copy: SoundEffect = { ...structuredClone(original), id: newId(), name: freeName(song, original.name) }
  copy.track.id = newId()
  return { result: { song: { ...song, effects: effects.toSpliced(index + 1, 0, copy) }, cursor }, id: copy.id }
}

export function deleteEffect(song: Song, cursor: Cursor, id: string): EditResult | null {
  if (!findEffect(song, id)) return null
  return { song: { ...song, effects: song.effects!.filter((e) => e.id !== id) }, cursor }
}

/** Renames an effect or changes its tempo. */
export function updateEffect(song: Song, cursor: Cursor, id: string, change: Partial<Pick<SoundEffect, 'name' | 'tempo'>>): EditResult | null {
  if (!findEffect(song, id)) return null
  return { song: { ...song, effects: song.effects!.map((e) => (e.id === id ? { ...e, ...change } : e)) }, cursor }
}

/** Gives an effect a color (see PART_COLOR_NAMES), or none. */
export function setEffectColor(song: Song, cursor: Cursor, id: string, color: number | null): EditResult | null {
  if (!findEffect(song, id)) return null
  const effects = song.effects!.map((e) => {
    if (e.id !== id) return e
    const { color: _, ...rest } = e
    return color === null ? rest : { ...rest, color }
  })
  return { song: { ...song, effects }, cursor }
}

/** Moves an effect up (-1) or down (1) in the list. */
export function moveEffect(song: Song, cursor: Cursor, id: string, delta: -1 | 1): EditResult | null {
  const effects = song.effects ?? []
  const index = effects.findIndex((e) => e.id === id)
  const to = index + delta
  if (index < 0 || to < 0 || to >= effects.length) return null
  const moved = effects.toSpliced(index, 1).toSpliced(to, 0, effects[index])
  return { song: { ...song, effects: moved }, cursor }
}

/** How long an effect's notes last, in seconds (its sound may ring on a little after). 0 without notes. */
export function effectSeconds(effect: SoundEffect): number {
  return buildTimeline(effectSong(effect)).notes.reduce((end, n) => Math.max(end, n.start + n.duration), 0)
}

// ---------------------------------------------------------------- export

export interface EffectWavOptions {
  /** One channel, as games mostly play sound effects. */
  mono: boolean
  /** Each one as loud as it can be: peaking at −1 dB. */
  normalize: boolean
}

/** Below this the sound has faded: about −66 dB. */
export const SILENCE = 0.0005
/** The very end fades out over this long, so the file ends without a click. */
export const END_FADE_SECONDS = 0.01
/** Normalized effects peak here: −1 dB. */
export const NORMALIZED_PEAK = 10 ** (-1 / 20)

/**
 * The rendered audio of an effect made into its WAV file's audio: ending where
 * its sound has faded (with a tiny fade), in mono or stereo, at its own level
 * or normalized. Null when it is silent all the way.
 */
export function finishEffectAudio(channels: Float32Array[], sampleRate: number, options: EffectWavOptions): Float32Array[] | null {
  let last = -1
  for (const channel of channels) {
    for (let i = channel.length - 1; i > last; i--) {
      if (Math.abs(channel[i]) >= SILENCE) {
        last = i
        break
      }
    }
  }
  if (last < 0) return null
  const fade = Math.round(END_FADE_SECONDS * sampleRate)
  const length = Math.min(channels[0].length, last + 1 + fade)
  let out = channels.map((channel) => channel.slice(0, length))
  if (options.mono && out.length > 1) {
    const mono = new Float32Array(length)
    for (const channel of out) for (let i = 0; i < length; i++) mono[i] += channel[i] / out.length
    out = [mono]
  }
  if (options.normalize) {
    const peak = out.reduce((max, channel) => channel.reduce((m, v) => Math.max(m, Math.abs(v)), max), 0)
    if (peak > 0) for (const channel of out) for (let i = 0; i < length; i++) channel[i] *= NORMALIZED_PEAK / peak
  }
  const fadeStart = Math.max(0, length - fade)
  for (const channel of out) for (let i = fadeStart; i < length; i++) channel[i] *= (length - 1 - i) / Math.max(1, length - 1 - fadeStart)
  return out
}

/**
 * The WAV file names of effects: their names made safe for files, numbered when
 * two would be the same (also only by upper and lower case, as on Windows and macOS).
 */
export function effectFileNames(effects: Pick<SoundEffect, 'name'>[]): string[] {
  return uniqueFileNames(effects.map((e) => e.name), 'Effect', '.wav')
}
