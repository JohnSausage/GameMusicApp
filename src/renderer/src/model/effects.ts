// Sound effects of the game (jump, coin, laser, …), kept in the project next to
// the song, so they can be heard together and exported in one go. Each effect is
// a short piece of music of its own: one track with its own sound and notes, at
// its own tempo. It is edited as a song of its own (effectSong), as a part of the
// arrangement is, and saved as a WAV file that ends when its sound has faded.
import { emptyBar, type Cursor, type EditResult } from './edit'
import { createTrack, keyRow, newId, type Song, type SoundEffect } from './song'
import { factoryPreset } from './synth'
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

/** A new effect at the end of the list: one empty bar for an 8-bit sound, played in the piano roll. */
export function addEffect(song: Song, cursor: Cursor): { result: EditResult; id: string } {
  const name = freeName(song, 'Effect 1')
  const track = createTrack('keys', [emptyBar({ ...song, timeSignature: [4, 4] })], name)
  track.instrument = { kind: 'synth', patch: factoryPreset('8-bit square') }
  const effect: SoundEffect = { id: newId(), name, tempo: EFFECT_TEMPO, track }
  return { result: { song: { ...song, effects: [...(song.effects ?? []), effect] }, cursor }, id: effect.id }
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
  const taken = new Set<string>()
  return effects.map((effect) => {
    const base = effect.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().replace(/\.+$/, '') || 'Effect'
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`
    taken.add(name.toLowerCase())
    return `${name}.wav`
  })
}
