// Editing operations on the song. All of them are pure: they return a new song
// (and where the cursor should be), or null when the edit isn't possible.
// Bars are always kept exactly full, padding with rests where needed.
import {
  barCount,
  createTrack,
  isBassTrack,
  keyRow,
  MASTER_DEFAULTS,
  MAX_FRET,
  NOTE_VALUES,
  timeSignatureAt,
  type Bar,
  type Beat,
  type MasterSettings,
  type Note,
  type NoteValue,
  type Song,
  type TakeInfo,
  type Track,
  type TrackKind
} from './song'
import { eightBitKit, factoryPreset } from './synth'

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
  /** Three in the time of two (see Beat.triplet). */
  triplet?: boolean
}

export interface EditResult {
  song: Song
  cursor: Cursor
}

export function beatTicks(beat: Duration): number {
  const ticks = ((TICKS_PER_QUARTER * 4) / beat.value) * (beat.dotted ? 1.5 : 1)
  return beat.triplet ? (ticks * 2) / 3 : ticks
}

/** How long a bar is, by the time signature at it (the first bar's by default). */
export function barTicks(song: Pick<Song, 'timeSignature' | 'changes'>, bar = 0): number {
  const [beats, unit] = timeSignatureAt(song, bar)
  return (beats * TICKS_PER_QUARTER * 4) / unit
}

/** Where bars 0…count start in ticks from the start of the song (count + 1 entries: the last is where bar `count` would start). */
export function barStartTicks(song: Pick<Song, 'timeSignature' | 'changes'>, count: number): number[] {
  const starts = [0]
  for (let bar = 0; bar < count; bar++) starts.push(starts[bar] + barTicks(song, bar))
  return starts
}

const byLength = (options: Duration[]): (Duration & { ticks: number })[] => options.map((d) => ({ ...d, ticks: beatTicks(d) })).sort((a, b) => b.ticks - a.ticks)
const STRAIGHT_RESTS = byLength(NOTE_VALUES.flatMap((value) => [{ value, dotted: true }, { value, dotted: false }]))
const ALL_RESTS = byLength([...STRAIGHT_RESTS, ...NOTE_VALUES.map((value) => ({ value, dotted: false, triplet: true }))])

const restOf = ({ value, dotted, triplet }: Duration): Beat => ({ value, dotted, ...(triplet && { triplet: true }), notes: [] })

/** Rests from `options` that fill `ticks` exactly, largest first; null if they can't. */
function fill(ticks: number, options: (Duration & { ticks: number })[]): Beat[] | null {
  if (ticks < 0) return null
  const beats: Beat[] = []
  let remaining = ticks
  while (remaining > 0) {
    const option = options.find((o) => o.ticks <= remaining)
    if (!option) return null
    beats.push(restOf(option))
    remaining -= option.ticks
  }
  return beats
}

/** True when `ticks` can be filled without triplets: a point on the straight grid, after any triplet group is complete. */
export const onGrid = (ticks: number): boolean => fill(ticks, STRAIGHT_RESTS) !== null

/** One or two triplet rests of `value` (completing a group of three) and straight rests after them that fill `ticks`; null if that doesn't fit. */
function tripletRests(ticks: number, value: NoteValue): Beat[] | null {
  for (const count of [1, 2]) {
    const after = fill(ticks - count * beatTicks({ value, dotted: false, triplet: true }), STRAIGHT_RESTS)
    if (after) return [...Array.from({ length: count }, () => restOf({ value, dotted: false, triplet: true })), ...after]
  }
  return null
}

/**
 * Rest beats that fill `ticks`, largest values first. After a triplet (off the
 * straight grid), triplet rests come first to complete its group: of the value
 * `triplet` if they can, e.g. two triplet eighth rests after a triplet eighth.
 */
