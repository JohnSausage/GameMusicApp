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
  const song: Song = { title: options.title, tempo: options.tempo, timeSignature: options.timeSignature, tracks: [], sections: [], takes: [] }
  const bars = Array.from({ length: options.bars ?? 4 }, () => emptyBar(song))
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
    const beat = beats[c.beat]
    if (beat.notes.length === 0 && beatTicks(beat) > beatTicks(duration)) {
      const rest = beatTicks(beat) - beatTicks(duration)
      beat.value = duration.value
      beat.dotted = duration.dotted
      beats.splice(c.beat + 1, 0, ...restsFor(rest))
    }
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
 * each bar moves along; rests at the end of the bar absorb the difference.
 * Returns null if a bar would overflow, so no notes are ever pushed out.
 */
export function setSelectionDuration(song: Song, cursor: Cursor, sel: Selection, change: (beat: Beat) => Duration): EditResult | null {
  const draft = structuredClone(song)
  const T = barTicks(draft)
  for (const { bar, from, to } of selectedRanges(draft, sel)) {
    const target = draft.tracks[sel.track].bars[bar]
    const head = [...target.beats.slice(0, from), ...target.beats.slice(from, to + 1).map((b) => ({ ...b, ...change(b) }))]
    const tail = withoutTrailingRests(target.beats.slice(to + 1))
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
    const T = barTicks(draft)
    for (const { bar, from, to } of selectedRanges(draft, sel)) {
      const target = draft.tracks[sel.track].bars[bar]
      const kept = withoutTrailingRests([...target.beats.slice(0, from), ...target.beats.slice(to + 1)])
      target.beats = [...kept, ...restsFor(T - ticksOf(kept))]
    }
    return { track: sel.track, bar: sel.start.bar, beat: 0, string: cursor.string }
  })!
}

interface Span {
  /** Ticks from the start of the song. */
  start: number
  length: number
  notes: Note[]
}

function trackSpans(track: Track): Span[] {
  const spans: Span[] = []
  let start = 0
  for (const bar of track.bars) {
    for (const beat of bar.beats) {
      spans.push({ start, length: beatTicks(beat), notes: beat.notes })
      start += beatTicks(beat)
    }
  }
  return spans
}

/**
 * Lays spans (in time order, no overlaps) out into full bars. Gaps become rests;
 * a span crossing a bar line keeps its notes only in the first part (no ties yet).
 */
function barsFromSpans(spans: Span[], barLength: number, count: number): Bar[] {
  const bars: Bar[] = Array.from({ length: count }, () => ({ beats: [] }))
  const place = (start: number, length: number, notes: Note[]): void => {
    while (length > 0) {
      const bar = Math.floor(start / barLength)
      const part = Math.min(length, (bar + 1) * barLength - start)
      restsFor(part).forEach((beat, i) => {
        if (i === 0) beat.notes = notes
        bars[bar].beats.push(beat)
      })
      start += part
      length -= part
      notes = []
    }
  }
  let position = 0
  for (const span of spans) {
    if (span.start > position) place(position, span.start - position, [])
    place(span.start, span.length, span.notes)
    position = span.start + span.length
  }
  place(position, count * barLength - position, [])
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
    const T = barTicks(draft)
    const track = draft.tracks[c.track]
    const strings = track.tuning.length
    const start = c.bar * T + beatStart(track.bars[c.bar], c.beat)
    const end = start + ticksOf(beats)
    const extra = Math.ceil(end / T) - barCount(draft)
    for (const t of draft.tracks) for (let i = 0; i < extra; i++) t.bars.push(emptyBar(draft))

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
    track.bars = barsFromSpans(spans, T, barCount(draft))
    return { ...c, beat: Math.max(0, track.bars[c.bar].beats.findIndex((_, i) => beatStart(track.bars[c.bar], i) >= start - c.bar * T)) }
  })
}

/**
 * Writes bars (e.g. a transcription) into a track from `startBar` on, replacing
 * what was there and adding bars to the song when needed (TRN-09). The take the
 * bars came from is added to the project, or updated (e.g. its alignment) if it
 * is already there. Returns null if a bar isn't full.
 */
export function writeBars(song: Song, cursor: Cursor, trackIndex: number, startBar: number, bars: Bar[], take?: TakeInfo): EditResult | null {
  if (bars.length === 0 || bars.some((bar) => bar.beats.reduce((sum, b) => sum + beatTicks(b), 0) !== barTicks(song))) return null
  return edit(song, cursor, (draft) => {
    const needed = startBar + bars.length - barCount(draft)
    for (const track of draft.tracks) for (let i = 0; i < needed; i++) track.bars.push(emptyBar(draft))
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
    draft.sections = draft.sections.filter((s) => s.bar !== bar)
    if (name !== null) draft.sections.push({ bar, name })
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
    const bars = Array.from({ length: Math.max(1, barCount(draft)) }, () => emptyBar(draft))
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
