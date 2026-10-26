// Song model, a subset of REQUIREMENTS.md §5 that grows milestone by milestone.
import { factoryPreset, type DrumSound, type SynthPatch } from './synth'

export type { DrumSound, SynthPatch }

/** Note value: 1 = whole, 4 = quarter, 16 = sixteenth. */
export type NoteValue = 1 | 2 | 4 | 8 | 16 | 32

export const NOTE_VALUES: NoteValue[] = [1, 2, 4, 8, 16, 32]

export interface Note {
  /** Fretted tracks: 1 = highest-pitched string (top line of the tab). */
  string: number
  fret: number
  velocity: number
  /** Held: tied to the note before it on this string, so it keeps sounding instead of being played again (EDIT-02). */
  tie?: boolean
  /** Hammer-on (to a higher fret) or pull-off (to a lower one) into the next note on this string (EDIT-12). */
  hammer?: boolean
  /** Slide into the next note on this string (EDIT-12). */
  slide?: boolean
}

export interface Beat {
  value: NoteValue
  dotted: boolean
  /** Empty = rest. */
  notes: Note[]
}

export interface Bar {
  beats: Beat[]
}

export type Instrument =
  | { kind: 'soundfont'; program: number }
  | { kind: 'synth'; patch: SynthPatch }
  /** A synth sound per drum piece (SYN-20). */
  | { kind: 'synthkit'; pieces: DrumSound[] }

export interface Track {
  id: string
  name: string
  /** Drum tracks use one "string" per kit piece (see DRUM_PIECES); absent = fretted. */
  kind?: 'drums'
  /** MIDI note per string, string 1 (highest) first. */
  tuning: number[]
  instrument: Instrument
  /** Mute and solo (PLAY-05); they apply to playback and WAV export. */
  mute?: boolean
  solo?: boolean
  volume: number
  pan: number
  /** Every track has the same number of bars as the song. */
  bars: Bar[]
  /** The sound before "Make it retro" replaced it, so it can be switched back (SYN-31). */
  originalInstrument?: Instrument
}

/** A named part of the song that starts at a bar (PRJ-05), e.g. "Intro" or "Loop A". */
export interface Section {
  bar: number
  name: string
}

/**
 * A recorded or imported take kept in the project (REC-08). Only the metadata
 * lives in the song; the audio is held separately (see ProjectAudio) so undo
 * snapshots don't copy it.
 */
export interface TakeInfo {
  id: string
  name: string
  sampleRate: number
  /** Tempo the take was played at, in quarter notes per minute. */
  tempo: number
  /** Seconds into the take where bar 1, beat 1 is. */
  firstDownbeat: number
  createdAt: string
}

/** Effects on the whole mix. */
export interface MasterSettings {
  /** Master bitcrusher (SYN-30): bit depth (16 = off) and sample rate in Hz (0 = off). */
  crushBits: number
  crushRate: number
}

export const MASTER_DEFAULTS: MasterSettings = { crushBits: 16, crushRate: 0 }

export interface Song {
  title: string
  tempo: number
  timeSignature: [number, number]
  tracks: Track[]
  sections: Section[]
  takes: TakeInfo[]
  master?: MasterSettings
}

/** Audio of the project's takes: mono samples by take id. */
export type ProjectAudio = ReadonlyMap<string, Float32Array>

export function takeSeconds(take: TakeInfo, audio: ProjectAudio): number {
  return (audio.get(take.id)?.length ?? 0) / take.sampleRate
}

export type TrackKind = 'guitar' | 'bass' | 'drums'

export interface DrumPiece {
  /** General MIDI drum note. */
  note: number
  name: string
}

/** Kit pieces of drum tracks, top to bottom as in drum notation. Row n is "string" n, every hit is fret 0. */
export const DRUM_PIECES: DrumPiece[] = [
  { note: 49, name: 'Crash' },
  { note: 51, name: 'Ride' },
  { note: 46, name: 'Open hi-hat' },
  { note: 42, name: 'Closed hi-hat' },
  { note: 50, name: 'High tom' },
  { note: 47, name: 'Mid tom' },
  { note: 38, name: 'Snare' },
  { note: 45, name: 'Low tom' },
  { note: 36, name: 'Kick' }
]

export const DRUM_TUNING = DRUM_PIECES.map((p) => p.note)

export const GUITAR_STANDARD = [64, 59, 55, 50, 45, 40]
export const BASS_STANDARD = [43, 38, 33, 28]
export const MAX_FRET = 24

