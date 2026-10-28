// Tunings and the capo of guitar and bass tracks. A track's tuning is the open
// strings without a capo; with a capo on fret N every string sounds N semitones
// higher, and the tab counts frets from the capo (fret 0 = the capo), as players read it.
import { noteName } from '../transcription/notes'
import { edit, type Cursor, type EditResult } from './edit'
import { BASS_STANDARD, GUITAR_STANDARD, isFretted, MAX_FRET, type Bar, type Note, type Song, type Track } from './song'

/** The highest capo fret offered. */
export const MAX_CAPO = 12

export interface TuningPreset {
  name: string
  /** MIDI note per string, string 1 (highest) first, as Track.tuning. */
  tuning: number[]
}

/** Common tunings by number of strings; the first one is standard. */
export const TUNING_PRESETS: Record<number, TuningPreset[]> = {
  6: [
    { name: 'Standard', tuning: GUITAR_STANDARD },
    { name: 'Drop D', tuning: [64, 59, 55, 50, 45, 38] },
    { name: 'Half step down', tuning: [63, 58, 54, 49, 44, 39] },
    { name: 'Whole step down', tuning: [62, 57, 53, 48, 43, 38] },
    { name: 'Drop C', tuning: [62, 57, 53, 48, 43, 36] },
    { name: 'DADGAD', tuning: [62, 57, 55, 50, 45, 38] },
    { name: 'Open D', tuning: [62, 57, 54, 50, 45, 38] },
    { name: 'Open G', tuning: [62, 59, 55, 50, 43, 38] },
    { name: 'Open E', tuning: [64, 59, 56, 52, 47, 40] },
    { name: 'Open C', tuning: [64, 60, 55, 48, 43, 36] }
  ],
  4: [
    { name: 'Standard', tuning: BASS_STANDARD },
    { name: 'Drop D', tuning: [43, 38, 33, 26] },
    { name: 'Half step down', tuning: [42, 37, 32, 27] },
    { name: 'Whole step down', tuning: [41, 36, 31, 26] },
    { name: 'Drop C', tuning: [41, 36, 31, 24] }
  ]
}

/** Lowest and highest note a string can be tuned to: A0 to E5. */
export const STRING_RANGE = { min: 21, max: 76 }

const sameTuning = (a: number[], b: number[]): boolean => a.length === b.length && a.every((p, i) => p === b[i])

/** The preset a tuning is, if any. */
export function tuningPreset(tuning: number[]): TuningPreset | null {
  return TUNING_PRESETS[tuning.length]?.find((preset) => sameTuning(preset.tuning, tuning)) ?? null
}

/** Standard tuning for the track's number of strings (also true for string counts without presets). */
export function isStandardTuning(tuning: number[]): boolean {
  const presets = TUNING_PRESETS[tuning.length]
  return !presets || sameTuning(presets[0].tuning, tuning)
}

/** The open strings from the lowest, as players say them, e.g. "D A D G B E". */
export function stringLetters(tuning: number[]): string {
  return [...tuning]
    .reverse()
    .map((pitch) => noteName(pitch).replace(/-?\d+$/, ''))
    .join(' ')
}

/** E.g. "Standard", "Drop D · capo 2" or "D G D G A D". */
export function tuningLabel(track: Pick<Track, 'tuning' | 'capo'>): string {
  const name = tuningPreset(track.tuning)?.name ?? stringLetters(track.tuning)
  return track.capo ? `${name} · capo ${track.capo}` : name
}

/** How the open strings sound: the tuning with the capo. */
export function soundingTuning(track: Pick<Track, 'tuning' | 'capo'>): number[] {
  return track.tuning.map((pitch) => pitch + (track.capo ?? 0))
}

/** What to do with the notes already written when the tuning or the capo changes. */
export type Retune = 'sound' | 'frets'

