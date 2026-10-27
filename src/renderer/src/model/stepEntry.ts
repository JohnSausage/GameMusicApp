// MIDI keyboard step entry (REQUIREMENTS.md EDIT-08): a pressed key becomes a
// note at the cursor with the chosen length. Keys pressed together make a chord.
// On guitar and bass tracks the string and fret are chosen automatically.
import { drumRowFor } from './drums'
import { addBars, edit, moveBeat, setFret, type Cursor, type Duration, type EditResult } from './edit'
import { keyRow, MAX_FRET, type Song, type Track } from './song'

/** Fret the hand is assumed to be near when nothing was played before. */
const DEFAULT_FRET = 3

/** String and fret for `pitch`: on a string not used yet in the chord, near the last fret played and the cursor's string. */
export function fretFor(track: Track, pitch: number, usedStrings: Set<number>, nearFret: number, nearString: number): { string: number; fret: number } | null {
  let best: { string: number; fret: number; cost: number } | null = null
  for (const [i, open] of track.tuning.entries()) {
    const string = i + 1
    const fret = pitch - open
    if (fret < 0 || fret > MAX_FRET || usedStrings.has(string)) continue
    // Open strings are easy anywhere; otherwise stay near the hand position.
    const cost = (fret === 0 ? 0 : Math.abs(fret - nearFret)) + 0.3 * Math.abs(string - nearString)
    if (!best || cost < best.cost) best = { string, fret, cost }
  }
  return best && { string: best.string, fret: best.fret }
}

/** The fret of the closest note before the cursor on this track, for keeping the hand in place. */
function lastFret(song: Song, cursor: Cursor): number {
  let at = cursor
  for (let i = 0; i < 64; i++) {
    const previous = moveBeat(song, at, -1)
    if (previous.bar === at.bar && previous.beat === at.beat) break
    const notes = song.tracks[cursor.track].bars[previous.bar].beats[previous.beat].notes
    if (notes.length > 0) return notes[0].fret
    at = previous
  }
  return DEFAULT_FRET
}

/**
 * Enters a played key at the cursor: on a rest, with `duration`; on a beat with
 * notes (a chord being played), added to it. Null if the track can't play it.
 */
export function stepEnter(song: Song, cursor: Cursor, pitch: number, velocity: number, duration: Duration): EditResult | null {
  const track = song.tracks[cursor.track]
  let target: { string: number; fret: number } | null
  if (track.kind === 'keys') target = pitch >= 21 && pitch <= 108 ? { string: keyRow(pitch), fret: 0 } : null
  else if (track.kind === 'drums') {
    const row = drumRowFor(pitch)
    target = row === null ? null : { string: row, fret: 0 }
  } else {
    const used = new Set(track.bars[cursor.bar].beats[cursor.beat].notes.map((n) => n.string))
    target = fretFor(track, pitch, used, lastFret(song, cursor), cursor.string)
  }
  if (!target) return null
  const placed = setFret(song, { ...cursor, string: target.string }, target.fret, duration)
  if (!placed) return null
  return edit(placed.song, placed.cursor, (draft, c) => {
    const note = draft.tracks[c.track].bars[c.bar].beats[c.beat].notes.find((n) => n.string === c.string)
    if (note) note.velocity = velocity
  })
}

/** Moves the cursor to the next beat after a chord, adding a bar at the end of the song when needed. */
export function stepAdvance(song: Song, cursor: Cursor): EditResult {
  const next = moveBeat(song, cursor, 1)
  if (next.bar !== cursor.bar || next.beat !== cursor.beat) return { song, cursor: next }
  const extended = addBars(song, cursor, 1)
  return { song: extended.song, cursor: { ...cursor, bar: cursor.bar + 1, beat: 0 } }
}