export const GM_ACOUSTIC_GUITAR_STEEL = 25
export const GM_FINGER_BASS = 33

export function notePitch(track: Track, note: Note): number {
  return track.tuning[note.string - 1] + note.fret
}

/** Length of a beat in quarter notes. */
export function beatQuarters(beat: Pick<Beat, 'value' | 'dotted'>): number {
  return (4 / beat.value) * (beat.dotted ? 1.5 : 1)
}

/** Which tracks are heard: not muted, and soloed if any track is soloed. */
export function audibleTracks(song: Song): boolean[] {
  const anySolo = song.tracks.some((t) => t.solo)
  return song.tracks.map((t) => !t.mute && (!anySolo || !!t.solo))
}

export function isBassTrack(track: Track): boolean {
  return track.kind !== 'drums' && track.tuning.length <= 5
}

export function newId(): string {
  return crypto.randomUUID()
}

/** Bars of a song, taken from the first track (all tracks have the same count). */
export function barCount(song: Song): number {
  return song.tracks[0]?.bars.length ?? 0
}

export function defaultInstrument(kind: TrackKind): Instrument {
  // Program 0 on the General MIDI drum channel is the standard kit.
  return { kind: 'soundfont', program: kind === 'bass' ? GM_FINGER_BASS : kind === 'drums' ? 0 : GM_ACOUSTIC_GUITAR_STEEL }
}

export function trackKind(track: Track): TrackKind {
  return track.kind === 'drums' ? 'drums' : isBassTrack(track) ? 'bass' : 'guitar'
}

export function createTrack(kind: TrackKind, bars: Bar[], name?: string): Track {
  return {
    id: newId(),
    name: name ?? { guitar: 'Guitar', bass: 'Bass', drums: 'Drums' }[kind],
    ...(kind === 'drums' ? { kind: 'drums' as const } : {}),
    tuning: kind === 'bass' ? BASS_STANDARD : kind === 'drums' ? DRUM_TUNING : GUITAR_STANDARD,
    instrument: defaultInstrument(kind),
    volume: kind === 'bass' ? 0.75 : 0.9,
    pan: 0,
    bars
  }
}

const n = (string: number, fret: number): Note => ({ string, fret, velocity: 96 })
const b = (value: NoteValue, ...notes: Note[]): Beat => ({ value, dotted: false, notes })

/** A short original demo tune: acoustic guitar melody plus a pulse-wave bass. */
export function createDemoSong(): Song {
  return {
    title: 'Demo song',
    tempo: 120,
    timeSignature: [4, 4],
    sections: [],
    takes: [],
    tracks: [
      {
        id: 'guitar',
        name: 'Acoustic guitar',
        tuning: GUITAR_STANDARD,
        instrument: { kind: 'soundfont', program: GM_ACOUSTIC_GUITAR_STEEL },
        volume: 0.9,
        pan: 0,
        bars: [
          { beats: [b(8, n(3, 2)), b(8, n(2, 0)), b(8, n(2, 3)), b(8, n(1, 0)), b(4, n(1, 3)), b(4, n(1, 2))] },
          { beats: [b(4, n(1, 0)), b(8, n(2, 3)), b(8, n(2, 0)), b(2, n(3, 2))] },
          { beats: [b(8, n(3, 0)), b(8, n(3, 2)), b(8, n(2, 0)), b(8, n(2, 3)), b(4, n(1, 0)), b(8, n(2, 3)), b(8, n(2, 0))] },
          { beats: [b(4, n(2, 0)), b(4, n(3, 2)), b(2, n(6, 0), n(5, 2), n(4, 2), n(3, 0))] }
        ]
      },
      {
        id: 'bass',
        name: 'Bass',
        tuning: BASS_STANDARD,
        instrument: { kind: 'synth', patch: factoryPreset('Pulse bass') },
        volume: 0.7,
        pan: 0,
        bars: [
          { beats: [b(4, n(4, 0)), b(4, n(4, 0)), b(4, n(2, 2)), b(4, n(4, 0))] },
          { beats: [b(4, n(3, 3)), b(4, n(3, 3)), b(4, n(1, 5)), b(4, n(3, 3))] },
          { beats: [b(4, n(4, 3)), b(4, n(4, 3)), b(4, n(2, 5)), b(4, n(4, 3))] },
          { beats: [b(4, n(3, 5)), b(4, n(3, 5)), b(2, n(4, 0))] }
        ]
      }
    ]
  }
}
