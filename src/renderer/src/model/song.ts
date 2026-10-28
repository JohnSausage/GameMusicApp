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
  /**
   * Absent = fretted (guitar, bass). Drum tracks use one "string" per kit piece
   * (see DRUM_PIECES), keys tracks one per piano key (see KEYS_TUNING); their notes are all fret 0.
   */
  kind?: 'drums' | 'keys'
  /** MIDI note per string, string 1 (highest) first: the open strings without a capo (see model/tuning.ts). */
  tuning: number[]
  /** Guitar and bass: the fret of the capo (absent = none). Frets in the tab count from it. */
  capo?: number
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
  /** The pieces of music this track plays in the arrangement (see Song.arrangement). */
  parts?: Part[]
}

/** A named part of the song that starts at a bar (PRJ-05), e.g. "Intro" or "Loop A". */
export interface Section {
  bar: number
  name: string
  /** In an arranged song: the arrangement section it marks. */
  id?: string
}

/**
 * A piece of one track's music, e.g. "Theme A" or "Groove". Wherever the
 * arrangement places it, the same bars play, so changing it changes every repeat.
 */
export interface Part {
  id: string
  name: string
  bars: Bar[]
  /** Color in the arrangement, an index into its part colors (see model/arrangement.ts). Older parts have none. */
  color?: number
}

