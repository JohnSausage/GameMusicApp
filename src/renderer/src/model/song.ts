// Minimal subset of the song model from REQUIREMENTS.md §5, enough for the M0 spike.

/** Note value: 1 = whole, 4 = quarter, 16 = sixteenth. */
export type NoteValue = 1 | 2 | 4 | 8 | 16 | 32

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
  bars: Bar[]
}

export interface Song {
  title: string
  tempo: number
  timeSignature: [number, number]
  tracks: Track[]
}

export const GUITAR_STANDARD = [64, 59, 55, 50, 45, 40]
export const BASS_STANDARD = [43, 38, 33, 28]

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

const n = (string: number, fret: number): Note => ({ string, fret, velocity: 96 })
const b = (value: NoteValue, ...notes: Note[]): Beat => ({ value, dotted: false, notes })

/** A short original demo tune: acoustic guitar melody plus a pulse-wave bass. */
export function createDemoSong(): Song {
  return {
    title: 'M0 Demo',
    tempo: 120,
    timeSignature: [4, 4],
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

/** Large song for render-speed tests (NFR-10: 200 bars × 6 tracks). */
export function createStressSong(barCount = 200, trackCount = 6): Song {
  const demo = createDemoSong()
  const tracks: Track[] = []
  for (let t = 0; t < trackCount; t++) {
    const source = demo.tracks[t % demo.tracks.length]
    const bars: Bar[] = []
    for (let i = 0; i < barCount; i++) bars.push(structuredClone(source.bars[i % source.bars.length]))
    tracks.push({ ...structuredClone(source), id: `${source.id}-${t}`, name: `${source.name} ${t + 1}`, bars })
  }
  return { ...demo, title: `Stress test (${barCount} bars × ${trackCount} tracks)`, tracks }
}
