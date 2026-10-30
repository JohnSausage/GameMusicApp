// Held notes (ties), hammer-ons/pull-offs and slides (REQUIREMENTS.md EDIT-02, EDIT-12).
// They link a note to its neighbor on the same string in the beat right before or after it.
// Bends, palm mutes and dead notes are marks on a note of a guitar or bass.
import { edit, followTies, moveBeat, selectedRanges, setFret, type Cursor, type Duration, type EditResult, type Selection } from './edit'
import { isFretted, type Note, type Song } from './song'

export type Legato = 'hammer' | 'slide'

function noteAt(song: Song, c: Cursor): Note | undefined {
  return song.tracks[c.track].bars[c.bar].beats[c.beat].notes.find((n) => n.string === c.string)
}

/** The beat right before (-1) or after (1) the cursor's beat, across bar lines; null at the song's start or end. */
function neighbor(song: Song, c: Cursor, delta: 1 | -1): Cursor | null {
  const next = moveBeat(song, c, delta)
  return next.bar === c.bar && next.beat === c.beat ? null : next
}

/** The note on the cursor's string in the beat before it, which a tie would hold. */
export function tieOrigin(song: Song, c: Cursor): Note | undefined {
  const previous = neighbor(song, c, -1)
  return previous ? noteAt(song, previous) : undefined
}

/** The note on the cursor's string in the beat after it, which a hammer-on or slide would go to. */
export function legatoTarget(song: Song, c: Cursor): Note | undefined {
  const next = neighbor(song, c, 1)
  return next ? noteAt(song, next) : undefined
}

/**
 * Holds the note before the cursor (on its string) through the cursor's beat,
 * or stops holding it. Another fret at the cursor becomes the held note; on a
 * rest, the held note gets `duration` (like typing a fret), e.g. to hold a note
 * a quarter into the next bar.
 */
export function toggleTie(song: Song, cursor: Cursor, duration?: Duration): EditResult | null {
  if (song.tracks[cursor.track].kind === 'drums') return null
  if (noteAt(song, cursor)?.tie) {
    return edit(song, cursor, (draft, c) => {
      delete noteAt(draft, c)!.tie
    })
  }
  const origin = tieOrigin(song, cursor)
  if (!origin) return null
  const placed = duration && !noteAt(song, cursor) ? setFret(song, cursor, origin.fret, duration) : null
  return edit(placed?.song ?? song, cursor, (draft, c) => {
    const beat = draft.tracks[c.track].bars[c.bar].beats[c.beat]
    const note = noteAt(draft, c)
    if (note) {
      note.fret = origin.fret
      note.tie = true
    } else {
      beat.notes.push({ string: c.string, fret: origin.fret, velocity: origin.velocity, tie: true })
      beat.notes.sort((a, b) => a.string - b.string)
    }
    followTies(draft, c)
  })
}

/**
 * Turns a hammer-on/pull-off or a slide from the cursor's note into the next
 * note on its string on or off. That note must be in the very next beat, on another fret.
 */
export function toggleLegato(song: Song, cursor: Cursor, kind: Legato): EditResult | null {
  if (song.tracks[cursor.track].kind !== undefined) return null
  const note = noteAt(song, cursor)
  if (!note) return null
  if (note[kind]) {
    return edit(song, cursor, (draft, c) => {
      delete noteAt(draft, c)![kind]
    })
  }
  const target = legatoTarget(song, cursor)
  if (!target || target.fret === note.fret) return null
  return edit(song, cursor, (draft, c) => {
    const n = noteAt(draft, c)!
    n[kind] = true
    delete n[kind === 'hammer' ? 'slide' : 'hammer']
  })
}

/** Bend amounts (EDIT-12) in semitones: a half bend, a full bend, and one and a half. */
export const BEND_STEPS = [1, 2, 3]
/** The most a project file may bend a note (Guitar Pro files go up to two whole steps). */
export const MAX_BEND = 4

/** What a bend is called: "½", "full", "1½". */
export const bendName = (semitones: number): string => (semitones === 2 ? 'full' : `${Math.floor(semitones / 2) || ''}${semitones % 2 ? '½' : ''}`)

/** The next bend of the note at the cursor: half, full, one and a half, then none. */
export function cycleBend(song: Song, cursor: Cursor): EditResult | null {
  const note = isFretted(song.tracks[cursor.track]) ? noteAt(song, cursor) : undefined
  if (!note) return null
  const next = BEND_STEPS.find((step) => step > (note.bend ?? 0))
  return edit(song, cursor, (draft, c) => {
    const n = noteAt(draft, c)!
    if (next !== undefined) n.bend = next
    else {
      delete n.bend
      delete n.bendRelease
    }
  })
}

/** Lets the bend of the note at the cursor go back down before the note ends, or not. */
export function toggleBendRelease(song: Song, cursor: Cursor): EditResult | null {
  const note = noteAt(song, cursor)
  if (!note?.bend) return null
  return edit(song, cursor, (draft, c) => {
    const n = noteAt(draft, c)!
    if (n.bendRelease) delete n.bendRelease
    else n.bendRelease = true
  })
}

export type NoteMark = 'palmMute' | 'dead'

/**
 * Palm mute or dead note, on or off: for every note of the selected beats (as
 * palm mutes usually go over a run of notes), or the note at the cursor. Off
 * when all of them have it already.
 */
export function toggleMark(song: Song, cursor: Cursor, mark: NoteMark, selection?: Selection | null): EditResult | null {
  const track = selection ? selection.track : cursor.track
  if (!isFretted(song.tracks[track])) return null
  const notesIn = (s: Song): Note[] =>
    selection
      ? selectedRanges(s, selection).flatMap(({ bar, from, to }) => s.tracks[track].bars[bar].beats.slice(from, to + 1).flatMap((b) => b.notes))
      : [noteAt(s, cursor)].filter((n) => n !== undefined)
  const notes = notesIn(song)
  if (notes.length === 0) return null
  const on = !notes.every((n) => n[mark])
  return edit(song, cursor, (draft) => {
    for (const n of notesIn(draft)) {
      if (on) n[mark] = true
      else delete n[mark]
    }
  })
}
