// Transposing (REQUIREMENTS.md EDIT-10): notes move up or down by semitones.
// Guitar and bass notes are fretted again, keys notes move to other keys, and
// drums stay as they are. Transposing the whole song moves its key signature too.
import { edit, selectedRanges, type Cursor, type EditResult, type Selection } from './edit'
import { songKey, transposeKey } from './keySignature'
import { keyRow, MAX_FRET, rowPitch, type Beat, type Note, type Song, type Track } from './song'
import { placeNotes, soundingTuning } from './tuning'
import { allBeats } from './voices'

/** What to transpose: the selected beats of a track, a whole track (with its parts), or every track. */
export type TransposeScope = { kind: 'selection'; selection: Selection } | { kind: 'track'; track: number } | { kind: 'song' }

/**
 * How guitar and bass notes are fretted: 'keep' their strings (the frets move;
 * a note its string can't reach goes to a free string close by), or choose the
 * 'best' strings and frets anew, near where the hand is.
 */
export type Fingering = 'keep' | 'best'

export interface TransposeResult {
  result: EditResult
  /** Notes transposed. */
  notes: number
  /** Guitar and bass notes that went to another string. */
  moved: number
  /** Notes out of the instrument's range, moved by an octave less. */
  folded: number
  /** Guitar and bass notes no free string reaches; they stayed as they were. */
  unplaced: number
}

/** Highest key on a keys track (C8) and lowest (A0). */
const KEYS_RANGE = { min: rowPitch(88), max: rowPitch(1) }

/** Fret the hand is assumed to be at when the music has no fretted notes yet. */
const DEFAULT_HAND = 3

type Counts = Omit<TransposeResult, 'result'>

/**
 * Transposes by `semitones`; null if that is 0 or there are no notes to
 * transpose. In an arranged song, a track's parts are transposed with it, also
 * the ones no section plays; the counts are then of the parts' notes.
 */
export function transpose(song: Song, cursor: Cursor, scope: TransposeScope, semitones: number, fingering: Fingering): TransposeResult | null {
  if (!Number.isInteger(semitones) || semitones === 0) return null
  const counts: Counts = { notes: 0, moved: 0, folded: 0, unplaced: 0 }
  const uncounted: Counts = { ...counts }
  const result = edit(song, cursor, (draft) => {
    const indexes = scope.kind === 'song' ? draft.tracks.map((_, i) => i) : [scope.kind === 'track' ? scope.track : scope.selection.track]
    for (const index of indexes) {
      const track = draft.tracks[index]
      if (!track || track.kind === 'drums') continue
      if (scope.kind === 'selection') {
        const beats = selectedRanges(draft, scope.selection).flatMap(({ bar, from, to }) => track.bars[bar].beats.slice(from, to + 1))
        transposeBeats(track, beats, semitones, fingering, counts)
        continue
      }
      // Parts hold the music of an arranged song: a part that repeats is in the bars more than once.
      const arranged = !!draft.arrangement
      // Both voices (EDIT-15).
      transposeBeats(track, track.bars.flatMap(allBeats), semitones, fingering, arranged ? uncounted : counts)
      for (const part of track.parts ?? []) transposeBeats(track, part.bars.flatMap(allBeats), semitones, fingering, arranged ? counts : uncounted)
    }
    if (scope.kind === 'song') draft.key = transposeKey(songKey(draft), semitones)
  })
  if (!result || counts.notes + uncounted.notes === 0) return null
  return { result, ...counts }
}

/** The pitch moved by `semitones`, by an octave less (or more) when it is out of `range`; null if no octave fits. */
function target(pitch: number, semitones: number, range: { min: number; max: number }): { pitch: number; folded: boolean } | null {
  let moved = pitch + semitones
  while (moved > range.max && moved - 12 >= range.min) moved -= 12
  while (moved < range.min && moved + 12 <= range.max) moved += 12
  if (moved < range.min || moved > range.max) return null
  return { pitch: moved, folded: moved !== pitch + semitones }
}

/** Transposes beats that follow each other, in order (ties link a beat to the one before it). */
function transposeBeats(track: Track, beats: Beat[], semitones: number, fingering: Fingering, counts: Counts): void {
  if (track.kind === 'keys') {
    for (const beat of beats) {
      const notes = new Map<number, Note>()
      for (const note of beat.notes) {
        const moved = target(rowPitch(note.string) + note.fret, semitones, KEYS_RANGE)
        counts.notes++
        if (moved?.folded) counts.folded++
        const row = moved ? keyRow(moved.pitch) : note.string
        // Two notes landing on the same key (one folded back an octave) are one note.
        if (!notes.has(row)) notes.set(row, { ...note, string: row, fret: 0 })
      }
      beat.notes = [...notes.values()].sort((a, b) => a.string - b.string)
    }
    return
  }

  const tuning = soundingTuning(track)
  const range = { min: Math.min(...tuning), max: Math.max(...tuning) + MAX_FRET }
  let hand = handPosition(beats.find((beat) => beat.notes.some((n) => n.fret > 0))?.notes) ?? DEFAULT_HAND
  let previous: { notes: Note[]; pitches: number[] } | null = null
  for (const beat of beats) {
    if (beat.notes.length === 0) {
      previous = null
      continue
    }
    const pitches = beat.notes.map((note) => {
      const moved = target(tuning[note.string - 1] + note.fret, semitones, range)
      counts.notes++
      if (moved?.folded) counts.folded++
      return moved?.pitch ?? tuning[note.string - 1] + note.fret
    })
    const strings = beat.notes.map((note) => note.string)
    const placed = fingering === 'keep' ? placeNotes(beat.notes, pitches, tuning) : fingerNotes(beat.notes, pitches, tuning, hand)
    counts.unplaced += placed.changed
    followTies(beat.notes, pitches, previous, tuning)
    counts.moved += beat.notes.filter((note, i) => note.string !== strings[i]).length
    beat.notes.sort((a, b) => a.string - b.string)
    hand = handPosition(beat.notes) ?? hand
    previous = { notes: beat.notes, pitches: beat.notes.map((note) => tuning[note.string - 1] + note.fret) }
  }
}