export function restsFor(ticks: number, triplet?: NoteValue): Beat[] {
  const straight = fill(ticks, STRAIGHT_RESTS)
  if (straight) return straight
  for (const value of triplet ? [triplet, ...NOTE_VALUES] : NOTE_VALUES) {
    const rests = tripletRests(ticks, value)
    if (rests) return rests
  }
  // Odd lengths: as much as fits.
  const beats: Beat[] = []
  let remaining = ticks
  for (let option = ALL_RESTS.find((o) => o.ticks <= remaining); option; option = ALL_RESTS.find((o) => o.ticks <= remaining)) {
    beats.push(restOf(option))
    remaining -= option.ticks
  }
  return beats
}

/**
 * Puts rests for `gap` ticks at beats[at]. After a triplet of value `triplet`,
 * rests right after give up time when needed, so its group is completed with
 * rests of its value (a triplet eighth on a quarter rest: two triplet eighth
 * rests) rather than an odd shorter one.
 */
function insertRests(beats: Beat[], at: number, gap: number, triplet?: NoteValue): void {
  let end = at
  let ticks = gap
  if (triplet !== undefined && !onGrid(gap)) {
    let next = at
    let total = gap
    while (!tripletRests(total, triplet) && beats[next]?.notes.length === 0) total += beatTicks(beats[next++])
    if (tripletRests(total, triplet)) {
      end = next
      ticks = total
    }
  }
  beats.splice(at, end - at, ...restsFor(ticks, triplet))
}

/** The beat with another length; its notes stay. */
function withDuration(beat: Beat, { value, dotted, triplet }: Duration): Beat {
  const { triplet: _, ...rest } = beat
  return { ...rest, value, dotted, ...(triplet && { triplet: true }) }
}

const tripletValue = (d: Duration): NoteValue | undefined => (d.triplet ? d.value : undefined)

/** Triplet rests of `value` that complete a group ending at `position` (ticks into the bar) off the straight grid; none on it. */
function completeGroup(position: number, value: NoteValue): Beat[] {
  if (onGrid(position)) return []
  const rest = { value, dotted: false, triplet: true }
  for (const count of [1, 2]) if (onGrid(position + count * beatTicks(rest))) return Array.from({ length: count }, () => restOf(rest))
  return []
}

/** A bar of rests, as long as the time signature at `bar` asks for. */
export function emptyBar(song: Pick<Song, 'timeSignature' | 'changes'>, bar = 0): Bar {
  return { beats: restsFor(barTicks(song, bar)) }
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
  const song: Song = { title: options.title, tempo: options.tempo, timeSignature: options.timeSignature, tracks: [], sections: [], takes: [] }
  const bars = Array.from({ length: options.bars ?? 4 }, (_, bar) => emptyBar(song, bar))
  song.tracks.push(createTrack(options.firstTrack, bars))
  return song
}

/** Applies `change` to a copy of the song; returning false means "not possible" (null result). */
export function edit(song: Song, cursor: Cursor, change: (draft: Song, cursor: Cursor) => Cursor | false | void): EditResult | null {
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
    if (beats[c.beat].notes.length === 0 && beatTicks(beats[c.beat]) > beatTicks(duration)) {
      const rest = beatTicks(beats[c.beat]) - beatTicks(duration)
      beats[c.beat] = withDuration(beats[c.beat], duration)
      insertRests(beats, c.beat + 1, rest, tripletValue(duration))
    }
    const beat = beats[c.beat]
    // A new fret is played again (no longer held), but keeps a hammer-on or slide into the next note.
    const old = beat.notes.find((n) => n.string === c.string)
    beat.notes = beat.notes.filter((n) => n.string !== c.string)
    beat.notes.push({ string: c.string, fret, velocity: 96, ...(old?.hammer && { hammer: true }), ...(old?.slide && { slide: true }) })
    beat.notes.sort((a, b) => a.string - b.string)
    followTies(draft, c)
  })
}

