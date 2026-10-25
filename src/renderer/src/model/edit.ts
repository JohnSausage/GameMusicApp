// Editing operations on the song. All of them are pure: they return a new song
// (and where the cursor should be), or null when the edit isn't possible.
// Bars are always kept exactly full, padding with rests where needed.
import { barCount, createTrack, MAX_FRET, NOTE_VALUES, type Bar, type Beat, type NoteValue, type Song, type Track, type TrackKind } from './song'

export const TICKS_PER_QUARTER = 960

export interface Cursor {
  track: number
  bar: number
  beat: number
  /** 1 = highest string. */
  string: number
}

export interface Duration {
  value: NoteValue
  dotted: boolean
}

export interface EditResult {
  song: Song
  cursor: Cursor
}

export function beatTicks(beat: Duration): number {
  return ((TICKS_PER_QUARTER * 4) / beat.value) * (beat.dotted ? 1.5 : 1)
}

export function barTicks(song: Song): number {
  const [beats, unit] = song.timeSignature
  return (beats * TICKS_PER_QUARTER * 4) / unit
}

const REST_OPTIONS = NOTE_VALUES.flatMap((value) => [
  { value, dotted: true },
  { value, dotted: false }
])
  .map((d) => ({ ...d, ticks: beatTicks(d) }))
  .sort((a, b) => b.ticks - a.ticks)

/** Rest beats that fill `ticks`, largest values first. */
export function restsFor(ticks: number): Beat[] {
  const beats: Beat[] = []
  let remaining = ticks
  while (remaining > 0) {
    const option = REST_OPTIONS.find((o) => o.ticks <= remaining)
    if (!option) break
    beats.push({ value: option.value, dotted: option.dotted, notes: [] })
    remaining -= option.ticks
  }
  return beats
}

export function emptyBar(song: Song): Bar {
  return { beats: restsFor(barTicks(song)) }
}

export interface NewSongOptions {
  title: string
  tempo: number
  timeSignature: [number, number]
  firstTrack: TrackKind
  bars?: number
}

/** A new project: one track with a few empty bars. */
export function createSong(options: NewSongOptions): Song {
  const song: Song = { title: options.title, tempo: options.tempo, timeSignature: options.timeSignature, tracks: [], sections: [] }
  const bars = Array.from({ length: options.bars ?? 4 }, () => emptyBar(song))
  song.tracks.push(createTrack(options.firstTrack, bars))
  return song
}

function edit(song: Song, cursor: Cursor, change: (draft: Song, cursor: Cursor) => Cursor | false | void): EditResult | null {
  const draft = structuredClone(song)
  const next = change(draft, { ...cursor })
  if (next === false) return null
  return { song: draft, cursor: clampCursor(draft, next ?? cursor) }
}

function beatAt(song: Song, c: Cursor): Beat {
  return song.tracks[c.track].bars[c.bar].beats[c.beat]
}

// ---------------------------------------------------------------- notes

/**
 * Puts a fret on the cursor's string (EDIT-01). On a rest that is longer than
 * `duration`, the rest is split so the new note gets the chosen length.
 */
export function setFret(song: Song, cursor: Cursor, fret: number, duration: Duration): EditResult | null {
  if (fret < 0 || fret > MAX_FRET) return null
  return edit(song, cursor, (draft, c) => {
    const beats = draft.tracks[c.track].bars[c.bar].beats
    const beat = beats[c.beat]
    if (beat.notes.length === 0 && beatTicks(beat) > beatTicks(duration)) {
      const rest = beatTicks(beat) - beatTicks(duration)
      beat.value = duration.value
      beat.dotted = duration.dotted
      beats.splice(c.beat + 1, 0, ...restsFor(rest))
    }
    beat.notes = beat.notes.filter((n) => n.string !== c.string)
    beat.notes.push({ string: c.string, fret, velocity: 96 })
    beat.notes.sort((a, b) => a.string - b.string)
  })
}

/** Removes the note on the cursor's string; the beat becomes a rest when it was the last one. */
export function deleteNote(song: Song, cursor: Cursor): EditResult | null {
  if (!beatAt(song, cursor).notes.some((n) => n.string === cursor.string)) return null
  return edit(song, cursor, (draft, c) => {
    const beat = beatAt(draft, c)
    beat.notes = beat.notes.filter((n) => n.string !== c.string)
  })
}

/** Turns the whole beat into a rest. */
export function clearBeat(song: Song, cursor: Cursor): EditResult | null {
  if (beatAt(song, cursor).notes.length === 0) return null
  return edit(song, cursor, (draft, c) => {
    beatAt(draft, c).notes = []
  })
}

/**
 * Changes a beat's length (EDIT-02). Shorter: the gap is filled with rests.
 * Longer: the following beats give up their time; returns null if the bar
 * doesn't have enough room left.
 */
