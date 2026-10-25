// Song model, a subset of REQUIREMENTS.md §5 that grows milestone by milestone.

/** Note value: 1 = whole, 4 = quarter, 16 = sixteenth. */
export type NoteValue = 1 | 2 | 4 | 8 | 16 | 32

export const NOTE_VALUES: NoteValue[] = [1, 2, 4, 8, 16, 32]

export interface Note {
  /** Fretted tracks: 1 = highest-pitched string (top line of the tab). */
  string: number
  fret: number
  velocity: number
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

export type Waveform = 'pulse' | 'triangle' | 'sawtooth' | 'sine'

export interface SynthPatch {
  waveform: Waveform
  /** Pulse width, 0–1 (0.125, 0.25 and 0.5 are the classic 8-bit values). */
  duty: number
  attack: number
  decay: number
  sustain: number
  release: number
}

export type Instrument =
  | { kind: 'soundfont'; program: number }
  | { kind: 'synth'; patch: SynthPatch }

export interface Track {
  id: string
  name: string
  /** MIDI note per string, string 1 (highest) first. */
  tuning: number[]
  instrument: Instrument
  volume: number
  pan: number
  /** Every track has the same number of bars as the song. */
  bars: Bar[]
}

/** A named part of the song that starts at a bar (PRJ-05), e.g. "Intro" or "Loop A". */
export interface Section {
  bar: number
  name: string
}

export interface Song {
  title: string
  tempo: number
  timeSignature: [number, number]
  tracks: Track[]
  sections: Section[]
}

export type TrackKind = 'guitar' | 'bass'

export const GUITAR_STANDARD = [64, 59, 55, 50, 45, 40]
export const BASS_STANDARD = [43, 38, 33, 28]
export const MAX_FRET = 24

export const GM_ACOUSTIC_GUITAR_STEEL = 25
export const GM_FINGER_BASS = 33

export const PULSE_LEAD: SynthPatch = { waveform: 'pulse', duty: 0.25, attack: 0.005, decay: 0.12, sustain: 0.6, release: 0.08 }
export const PULSE_BASS: SynthPatch = { waveform: 'pulse', duty: 0.5, attack: 0.005, decay: 0.08, sustain: 0.8, release: 0.05 }

export function notePitch(track: Track, note: Note): number {
  return track.tuning[note.string - 1] + note.fret
}

/** Length of a beat in quarter notes. */
export function beatQuarters(beat: Pick<Beat, 'value' | 'dotted'>): number {
  return (4 / beat.value) * (beat.dotted ? 1.5 : 1)
}

export function isBassTrack(track: Track): boolean {
  return track.tuning.length <= 5
}

export function newId(): string {
  return crypto.randomUUID()
}

/** Bars of a song, taken from the first track (all tracks have the same count). */
export function barCount(song: Song): number {
  return song.tracks[0]?.bars.length ?? 0
}

export function defaultInstrument(kind: TrackKind): Instrument {
  return { kind: 'soundfont', program: kind === 'bass' ? GM_FINGER_BASS : GM_ACOUSTIC_GUITAR_STEEL }
}

export function createTrack(kind: TrackKind, bars: Bar[], name?: string): Track {
  return {
    id: newId(),
    name: name ?? (kind === 'bass' ? 'Bass' : 'Guitar'),
    tuning: kind === 'bass' ? BASS_STANDARD : GUITAR_STANDARD,
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
        instrument: { kind: 'synth', patch: PULSE_BASS },
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