/** Where the hand is for these notes: the average of their frets, open strings left out. */
function handPosition(notes: Note[] | undefined): number | null {
  const frets = (notes ?? []).map((n) => n.fret).filter((fret) => fret > 0)
  return frets.length > 0 ? frets.reduce((sum, fret) => sum + fret, 0) / frets.length : null
}

/**
 * A held (tied) note stays on the string of the note it is held from, so it
 * keeps sounding: if that string is free in its beat, it moves there.
 */
function followTies(notes: Note[], pitches: number[], previous: { notes: Note[]; pitches: number[] } | null, tuning: number[]): void {
  if (!previous) return
  notes.forEach((note, i) => {
    if (!note.tie) return
    const from = previous.notes.find((_, j) => previous.pitches[j] === pitches[i])
    if (!from || from.string === note.string || notes.some((other) => other.string === from.string)) return
    note.string = from.string
    note.fret = pitches[i] - tuning[from.string - 1]
  })
}

/**
 * Frets the notes of a beat anew: each on a string of its own that reaches its
 * pitch, with the frets close to `hand` and a chord within a hand's span. A
 * note no free string reaches stays as it was (`changed`).
 */
function fingerNotes(notes: Note[], pitches: number[], tuning: number[], hand: number): { moved: number; changed: number } {
  const SPAN = 4
  let best: { strings: number[]; unplaced: number; cost: number } | null = null
  const chosen: number[] = []
  const used = new Set<number>()
  // Open strings are easy anywhere; fretted notes should stay near the hand, and a chord within its span.
  const search = (i: number, unplaced: number, cost: number): void => {
    if (best && (unplaced > best.unplaced || (unplaced === best.unplaced && cost >= best.cost))) return
    if (i === notes.length) {
      const fretted = chosen.flatMap((string, j) => (string > 0 && pitches[j] > tuning[string - 1] ? [pitches[j] - tuning[string - 1]] : []))
      const span = fretted.length > 0 ? Math.max(...fretted) - Math.min(...fretted) : 0
      const total = cost + 3 * Math.max(0, span - SPAN)
      if (!best || unplaced < best.unplaced || (unplaced === best.unplaced && total < best.cost)) best = { strings: [...chosen], unplaced, cost: total }
      return
    }
    const choose = (string: number, extraUnplaced: number, extraCost: number): void => {
      const s = Math.abs(string)
      used.add(s)
      chosen.push(string)
      search(i + 1, unplaced + extraUnplaced, cost + extraCost)
      chosen.pop()
      used.delete(s)
    }
    for (let string = 1; string <= tuning.length; string++) {
      const fret = pitches[i] - tuning[string - 1]
      if (!used.has(string) && fret >= 0 && fret <= MAX_FRET) choose(string, 0, fret === 0 ? 0.5 : Math.abs(fret - hand))
    }
    // Left as it was, when no free string reaches it.
    if (!used.has(notes[i].string)) choose(-notes[i].string, 1, 0)
  }
  search(0, 0, 0)
  let moved = 0
  let changed = 0
  notes.forEach((note, i) => {
    const string = best!.strings[i]
    if (string < 0) {
      changed++
      return
    }
    if (string !== note.string) moved++
    note.string = string
    note.fret = pitches[i] - tuning[string - 1]
  })
  return { moved, changed }
}

const INTERVALS = ['', 'a half step', 'a whole step', 'a minor third', 'a major third', 'a fourth', 'a tritone', 'a fifth', 'a minor sixth', 'a major sixth', 'a minor seventh', 'a major seventh']

/** E.g. "up 2 semitones (a whole step)" or "down 12 semitones (an octave)". */
export function describeShift(semitones: number): string {
  const size = Math.abs(semitones)
  const octaves = Math.floor(size / 12)
  const rest = INTERVALS[size % 12]
  const interval = octaves === 0 ? rest : `${octaves === 1 ? 'an octave' : `${octaves} octaves`}${rest ? ` and ${rest}` : ''}`
  return `${semitones > 0 ? 'up' : 'down'} ${size} semitone${size === 1 ? '' : 's'}${interval ? ` (${interval})` : ''}`
}

/** What a transposition did, for the status bar. */
export function transposeMessage(result: TransposeResult, semitones: number, fingering: Fingering): string {
  const notes = (n: number): string => `${n} note${n === 1 ? '' : 's'}`
  return [
    `Transposed ${notes(result.notes)} ${describeShift(semitones)}.`,
    fingering === 'keep' && result.moved > 0 && `${notes(result.moved)} went to another string.`,
    result.folded > 0 && `${notes(result.folded)} went an octave the other way, to stay in the instrument's range.`,
    result.unplaced > 0 && `${notes(result.unplaced)} stayed as before: no free string reaches ${result.unplaced === 1 ? 'it' : 'them'}.`
  ]
    .filter(Boolean)
    .join(' ')
}