export interface RetuneResult {
  result: EditResult
  /** Notes that moved to another string to keep their sound. */
  moved: number
  /** Notes that could not keep their sound (no string reaches them); they kept their fret. */
  changed: number
}

/**
 * Gives a guitar or bass track a new tuning and capo. With 'sound', notes are
 * fretted again so the music sounds as before: on the same string if it reaches
 * the note, otherwise on a free string of the beat. With 'frets', the tab stays
 * as it is and the music follows the new tuning.
 */
export function retuneTrack(song: Song, cursor: Cursor, index: number, tuning: number[], capo: number, keep: Retune): RetuneResult | null {
  const track = song.tracks[index]
  if (!track || !isFretted(track) || tuning.length !== track.tuning.length) return null
  const before = soundingTuning(track)
  const after = soundingTuning({ tuning, capo })
  const counts = { bars: { moved: 0, changed: 0 }, parts: { moved: 0, changed: 0 } }
  const refretBars = (bars: Bar[], count: { moved: number; changed: number }): void => {
    for (const bar of bars) {
      for (const beat of bar.beats) {
        const beatCount = refretBeat(beat.notes, before, after)
        count.moved += beatCount.moved
        count.changed += beatCount.changed
      }
    }
  }
  const result = edit(song, cursor, (draft) => {
    const target = draft.tracks[index]
    target.tuning = [...tuning]
    if (capo > 0) target.capo = capo
    else delete target.capo
    if (keep === 'frets') return
    refretBars(target.bars, counts.bars)
    // Parts hold the music of an arranged song (its bars are written out from them).
    for (const part of target.parts ?? []) refretBars(part.bars, counts.parts)
  })
  if (!result) return null
  // In an arranged song, a part that repeats is in the bars more than once: count the parts.
  return { result, ...(song.arrangement ? counts.parts : counts.bars) }
}

/** Frets the notes of a beat for the open strings `after`, sounding as with `before`. */
function refretBeat(notes: Note[], before: number[], after: number[]): { moved: number; changed: number } {
  const reaches = (string: number, pitch: number): boolean => {
    const fret = pitch - after[string - 1]
    return fret >= 0 && fret <= MAX_FRET
  }
  const taken = new Set<number>()
  const homeless: { note: Note; pitch: number }[] = []
  for (const note of notes) {
    const pitch = before[note.string - 1] + note.fret
    if (reaches(note.string, pitch)) {
      note.fret = pitch - after[note.string - 1]
      taken.add(note.string)
    } else homeless.push({ note, pitch })
  }
  // The other notes get strings that reach them: as many as can, as close to their own string as can be.
  // A note left without one stays on its string, as it was. A beat has a few notes, so every choice is tried.
  let best: { strings: number[]; unplaced: number; distance: number } | null = null
  const strings: number[] = []
  const search = (i: number, unplaced: number, distance: number): void => {
    if (best && (unplaced > best.unplaced || (unplaced === best.unplaced && distance >= best.distance))) return
    if (i === homeless.length) {
      best = { strings: [...strings], unplaced, distance }
      return
    }
    const { note, pitch } = homeless[i]
    const choices = after.map((_, s) => s + 1).filter((s) => reaches(s, pitch))
    // Its own string last: that is "left as it was".
    for (const string of [...choices, -note.string]) {
      const s = Math.abs(string)
      if (taken.has(s)) continue
      taken.add(s)
      strings.push(string)
      search(i + 1, unplaced + (string < 0 ? 1 : 0), distance + Math.abs(s - note.string))
      strings.pop()
      taken.delete(s)
    }
  }
  search(0, 0, 0)
  let moved = 0
  let changed = 0
  homeless.forEach(({ note, pitch }, i) => {
    const string = best!.strings[i]
    if (string < 0) {
      changed++
      return
    }
    note.string = string
    note.fret = pitch - after[string - 1]
    moved++
  })
  notes.sort((a, b) => a.string - b.string)
  return { moved, changed }
}