/** Notes held from the cursor's note (ties, possibly over several beats) take on its fret. */
export function followTies(song: Song, c: Cursor): void {
  let from = beatAt(song, c).notes.find((n) => n.string === c.string)
  let at = c
  while (from) {
    const next = moveBeat(song, at, 1)
    if (next.bar === at.bar && next.beat === at.beat) return
    const held = beatAt(song, next).notes.find((n) => n.string === c.string && n.tie)
    if (held) held.fret = from.fret
    from = held
    at = next
  }
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
 * Removes the beat at the cursor (a rest or a note). The rest of the bar moves
 * earlier to close the gap and the bar is filled up with rests at the end.
 * Returns null when there's nothing after it to move (only rests follow).
 */
export function deleteBeat(song: Song, cursor: Cursor): EditResult | null {
  const beats = song.tracks[cursor.track].bars[cursor.bar].beats
  if (beats.slice(cursor.beat).every((b) => b.notes.length === 0)) return null
  return edit(song, cursor, (draft, c) => {
    const bar = draft.tracks[c.track].bars[c.bar]
    const [removed] = bar.beats.splice(c.beat, 1)
    let freed = beatTicks(removed)
    // Merge the freed time with the rests already at the end of the bar.
    while (bar.beats.length > 0 && bar.beats[bar.beats.length - 1].notes.length === 0) freed += beatTicks(bar.beats.pop()!)
    bar.beats.push(...restsFor(freed))
    return { ...c, beat: Math.min(c.beat, bar.beats.length - 1) }
  })
}

/**
 * Changes a beat's length (EDIT-02). Shorter: the gap is filled with rests
 * (after a triplet, completing its group). Longer: the following beats give up
 * their time; returns null if the bar doesn't have enough room left.
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
    bar.beats[c.beat] = withDuration(bar.beats[c.beat], duration)
    if (newTicks < oldTicks) {
      insertRests(bar.beats, c.beat + 1, oldTicks - newTicks, tripletValue(duration))
      return
    }
    let extra = newTicks - oldTicks
    while (extra > 0) {
      const next = bar.beats[c.beat + 1]
      const ticks = beatTicks(next)
      if (ticks <= extra) {
        bar.beats.splice(c.beat + 1, 1)
        extra -= ticks
      } else if (next.notes.length === 0) {
        // A rest gets shorter. Off the straight grid (what is left of a triplet
        // group), the rests after it join in, so they become straight ones again.
        let end = c.beat + 2
        let left = ticks - extra
        while (!onGrid(left) && bar.beats[end]?.notes.length === 0) left += beatTicks(bar.beats[end++])
        if (!onGrid(left)) [end, left] = [c.beat + 2, ticks - extra]
        bar.beats.splice(c.beat + 1, end - c.beat - 1, ...restsFor(left))
        extra = 0
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
  return setDuration(song, cursor, { value: NOTE_VALUES[index], dotted: beat.dotted, triplet: beat.triplet })
}

/** Dotted on or off; a dotted note is no triplet. */
export function toggleDotted(song: Song, cursor: Cursor): EditResult | null {
  const beat = beatAt(song, cursor)
  return setDuration(song, cursor, { value: beat.value, dotted: !beat.dotted })
}

/** Triplet on or off (EDIT-02); a triplet is not dotted. */
export function toggleTriplet(song: Song, cursor: Cursor): EditResult | null {
  const beat = beatAt(song, cursor)
  return setDuration(song, cursor, { value: beat.value, dotted: false, triplet: !beat.triplet })
}

// ---------------------------------------------------------------- bars

/** Sections and tempo or time-signature changes from `fromBar` on move by `by` bars. */
function shiftSections(song: Song, fromBar: number, by: number): void {
  for (const section of song.sections) if (section.bar >= fromBar) section.bar += by
  for (const change of song.changes ?? []) if (change.bar >= fromBar) change.bar += by
}

/** "Section A", "Section B"…: the letter after the number of sections, or the next one not taken. */
export function nextSectionName(song: Song): string {
  const taken = new Set(song.sections.map((s) => s.name))
  for (let i = 0; i < 26; i++) {
    const name = `Section ${String.fromCharCode('A'.charCodeAt(0) + ((song.sections.length + i) % 26))}`
    if (!taken.has(name)) return name
  }
  return `Section ${song.sections.length + 1}`
}

/**
 * Appends empty bars to every track of a song being edited. In an arranged song
 * they start a new section when the last section plays a part that also plays
 * elsewhere: that part stays as it is instead of being copied to make room.
 */
export function appendBars(draft: Song, count: number): void {
  if (count <= 0) return
  const first = barCount(draft)
  const arrangement = draft.arrangement ?? []
  const last = arrangement.at(-1)
  const shared = last && Object.values(last.parts).some((id) => arrangement.some((s) => s !== last && Object.values(s.parts).includes(id)))
  if (shared && !draft.sections.some((s) => s.bar === first)) draft.sections.push({ bar: first, name: nextSectionName(draft) })
  for (const track of draft.tracks) for (let i = 0; i < count; i++) track.bars.push(emptyBar(draft, first + i))
}

/**
 * Appends empty bars to every track; the cursor moves to the first new bar.
 * With `sectionName`, the new bars start a named section.
 */
export function addBars(song: Song, cursor: Cursor, count: number, sectionName?: string): EditResult {
  return edit(song, cursor, (draft, c) => {
    const first = barCount(draft)
    if (sectionName) draft.sections.push({ bar: first, name: sectionName })
    appendBars(draft, count)
    return { ...c, bar: first, beat: 0 }
  })!
}

/** Inserts an empty bar before the cursor's bar, in every track. At a section's first bar, the new bar starts that section. */
export function insertBarBefore(song: Song, cursor: Cursor): EditResult {
  return edit(song, cursor, (draft, c) => {
    for (const track of draft.tracks) track.bars.splice(c.bar, 0, emptyBar(draft, c.bar))
    shiftSections(draft, c.bar + 1, 1)
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
    // A section whose only bar is deleted goes; the next one keeps its start.
    draft.sections = draft.sections
      .map((s) => ({ ...s, bar: s.bar > c.bar ? s.bar - 1 : s.bar }))
      .filter((s, i, all) => s.bar < remaining && all.findLastIndex((o) => o.bar === s.bar) === i)
    // Likewise a change of tempo or time signature: the next bar's own change wins.
    if (draft.changes) {
      draft.changes = draft.changes
        .map((ch) => ({ ...ch, bar: ch.bar > c.bar ? ch.bar - 1 : ch.bar }))
        .filter((ch, i, all) => ch.bar > 0 && ch.bar < remaining && all.findLastIndex((o) => o.bar === ch.bar) === i)
      if (draft.changes.length === 0) delete draft.changes
    }
    return { ...c, bar: Math.min(c.bar, remaining - 1), beat: 0 }
  })
}

/** Replaces the cursor's bar in the current track with an empty bar. */
export function clearBar(song: Song, cursor: Cursor): EditResult {
  return edit(song, cursor, (draft, c) => {
    draft.tracks[c.track].bars[c.bar] = emptyBar(draft, c.bar)
    return { ...c, beat: 0 }
  })!
}

// ---------------------------------------------------------------- selections

export interface BeatPos {
  bar: number
  beat: number
}

/** A range of beats in one track, `start` to `end` inclusive (start comes first). */
export interface Selection {
  track: number
  start: BeatPos
  end: BeatPos
}

const before = (a: BeatPos, b: BeatPos): boolean => a.bar < b.bar || (a.bar === b.bar && a.beat < b.beat)

/** The selection between two beats, in either order. */
export function selectionBetween(track: number, a: BeatPos, b: BeatPos): Selection {
  return before(b, a) ? { track, start: { ...b }, end: { ...a } } : { track, start: { ...a }, end: { ...b } }
}

/** Every beat of a track. */
export function selectTrack(song: Song, track: number): Selection {
  const bars = song.tracks[track].bars
  return { track, start: { bar: 0, beat: 0 }, end: { bar: bars.length - 1, beat: bars[bars.length - 1].beats.length - 1 } }
}

/** The selected beats bar by bar: beat indices `from`…`to` of each bar. */
export function selectedRanges(song: Song, sel: Selection): { bar: number; from: number; to: number }[] {
  const bars = song.tracks[sel.track]?.bars ?? []
  const ranges: { bar: number; from: number; to: number }[] = []
  for (let bar = sel.start.bar; bar <= Math.min(sel.end.bar, bars.length - 1); bar++) {
    const from = bar === sel.start.bar ? sel.start.beat : 0
    const to = Math.min(bar === sel.end.bar ? sel.end.beat : Infinity, bars[bar].beats.length - 1)
    if (from <= to) ranges.push({ bar, from, to })
  }
  return ranges
}

export function selectionBeats(song: Song, sel: Selection): Beat[] {
  return selectedRanges(song, sel).flatMap(({ bar, from, to }) => structuredClone(song.tracks[sel.track].bars[bar].beats.slice(from, to + 1)))
}

const ticksOf = (beats: Beat[]): number => beats.reduce((sum, b) => sum + beatTicks(b), 0)

/** Rests at the end of a bar are dropped and refilled, so freed or needed time is merged there. */
function withoutTrailingRests(beats: Beat[]): Beat[] {
  let end = beats.length
  while (end > 0 && beats[end - 1].notes.length === 0) end--
  return beats.slice(0, end)
}

/**
 * Gives every selected beat a new length (each keeps its notes). The rest of
 * each bar moves along; rests at the end of the bar absorb the difference. A
 * triplet group the selection leaves incomplete is completed with rests.
 * Returns null if a bar would overflow, so no notes are ever pushed out.
 */
export function setSelectionDuration(song: Song, cursor: Cursor, sel: Selection, change: (beat: Beat) => Duration): EditResult | null {
  const draft = structuredClone(song)
  for (const { bar, from, to } of selectedRanges(draft, sel)) {
    const T = barTicks(draft, bar)
    const target = draft.tracks[sel.track].bars[bar]
    const head = [...target.beats.slice(0, from), ...target.beats.slice(from, to + 1).map((b) => withDuration(b, change(b)))]
    const tail = withoutTrailingRests(target.beats.slice(to + 1))
    const last = head[head.length - 1]
    if (last.triplet && !tail[0]?.triplet) head.push(...completeGroup(ticksOf(head), last.value))
    const used = ticksOf(head) + ticksOf(tail)
    if (used > T) return null
    target.beats = [...head, ...tail, ...restsFor(T - used)]
  }
  return { song: draft, cursor: clampCursor(draft, cursor) }
}

/** Turns the selected beats into rests. Null if they already are. */
export function clearSelection(song: Song, cursor: Cursor, sel: Selection): EditResult | null {
  if (selectionBeats(song, sel).every((b) => b.notes.length === 0)) return null
  return edit(song, cursor, (draft) => {
    for (const { bar, from, to } of selectedRanges(draft, sel)) {
      for (const beat of draft.tracks[sel.track].bars[bar].beats.slice(from, to + 1)) beat.notes = []
    }
  })
}

/** Removes the selected beats; each bar closes the gap and refills with rests at the end. */
export function deleteSelection(song: Song, cursor: Cursor, sel: Selection): EditResult {
  return edit(song, cursor, (draft) => {
    for (const { bar, from, to } of selectedRanges(draft, sel)) {
      const T = barTicks(draft, bar)
      const target = draft.tracks[sel.track].bars[bar]
      const kept = withoutTrailingRests([...target.beats.slice(0, from), ...target.beats.slice(to + 1)])
      target.beats = [...kept, ...restsFor(T - ticksOf(kept))]
    }
    return { track: sel.track, bar: sel.start.bar, beat: 0, string: cursor.string }
  })!
}

export interface Span {
  /** Ticks from the start of the song. */
  start: number
  length: number
  notes: Note[]
}

/** The beats of bars in time order, with where each starts. */
export function barSpans(bars: Bar[]): Span[] {
  const spans: Span[] = []
  let start = 0
  for (const bar of bars) {
    for (const beat of bar.beats) {
      spans.push({ start, length: beatTicks(beat), notes: beat.notes })
      start += beatTicks(beat)
    }
  }
  return spans
}

const trackSpans = (track: Track): Span[] => barSpans(track.bars)

const withoutLegato = ({ hammer: _h, slide: _s, ...note }: Note): Note => note

/**
 * Lays spans (in time order, no overlaps) out into full bars. Gaps become rests.
 * A span that needs several beats (e.g. across a bar line) has its notes in the
 * first; with `ties`, the others hold them (and the last one keeps a hammer-on
 * or slide into the next note), else they are rests. `barLength` is the
 * ticks of every bar, or of each bar (e.g. with time-signature changes).
 */
export function barsFromSpans(spans: Span[], barLength: number | number[], count: number, ties = false): Bar[] {
  const bars: Bar[] = Array.from({ length: count }, () => ({ beats: [] }))
  const starts = [0]
  for (let b = 0; b < count; b++) starts.push(starts[b] + (typeof barLength === 'number' ? barLength : barLength[b]))
  /** The bar a tick is in (the last bar for ticks past the end). */
  const barAt = (tick: number): number => {
    let lo = 0
    let hi = count - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= tick) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const place = (start: number, length: number, notes: Note[]): void => {
    const pieces: { bar: number; beat: Beat }[] = []
    while (length > 0) {
      const bar = barAt(start)
      const part = Math.min(length, starts[bar + 1] - start)
      if (part <= 0) break // past the last bar
      for (const beat of restsFor(part)) pieces.push({ bar, beat })
      start += part
      length -= part
    }
    const held = ties && pieces.length > 1
    pieces.forEach(({ bar, beat }, i) => {
      if (i === 0) beat.notes = held ? notes.map(withoutLegato) : notes
      else if (held) beat.notes = notes.map((n) => ({ ...(i === pieces.length - 1 ? n : withoutLegato(n)), tie: true }))
      bars[bar].beats.push(beat)
    })
  }
  let position = 0
  for (const span of spans) {
    if (span.start > position) place(position, span.start - position, [])
    place(span.start, span.length, span.notes)
    position = span.start + span.length
  }
  place(position, starts[count] - position, [])
  return bars
}

/**
 * Pastes copied beats at the cursor, overwriting what's there for as long as
 * they last, across bar lines if needed (adding bars at the end of the song).
 * Notes on strings the track doesn't have are left out.
 */
export function pasteBeats(song: Song, cursor: Cursor, beats: Beat[]): EditResult | null {
  if (beats.length === 0) return null
  return edit(song, cursor, (draft, c) => {
    const track = draft.tracks[c.track]
    const strings = track.tuning.length
    const barStart = barStartTicks(draft, c.bar)[c.bar]
    const start = barStart + beatStart(track.bars[c.bar], c.beat)
    const end = start + ticksOf(beats)
    let count = barCount(draft)
    while (barStartTicks(draft, count)[count] < end) count++
    appendBars(draft, count - barCount(draft))

    const spans: Span[] = []
    for (const span of trackSpans(track)) {
      const spanEnd = span.start + span.length
      if (spanEnd <= start || span.start >= end) spans.push(span)
      else {
        if (span.start < start) spans.push({ ...span, length: start - span.start }) // shortened, keeps its notes
        if (spanEnd > end) spans.push({ start: end, length: spanEnd - end, notes: [] }) // what's left after the paste
      }
    }
    let at = start
    for (const beat of beats) {
      spans.push({ start: at, length: beatTicks(beat), notes: structuredClone(beat.notes.filter((n) => n.string <= strings)) })
      at += beatTicks(beat)
    }
    spans.sort((a, b) => a.start - b.start)
    track.bars = barsFromSpans(spans, Array.from({ length: count }, (_, b) => barTicks(draft, b)), count)
    return { ...c, beat: Math.max(0, track.bars[c.bar].beats.findIndex((_, i) => beatStart(track.bars[c.bar], i) >= start - barStart)) }
  })
}

/**
 * Writes bars (e.g. a transcription) into a track from `startBar` on, replacing
 * what was there and adding bars to the song when needed (TRN-09). The take the
 * bars came from is added to the project, or updated (e.g. its alignment) if it
 * is already there. Returns null if a bar isn't full.
 */
export function writeBars(song: Song, cursor: Cursor, trackIndex: number, startBar: number, bars: Bar[], take?: TakeInfo): EditResult | null {
  if (bars.length === 0 || bars.some((bar, i) => bar.beats.reduce((sum, b) => sum + beatTicks(b), 0) !== barTicks(song, startBar + i))) return null
  return edit(song, cursor, (draft) => {
    appendBars(draft, startBar + bars.length - barCount(draft))
    bars.forEach((bar, i) => {
      draft.tracks[trackIndex].bars[startBar + i] = structuredClone(bar)
    })
    if (take) {
      const existing = draft.takes.findIndex((t) => t.id === take.id)
      if (existing >= 0) draft.takes[existing] = take
      else draft.takes.push(take)
    }
    return { track: trackIndex, bar: startBar, beat: 0, string: 1 }
  })
}

/** True if any of the bars from `startBar` on (count bars) has notes in the track. */
export function barsHaveNotes(song: Song, trackIndex: number, startBar: number, count: number): boolean {
  return song.tracks[trackIndex].bars.slice(startBar, startBar + count).some((bar) => bar.beats.some((b) => b.notes.length > 0))
}

// ---------------------------------------------------------------- takes

export function updateTake(song: Song, cursor: Cursor, id: string, patch: Partial<Pick<TakeInfo, 'name' | 'tempo' | 'firstDownbeat'>>): EditResult | null {
  if (!song.takes.some((t) => t.id === id)) return null
  return edit(song, cursor, (draft) => {
    Object.assign(draft.takes.find((t) => t.id === id)!, patch)
  })
}

export function removeTake(song: Song, cursor: Cursor, id: string): EditResult | null {
  if (!song.takes.some((t) => t.id === id)) return null
  return edit(song, cursor, (draft) => {
    draft.takes = draft.takes.filter((t) => t.id !== id)
  })
}

// ---------------------------------------------------------------- sections

/** Sets, renames (name) or removes (null) the section that starts at `bar`. */
export function setSection(song: Song, cursor: Cursor, bar: number, name: string | null): EditResult {
  return edit(song, cursor, (draft) => {
    const existing = draft.sections.find((s) => s.bar === bar)
    draft.sections = draft.sections.filter((s) => s.bar !== bar)
    if (name !== null) draft.sections.push({ ...existing, bar, name })
    draft.sections.sort((a, b) => a.bar - b.bar)
  })!
}

export function sectionAt(song: Song, bar: number): string | null {
  return song.sections.find((s) => s.bar === bar)?.name ?? null
}

/** A run of bars: `start` up to (not including) `end`. */
export interface BarRange {
  start: number
  end: number
}

/** Every section with its bars: from its start to the next section (or the end of the song). */
export function sectionRanges(song: Song): (BarRange & { name: string })[] {
  const total = barCount(song)
  const sections = [...song.sections].filter((s) => s.bar < total).sort((a, b) => a.bar - b.bar)
  return sections.map((s, i) => ({ name: s.name, start: s.bar, end: sections[i + 1]?.bar ?? total }))
}

/** What loop playback repeats (PLAY-02). It is chosen explicitly, so it stays put while you click around. */
export type LoopChoice = { kind: 'song' } | { kind: 'section'; start: number } | { kind: 'bars'; start: number; end: number }

/**
 * The bars a loop choice covers in the song as it is now, and the section's name
 * for a section. A section or bars that no longer exist fall back to the whole song.
 */
export function loopBars(song: Song, choice: LoopChoice): BarRange & { name: string | null; kind: LoopChoice['kind'] } {
  const total = barCount(song)
  if (choice.kind === 'section') {
    const section = sectionRanges(song).find((s) => s.start === choice.start)
    if (section) return { ...section, kind: 'section' }
  }
  if (choice.kind === 'bars' && choice.start < total) return { start: choice.start, end: Math.min(choice.end, total), name: null, kind: 'bars' }
  return { start: 0, end: total, name: null, kind: 'song' }
}

/** The section the bar belongs to, if it is in one. */
export function sectionRangeOf(song: Song, bar: number): (BarRange & { name: string }) | null {
  return sectionRanges(song).find((r) => bar >= r.start && bar < r.end) ?? null
}

// ---------------------------------------------------------------- tracks

export function addTrack(song: Song, cursor: Cursor, kind: TrackKind): EditResult {
  return edit(song, cursor, (draft, c) => {
    const bars = Array.from({ length: Math.max(1, barCount(draft)) }, (_, bar) => emptyBar(draft, bar))
    draft.tracks.push(createTrack(kind, bars))
    return { ...c, track: draft.tracks.length - 1, beat: 0, string: kind === 'keys' ? keyRow(60) : 1 }
  })!
}

export function deleteTrack(song: Song, cursor: Cursor, index: number): EditResult | null {
  if (song.tracks.length <= 1) return null
  return edit(song, cursor, (draft, c) => {
    draft.tracks.splice(index, 1)
    return { ...c, track: Math.min(c.track, draft.tracks.length - 1) }
  })
}

export function updateTrack(song: Song, cursor: Cursor, index: number, patch: Partial<Pick<Track, 'name' | 'instrument' | 'volume' | 'pan' | 'mute' | 'solo'>>): EditResult {
  return edit(song, cursor, (draft) => {
    Object.assign(draft.tracks[index], patch)
  })!
}

export function updateMaster(song: Song, cursor: Cursor, patch: Partial<MasterSettings>): EditResult {
  return edit(song, cursor, (draft) => {
    draft.master = { ...MASTER_DEFAULTS, ...draft.master, ...patch }
  })!
}

// ---------------------------------------------------------------- retro (SYN-31)

/** True while "Make it retro" is active (some track remembers its original sound). */
export function isRetro(song: Song): boolean {
  return song.tracks.some((t) => t.originalInstrument !== undefined)
}

/**
 * Gives every track an 8-bit sound by its role: bass → triangle, first guitar →
 * 25 % pulse lead, second → 12.5 % pulse, others → 50 % square, drums → the
 * 8-bit kit (noise and triangle sweeps). The original
 * sounds are kept so restoreSounds() can switch back; notes never change.
 */
export function makeRetro(song: Song, cursor: Cursor): EditResult {
  return edit(song, cursor, (draft) => {
    let leads = 0
    for (const track of draft.tracks) {
      track.originalInstrument ??= track.instrument
      if (track.kind === 'drums') {
        track.instrument = { kind: 'synthkit', pieces: eightBitKit() }
        continue
      }
      const name = isBassTrack(track) ? 'Triangle bass' : track.kind === 'keys' ? 'PWM lead' : (['8-bit lead', '8-bit thin lead'][leads++] ?? '8-bit square')
      track.instrument = { kind: 'synth', patch: factoryPreset(name) }
    }
  })!
}

export function restoreSounds(song: Song, cursor: Cursor): EditResult {
  return edit(song, cursor, (draft) => {
    for (const track of draft.tracks) {
      if (!track.originalInstrument) continue
      track.instrument = track.originalInstrument
      delete track.originalInstrument
    }
  })!
}

/** Changes song properties; an empty author is taken out. */
export function updateSong(song: Song, cursor: Cursor, patch: Partial<Pick<Song, 'title' | 'tempo' | 'author' | 'key'>>): EditResult {
  return edit(song, cursor, (draft) => {
    Object.assign(draft, patch)
    if (draft.author !== undefined && !draft.author.trim()) delete draft.author
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
  return clampCursor(song, { track, bar: c.bar, beat, string: startRow(song, track, c.bar, beat, song.tracks[track].kind === song.tracks[c.track].kind ? c.string : null) })
}

/**
 * The row ("string") for a cursor arriving on a beat: `keep` if given, else on
 * a keys track the beat's first note or middle C, else the top string.
 */
export function startRow(song: Song, track: number, bar: number, beat: number, keep: number | null): number {
  if (keep !== null) return keep
  if (song.tracks[track].kind !== 'keys') return 1
  return song.tracks[track].bars[bar]?.beats[beat]?.notes[0]?.string ?? keyRow(60)
}

export function moveBar(song: Song, c: Cursor, delta: 1 | -1): Cursor {
  return clampCursor(song, { ...c, bar: c.bar + delta, beat: 0 })
}