/** One section of the song form: how long it is, and which part each track plays in it. */
export interface ArrangementSection {
  id: string
  name: string
  /** Length in bars. A shorter part repeats to fill it; a longer one is cut off. */
  length: number
  /** Part id by track id; a track without one is silent in this section. */
  parts: Record<string, string>
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

/**
 * A sound effect of the game, e.g. "Jump" or "Coin": a short piece of music of
 * its own, kept next to the song (see model/effects.ts).
 */
export interface SoundEffect {
  id: string
  name: string
  /** Its own tempo, in quarter notes per minute; it is in 4/4. */
  tempo: number
  /** Its notes and its sound. */
  track: Track
  /** Color in the list, to tell kinds of effects apart: an index into the part colors (see PART_COLORS). None = no color. */
  color?: number
}

export interface Song {
  title: string
  tempo: number
  timeSignature: [number, number]
  tracks: Track[]
  sections: Section[]
  /**
   * The song form: sections in order, each with a part per track (see model/arrangement.ts).
   * When present, it is the source of every track's bars and of `sections`.
   */
  arrangement?: ArrangementSection[]
  takes: TakeInfo[]
  master?: MasterSettings
  /** The game's sound effects, exported one file each. Not part of the song's music. */
  effects?: SoundEffect[]
}

/** Audio of the project's takes: mono samples by take id. */
export type ProjectAudio = ReadonlyMap<string, Float32Array>

export function takeSeconds(take: TakeInfo, audio: ProjectAudio): number {
  return (audio.get(take.id)?.length ?? 0) / take.sampleRate
}

export type TrackKind = 'guitar' | 'bass' | 'drums' | 'keys'

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

/** Keys tracks (TRK-02 melodic, INST-02): one row per piano key, C8 (108) at the top down to A0 (21). */
export const KEYS_TUNING = Array.from({ length: 88 }, (_, i) => 108 - i)

/** Row ("string") of a pitch on a keys track, and back. */
export const keyRow = (pitch: number): number => 109 - pitch
export const rowPitch = (row: number): number => 109 - row

/**
 * The 128 General MIDI sounds in their families of eight (program = family
 * index × 8 + position). Any of them can play a guitar, bass or keys track.
 */
export const GM_FAMILIES: { name: string; sounds: string[] }[] = [
  { name: 'Piano', sounds: ['Grand piano', 'Bright piano', 'Electric grand', 'Honky-tonk piano', 'Electric piano 1', 'Electric piano 2', 'Harpsichord', 'Clavinet'] },
  { name: 'Chromatic percussion', sounds: ['Celesta', 'Glockenspiel', 'Music box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular bells', 'Dulcimer'] },
  { name: 'Organ', sounds: ['Drawbar organ', 'Percussive organ', 'Rock organ', 'Church organ', 'Reed organ', 'Accordion', 'Harmonica', 'Tango accordion'] },
  {
    name: 'Guitar',
    sounds: ['Nylon guitar', 'Steel-string guitar', 'Jazz guitar', 'Clean electric guitar', 'Muted electric guitar', 'Overdriven guitar', 'Distortion guitar', 'Guitar harmonics']
  },
  { name: 'Bass', sounds: ['Acoustic bass', 'Finger bass', 'Pick bass', 'Fretless bass', 'Slap bass 1', 'Slap bass 2', 'Synth bass 1', 'Synth bass 2'] },
  { name: 'Strings', sounds: ['Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo strings', 'Pizzicato strings', 'Harp', 'Timpani'] },
  { name: 'Ensemble', sounds: ['String ensemble 1', 'String ensemble 2', 'Synth strings 1', 'Synth strings 2', 'Choir aahs', 'Voice oohs', 'Synth choir', 'Orchestra hit'] },
  { name: 'Brass', sounds: ['Trumpet', 'Trombone', 'Tuba', 'Muted trumpet', 'French horn', 'Brass section', 'Synth brass 1', 'Synth brass 2'] },
  { name: 'Reed', sounds: ['Soprano sax', 'Alto sax', 'Tenor sax', 'Baritone sax', 'Oboe', 'English horn', 'Bassoon', 'Clarinet'] },
  { name: 'Pipe', sounds: ['Piccolo', 'Flute', 'Recorder', 'Pan flute', 'Blown bottle', 'Shakuhachi', 'Whistle', 'Ocarina'] },
  { name: 'Synth lead', sounds: ['Square lead', 'Saw lead', 'Calliope lead', 'Chiff lead', 'Charang lead', 'Voice lead', 'Fifths lead', 'Bass + lead'] },
  { name: 'Synth pad', sounds: ['New age pad', 'Warm pad', 'Polysynth pad', 'Choir pad', 'Bowed pad', 'Metallic pad', 'Halo pad', 'Sweep pad'] },
  { name: 'Synth effects', sounds: ['Rain', 'Soundtrack', 'Crystal', 'Atmosphere', 'Brightness', 'Goblins', 'Echoes', 'Sci-fi'] },
  { name: 'Ethnic', sounds: ['Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai'] },
  { name: 'Percussive', sounds: ['Tinkle bell', 'Agogo', 'Steel drums', 'Woodblock', 'Taiko drum', 'Melodic tom', 'Synth drum', 'Reverse cymbal'] },
  { name: 'Sound effects', sounds: ['Guitar fret noise', 'Breath noise', 'Seashore', 'Bird tweet', 'Telephone ring', 'Helicopter', 'Applause', 'Gunshot'] }
]

/** Name of a General MIDI sound, e.g. 0 → "Grand piano". */
export function gmSoundName(program: number): string {
  return GM_FAMILIES[Math.floor(program / 8)]?.sounds[program % 8] ?? `General MIDI sound ${program + 1}`
}

/** Name of a track's sound on a guitar, bass or keys track, e.g. "Grand piano" or "8-bit: Pulse bass". */
export function soundName(instrument: Instrument): string {
  if (instrument.kind === 'soundfont') return gmSoundName(instrument.program)
  if (instrument.kind === 'synth') return `8-bit: ${instrument.patch.name}`
  return '8-bit drum kit'
}

export const GUITAR_STANDARD = [64, 59, 55, 50, 45, 40]
export const BASS_STANDARD = [43, 38, 33, 28]
export const MAX_FRET = 24

export const GM_ACOUSTIC_GUITAR_STEEL = 25
export const GM_FINGER_BASS = 33

/** The pitch of a fret on a string of the track, with its capo. */
export function stringPitch(track: Pick<Track, 'tuning' | 'capo'>, string: number, fret: number): number {
  return track.tuning[string - 1] + (track.capo ?? 0) + fret
}

export function notePitch(track: Track, note: Note): number {
  return stringPitch(track, note.string, note.fret)
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

/** Guitar and bass: notes have strings and frets (tab, techniques, transcription). */
export function isFretted(track: Track): boolean {
  return track.kind === undefined
}

export function isBassTrack(track: Track): boolean {
  return isFretted(track) && track.tuning.length <= 5
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
  return { kind: 'soundfont', program: kind === 'bass' ? GM_FINGER_BASS : kind === 'drums' || kind === 'keys' ? 0 : GM_ACOUSTIC_GUITAR_STEEL }
}

export function trackKind(track: Track): TrackKind {
  return track.kind ?? (isBassTrack(track) ? 'bass' : 'guitar')
}

export function createTrack(kind: TrackKind, bars: Bar[], name?: string): Track {
  return {
    id: newId(),
    name: name ?? { guitar: 'Guitar', bass: 'Bass', drums: 'Drums', keys: 'Keys' }[kind],
    ...(kind === 'drums' || kind === 'keys' ? { kind } : {}),
    tuning: { guitar: GUITAR_STANDARD, bass: BASS_STANDARD, drums: DRUM_TUNING, keys: KEYS_TUNING }[kind],
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
