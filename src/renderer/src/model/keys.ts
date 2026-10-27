// Keys tracks as a piano roll (REQUIREMENTS.md INST-02): notes with a start and a
// length, converted to and from the beat model. A note longer than a beat is
// written as a note plus held (tied) notes, so chords, sustained notes under a
// melody and notes across bar lines all fit the one-voice-per-track model.
import { barTicks, beatTicks, edit, restsFor, type Cursor, type EditResult } from './edit'
import { barCount, keyRow, type Bar, type Note, type Song } from './song'

export interface RollNote {
  /** The row ("string") of the note: a piano key on keys tracks, a kit piece on drum tracks. */
  row: number
  /** Ticks from the start of the range. */
  start: number
  length: number
  velocity: number
  /** Held on from before the range (a tie into its first beat). */
  continued?: boolean
}

/**
 * The notes of a track in bars `from` up to (not including) `to`, with held
 * notes joined, in ticks from the start of bar `from`.
 */
export function rollNotes(song: Song, track: number, from: number, to: number): RollNote[] {
  const notes: RollNote[] = []
  const sounding = new Map<number, RollNote>()
  let time = 0
  for (let bar = from; bar < to; bar++) {
    for (const beat of song.tracks[track].bars[bar].beats) {
      const length = beatTicks(beat)
      for (const n of beat.notes) {
        const before = sounding.get(n.string)
        if (n.tie && before && before.start + before.length === time) before.length += length
        else {
          const note: RollNote = { row: n.string, start: time, length, velocity: n.velocity, ...(n.tie && time === 0 && { continued: true }) }
          notes.push(note)
          sounding.set(n.string, note)
        }
      }
      time += length
    }
  }
  return notes
}

/**
 * Bars that play `notes` (ticks from the start of the first bar). Beats start
 * wherever a note starts or ends or a bar begins; a note sounding through
 * several beats is held (tied) into them.
 */
export function rollToBars(notes: RollNote[], barCount: number, ticksPerBar: number): Bar[] {
  const total = barCount * ticksPerBar
  const cuts = new Set<number>([0, total])
  for (let b = 1; b < barCount; b++) cuts.add(b * ticksPerBar)
  for (const n of notes) {
    if (n.start > 0 && n.start < total) cuts.add(n.start)
    if (n.start + n.length < total) cuts.add(n.start + n.length)
  }
  const points = [...cuts].sort((a, b) => a - b)
  const bars: Bar[] = Array.from({ length: barCount }, () => ({ beats: [] }))
  for (let i = 0; i + 1 < points.length; i++) {
    const segmentStart = points[i]
    const playing = notes.filter((n) => n.start < points[i + 1] && n.start + n.length > segmentStart)
    let at = segmentStart
    for (const beat of restsFor(points[i + 1] - segmentStart)) {
      beat.notes = playing
        .map((n): Note => ({ string: n.row, fret: 0, velocity: n.velocity, ...((at > n.start || n.continued) && { tie: true }) }))
        .sort((a, b) => a.string - b.string)
      bars[Math.floor(at / ticksPerBar)].beats.push(beat)
      at += beatTicks(beat)
    }
  }
  return bars
}

/** Replaces bars `from`…`to - 1` of a track with `notes`, adding bars to the song when `to` is past its end. */
export function writeRoll(song: Song, cursor: Cursor, track: number, from: number, to: number, notes: RollNote[]): EditResult | null {
  if (to <= from) return null
  return edit(song, cursor, (draft) => {
    const T = barTicks(draft)
    const extra = to - barCount(draft)
    for (const t of draft.tracks) for (let i = 0; i < extra; i++) t.bars.push({ beats: restsFor(T) })
    const bars = rollToBars(notes, to - from, T)
    bars.forEach((bar, i) => (draft.tracks[track].bars[from + i] = bar))
  })
}

/**
 * Adds a note to bars `from`…`to - 1`, shortening or removing notes of the same
 * key that it would overlap. The note is cut at the end of the range.
 */
export function addRollNote(song: Song, cursor: Cursor, track: number, from: number, to: number, note: RollNote): EditResult | null {
  const end = Math.min(note.start + note.length, (to - from) * barTicks(song))
  if (end <= note.start) return null
  const notes = rollNotes(song, track, from, to).flatMap((n): RollNote[] => {
    if (n.row !== note.row || n.start + n.length <= note.start || n.start >= end) return [n]
    return n.start < note.start ? [{ ...n, length: note.start - n.start }] : []
  })
  notes.push({ ...note, length: end - note.start })
  const result = writeRoll(song, cursor, track, from, to, notes)
  if (!result) return null
  return { ...result, cursor: cursorAt(result.song, track, from, note.row, note.start) }
}

/** Removes the note of `row` that sounds at `tick` (ticks from the start of bar `from`). */
export function removeRollNote(song: Song, cursor: Cursor, track: number, from: number, to: number, row: number, tick: number): EditResult | null {
  const notes = rollNotes(song, track, from, to)
  const index = notes.findIndex((n) => n.row === row && n.start <= tick && n.start + n.length > tick)
  if (index < 0) return null
  notes.splice(index, 1)
  return writeRoll(song, cursor, track, from, to, notes)
}

/** The cursor on the beat that starts at `tick` (from the start of bar `from`), on `row`. */
export function cursorAt(song: Song, track: number, from: number, row: number, tick: number): Cursor {
  const T = barTicks(song)
  const bar = from + Math.floor(tick / T)
  let start = (bar - from) * T
  const beats = song.tracks[track].bars[bar]?.beats ?? []
  let beat = 0
  while (beat + 1 < beats.length && start + beatTicks(beats[beat]) <= tick) start += beatTicks(beats[beat++])
  return { track, bar: Math.min(bar, barCount(song) - 1), beat, string: row }
}

/** A note played somewhere (e.g. recorded from a MIDI keyboard), in seconds. */
export interface TimedNote {
  pitch: number
  start: number
  end: number
  velocity: number
}

/**
 * Snaps played notes to a grid of `gridTicks` (e.g. 240 = sixteenths) at
 * `secondsPerTick`: starts to the nearest grid line, lengths to at least one
 * step. Notes of the same key never overlap. Pitches outside the piano are left out.
 */
export function quantizeNotes(notes: TimedNote[], secondsPerTick: number, gridTicks: number): RollNote[] {
  const snap = (seconds: number): number => Math.round(seconds / secondsPerTick / gridTicks) * gridTicks
  const result = notes
    .filter((n) => n.pitch >= 21 && n.pitch <= 108)
    .map((n) => {
      const start = Math.max(0, snap(n.start))
      return { row: keyRow(n.pitch), start, length: Math.max(gridTicks, snap(n.end) - start), velocity: Math.max(1, Math.min(127, Math.round(n.velocity))) }
    })
  return withoutOverlaps(result)
}

/** Notes of the same key never overlap: the earlier one ends where the next starts (a second note at the same time is dropped). */
export function withoutOverlaps(notes: RollNote[]): RollNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.row - b.row)
  const last = new Map<number, RollNote>()
  return sorted.filter((n) => {
    const before = last.get(n.row)
    if (before && before.start === n.start) return false
    if (before && before.start + before.length > n.start) before.length = n.start - before.start
    last.set(n.row, n)
    return true
  })
}