export function setDuration(song: Song, cursor: Cursor, duration: Duration): EditResult | null {
  const beats = song.tracks[cursor.track].bars[cursor.bar].beats
  const oldTicks = beatTicks(beats[cursor.beat])
  const newTicks = beatTicks(duration)
  if (oldTicks === newTicks) return null
  const roomAfter = beats.slice(cursor.beat + 1).reduce((sum, b) => sum + beatTicks(b), 0)
  if (newTicks - oldTicks > roomAfter) return null

  return edit(song, cursor, (draft, c) => {
    const bar = draft.tracks[c.track].bars[c.bar]
    const beat = bar.beats[c.beat]
    beat.value = duration.value
    beat.dotted = duration.dotted
    if (newTicks < oldTicks) {
      bar.beats.splice(c.beat + 1, 0, ...restsFor(oldTicks - newTicks))
      return
    }
    let extra = newTicks - oldTicks
    while (extra > 0) {
      const next = bar.beats[c.beat + 1]
      const ticks = beatTicks(next)
      if (ticks <= extra) {
        bar.beats.splice(c.beat + 1, 1)
        extra -= ticks
      } else {
        // The next beat starts later and gets shorter; it keeps its notes.
        const remainder = restsFor(ticks - extra)
        remainder[0].notes = next.notes
        bar.beats.splice(c.beat + 1, 1, ...remainder)
        extra = 0
      }
    }
  })
}

/** Halves (shorter) or doubles (longer) the beat at the cursor. */
export function stepDuration(song: Song, cursor: Cursor, direction: 'shorter' | 'longer'): EditResult | null {
  const beat = beatAt(song, cursor)
  const index = NOTE_VALUES.indexOf(beat.value) + (direction === 'shorter' ? 1 : -1)
  if (index < 0 || index >= NOTE_VALUES.length) return null
  return setDuration(song, cursor, { value: NOTE_VALUES[index], dotted: beat.dotted })
}

export function toggleDotted(song: Song, cursor: Cursor): EditResult | null {
  const beat = beatAt(song, cursor)
  return setDuration(song, cursor, { value: beat.value, dotted: !beat.dotted })
}

// ---------------------------------------------------------------- bars

function shiftSections(song: Song, fromBar: number, by: number): void {
  for (const section of song.sections) if (section.bar >= fromBar) section.bar += by
}

export function nextSectionName(song: Song): string {
  const letter = String.fromCharCode('A'.charCodeAt(0) + (song.sections.length % 26))
  return `Section ${letter}`
}

/**
 * Appends empty bars to every track; the cursor moves to the first new bar.
 * With `sectionName`, the new bars start a named section.
 */
export function addBars(song: Song, cursor: Cursor, count: number, sectionName?: string): EditResult {
  return edit(song, cursor, (draft, c) => {
    const first = barCount(draft)
    for (const track of draft.tracks) for (let i = 0; i < count; i++) track.bars.push(emptyBar(draft))
    if (sectionName) draft.sections.push({ bar: first, name: sectionName })
    return { ...c, bar: first, beat: 0 }
  })!
}

/** Inserts an empty bar before the cursor's bar, in every track. */
export function insertBarBefore(song: Song, cursor: Cursor): EditResult {
  return edit(song, cursor, (draft, c) => {
    for (const track of draft.tracks) track.bars.splice(c.bar, 0, emptyBar(draft))
    shiftSections(draft, c.bar, 1)
    return { ...c, beat: 0 }
  })!
}

/** Copies the cursor's bar (all tracks) right after it. */
export function duplicateBar(song: Song, cursor: Cursor): EditResult {
  return edit(song, cursor, (draft, c) => {
    for (const track of draft.tracks) track.bars.splice(c.bar + 1, 0, structuredClone(track.bars[c.bar]))
    shiftSections(draft, c.bar + 1, 1)
    return { ...c, bar: c.bar + 1 }
  })!
}

/** Deletes the cursor's bar from every track. The last remaining bar can't be deleted. */
export function deleteBar(song: Song, cursor: Cursor): EditResult | null {
  if (barCount(song) <= 1) return null
  return edit(song, cursor, (draft, c) => {
    for (const track of draft.tracks) track.bars.splice(c.bar, 1)
    const remaining = barCount(draft)
    draft.sections = draft.sections
      .map((s) => ({ ...s, bar: s.bar > c.bar ? s.bar - 1 : s.bar }))
      .filter((s, i, all) => s.bar < remaining && all.findIndex((o) => o.bar === s.bar) === i)
    return { ...c, bar: Math.min(c.bar, remaining - 1), beat: 0 }
  })
}

/** Replaces the cursor's bar in the current track with an empty bar. */
export function clearBar(song: Song, cursor: Cursor): EditResult {
  return edit(song, cursor, (draft, c) => {
    draft.tracks[c.track].bars[c.bar] = emptyBar(draft)
    return { ...c, beat: 0 }
  })!
}

