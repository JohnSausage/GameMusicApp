// MIDI file import (REQUIREMENTS.md EXP-08): every MIDI track with notes becomes
// a keys track, or a drum track for the General MIDI drum channel. Notes are
// placed by beats (not seconds), snapped to thirty-seconds, from the first bar.
import { Midi } from '@tonejs/midi'
import { drumRowFor, stepsToBar } from './drums'
import { appendBars, barTicks, edit, type EditResult, type Cursor } from './edit'
import { rollToBars, withoutOverlaps, type RollNote } from './keys'
import { barCount, createTrack, keyRow, type Note, type Song, type Track } from './song'

/** Imported notes snap to thirty-seconds. */
const GRID = 120

export interface MidiImport {
  result: EditResult
  tracks: number
  notes: number
  /** Notes outside the piano's range or the drum kit, left out. */
  skipped: number
  /** The file's first tempo, if it has one. */
  fileTempo: number | null
}

/** Adds the tracks of a MIDI file to the song; null if the file has no notes. Throws if it isn't a MIDI file. */
export function importMidi(song: Song, cursor: Cursor, bytes: Uint8Array): MidiImport | null {
  const midi = new Midi(bytes)
  const toTicks = (ticks: number): number => Math.round((ticks * 960) / midi.header.ppq / GRID) * GRID
  const T = barTicks(song)
  let skipped = 0
  let noteCount = 0

  const parts = midi.tracks
    .filter((t) => t.notes.length > 0)
    .map((t) => {
      const drums = t.channel === 9 || t.instrument.percussion
      const notes: RollNote[] = []
      for (const n of t.notes) {
        const row = drums ? drumRowFor(n.midi) : n.midi >= 21 && n.midi <= 108 ? keyRow(n.midi) : null
        if (row === null) {
          skipped++
          continue
        }
        const start = toTicks(n.ticks)
        notes.push({ row, start, length: Math.max(GRID, toTicks(n.ticks + n.durationTicks) - start), velocity: Math.max(1, Math.round(n.velocity * 127)) })
      }
      noteCount += notes.length
      return { name: t.name.trim() || (drums ? 'Drums' : t.instrument.name || 'Keys'), drums, program: t.instrument.number, notes: withoutOverlaps(notes) }
    })
    .filter((p) => p.notes.length > 0)
  if (parts.length === 0) return null

  const bars = Math.max(barCount(song), Math.ceil(Math.max(...parts.flatMap((p) => p.notes.map((n) => n.start + (p.drums ? GRID : n.length)))) / T))
  const result = edit(song, cursor, (draft) => {
    appendBars(draft, bars - barCount(draft))
    for (const part of parts) {
      const track: Track = createTrack(part.drums ? 'drums' : 'keys', part.drums ? drumBars(part.notes, bars, T) : rollToBars(part.notes, bars, T), part.name)
      if (!part.drums) track.instrument = { kind: 'soundfont', program: part.program }
      draft.tracks.push(track)
    }
    return { track: song.tracks.length, bar: 0, beat: 0, string: draft.tracks[song.tracks.length].bars[0].beats[0].notes[0]?.string ?? 1 }
  })!
  return { result, tracks: parts.length, notes: noteCount, skipped, fileTempo: midi.header.tempos[0]?.bpm ?? null }
}

/** Drum hits as bars like the drum grid writes them: each hit lasts until the next one. */
function drumBars(notes: RollNote[], bars: number, T: number): ReturnType<typeof stepsToBar>[] {
  const stepsPerBar = T / GRID
  return Array.from({ length: bars }, (_, bar) => {
    const steps: Note[][] = Array.from({ length: stepsPerBar }, () => [])
    for (const n of notes) {
      const step = n.start / GRID - bar * stepsPerBar
      if (step >= 0 && step < stepsPerBar && !steps[step].some((m) => m.string === n.row)) steps[step].push({ string: n.row, fret: 0, velocity: n.velocity })
    }
    steps.forEach((s) => s.sort((a, b) => a.string - b.string))
    return stepsToBar(steps, GRID)
  })
}