/** Pastes a copied bar over the cursor's bar in the current track. */
export function pasteBar(song: Song, cursor: Cursor, bar: Bar): EditResult | null {
  const ticks = bar.beats.reduce((sum, b) => sum + beatTicks(b), 0)
  if (ticks !== barTicks(song)) return null
  const strings = song.tracks[cursor.track].tuning.length
  return edit(song, cursor, (draft, c) => {
    const copy = structuredClone(bar)
    for (const beat of copy.beats) beat.notes = beat.notes.filter((n) => n.string <= strings)
    draft.tracks[c.track].bars[c.bar] = copy
    return { ...c, beat: 0 }
  })
}

// ---------------------------------------------------------------- sections

/** Sets, renames (name) or removes (null) the section that starts at `bar`. */
export function setSection(song: Song, cursor: Cursor, bar: number, name: string | null): EditResult {
  return edit(song, cursor, (draft) => {
    draft.sections = draft.sections.filter((s) => s.bar !== bar)
    if (name !== null) draft.sections.push({ bar, name })
    draft.sections.sort((a, b) => a.bar - b.bar)
  })!
}

export function sectionAt(song: Song, bar: number): string | null {
  return song.sections.find((s) => s.bar === bar)?.name ?? null
}

// ---------------------------------------------------------------- tracks

export function addTrack(song: Song, cursor: Cursor, kind: TrackKind): EditResult {
  return edit(song, cursor, (draft, c) => {
    const bars = Array.from({ length: Math.max(1, barCount(draft)) }, () => emptyBar(draft))
    draft.tracks.push(createTrack(kind, bars))
    return { ...c, track: draft.tracks.length - 1, beat: 0, string: 1 }
  })!
}

export function deleteTrack(song: Song, cursor: Cursor, index: number): EditResult | null {
  if (song.tracks.length <= 1) return null
  return edit(song, cursor, (draft, c) => {
    draft.tracks.splice(index, 1)
    return { ...c, track: Math.min(c.track, draft.tracks.length - 1) }
  })
}

export function updateTrack(song: Song, cursor: Cursor, index: number, patch: Partial<Pick<Track, 'name' | 'instrument' | 'volume'>>): EditResult {
  return edit(song, cursor, (draft) => {
    Object.assign(draft.tracks[index], patch)
  })!
}

export function updateSong(song: Song, cursor: Cursor, patch: Partial<Pick<Song, 'title' | 'tempo'>>): EditResult {
  return edit(song, cursor, (draft) => {
    Object.assign(draft, patch)
  })!
}

// ---------------------------------------------------------------- cursor

export function clampCursor(song: Song, c: Cursor): Cursor {
  const track = Math.max(0, Math.min(c.track, song.tracks.length - 1))
  const bars = song.tracks[track].bars
  const bar = Math.max(0, Math.min(c.bar, bars.length - 1))
  const beat = Math.max(0, Math.min(c.beat, bars[bar].beats.length - 1))
  const string = Math.max(1, Math.min(c.string, song.tracks[track].tuning.length))
  return { track, bar, beat, string }
}

/** Next or previous beat, crossing bar lines. Stops at the start and end of the song. */
export function moveBeat(song: Song, c: Cursor, delta: 1 | -1): Cursor {
  const bars = song.tracks[c.track].bars
  if (delta === 1) {
    if (c.beat + 1 < bars[c.bar].beats.length) return { ...c, beat: c.beat + 1 }
    if (c.bar + 1 < bars.length) return { ...c, bar: c.bar + 1, beat: 0 }
    return c
  }
  if (c.beat > 0) return { ...c, beat: c.beat - 1 }
  if (c.bar > 0) return { ...c, bar: c.bar - 1, beat: bars[c.bar - 1].beats.length - 1 }
  return c
}

export function moveString(song: Song, c: Cursor, delta: 1 | -1): Cursor {
  return clampCursor(song, { ...c, string: c.string + delta })
}

function beatStart(bar: Bar, beatIndex: number): number {
  return bar.beats.slice(0, beatIndex).reduce((sum, b) => sum + beatTicks(b), 0)
}

/** Switches to the previous/next track, staying at the same point in time. */
export function moveTrack(song: Song, c: Cursor, delta: 1 | -1): Cursor {
  return switchTrack(song, c, c.track + delta)
}

/** Moves the cursor to another track, onto the beat sounding at the same time. */
export function switchTrack(song: Song, c: Cursor, track: number): Cursor {
  if (track < 0 || track >= song.tracks.length || track === c.track) return c
  const time = beatStart(song.tracks[c.track].bars[c.bar], c.beat)
  const bar = song.tracks[track].bars[c.bar]
  let beat = 0
  let start = 0
  for (let i = 0; i < bar.beats.length; i++) {
    if (start <= time) beat = i
    start += beatTicks(bar.beats[i])
  }
  return clampCursor(song, { track, bar: c.bar, beat, string: c.string })
}

export function moveBar(song: Song, c: Cursor, delta: 1 | -1): Cursor {
  return clampCursor(song, { ...c, bar: c.bar + delta, beat: 0 })
}
