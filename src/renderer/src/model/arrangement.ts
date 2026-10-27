// The song form: the song is a row of sections, and in each section every track
// plays one of its parts, or nothing. Parts are reused, so a change to "Theme A"
// changes every place it plays.
//
// The rest of the app (score, playback, export and every edit) works on the song
// written out bar by bar: track.bars and song.sections. writeOut() builds it from
// the arrangement, and syncArrangement() runs after every edit to write changed
// bars back into their parts, so the two never drift apart.
import { clampCursor, emptyBar, nextSectionName, sectionRanges, type Cursor, type EditResult } from './edit'
import { barCount, newId, type ArrangementSection, type Bar, type Part, type Song, type Track } from './song'

export function hasNotes(bars: Bar[]): boolean {
  return bars.some((bar) => bar.beats.some((beat) => beat.notes.length > 0))
}

const sameBar = (a: Bar | undefined, b: Bar | undefined): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Where each section starts, in bars. */
export function sectionStarts(arrangement: ArrangementSection[]): number[] {
  let bar = 0
  return arrangement.map((section) => {
    const start = bar
    bar += section.length
    return start
  })
}

/** Builds every track's bars and the section markers from the arrangement. A song without one is returned as it is. */
export function writeOut(song: Song): Song {
  const arrangement = song.arrangement
  if (!arrangement) return song
  const tracks = song.tracks.map((track) => {
    const parts = new Map((track.parts ?? []).map((p) => [p.id, p]))
    const bars: Bar[] = []
    for (const section of arrangement) {
      const part = parts.get(section.parts[track.id])
      for (let i = 0; i < section.length; i++) bars.push(part?.bars.length ? structuredClone(part.bars[i % part.bars.length]) : emptyBar(song))
    }
    return { ...track, bars }
  })
  const starts = sectionStarts(arrangement)
  return { ...song, tracks, sections: arrangement.map((s, i) => ({ id: s.id, bar: starts[i], name: s.name })) }
}

/** A name for a new part of a track: `base`, or "base 2", "base 3"… if taken. */
function partName(track: Track, base: string): string {
  const taken = new Set((track.parts ?? []).map((p) => p.name))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

function addPart(track: Track, name: string, bars: Bar[]): Part {
  const part: Part = { id: newId(), name: partName(track, name), bars: structuredClone(bars) }
  ;(track.parts ??= []).push(part)
  return part
}

/**
 * Turns a song written out bar by bar into an arrangement: a section per
 * section of the song (bars before the first one become a section too), and per
 * track a part for each section with notes. Sections with exactly the same notes
 * share one part, so repeats are linked from the start.
 */
export function arrange(song: Song): Song {
  if (song.arrangement) return song
  const draft = structuredClone(song)
  const total = barCount(draft)
  const ranges = sectionRanges(draft)
  if (ranges.length === 0 || ranges[0].start > 0) ranges.unshift({ name: ranges.length === 0 ? nextSectionName(draft) : 'Start', start: 0, end: ranges[0]?.start ?? total })
  const arrangement: ArrangementSection[] = ranges.map((r) => ({ id: newId(), name: r.name, length: r.end - r.start, parts: {} }))
  for (const track of draft.tracks) {
    track.parts = []
    const byNotes = new Map<string, Part>()
    ranges.forEach((range, i) => {
      const bars = track.bars.slice(range.start, range.end)
      if (!hasNotes(bars)) return
      const key = JSON.stringify(bars)
      const part = byNotes.get(key) ?? addPart(track, range.name, bars)
      byNotes.set(key, part)
      arrangement[i].parts[track.id] = part.id
    })
  }
  return writeOut({ ...draft, arrangement })
}

/** True if the edit changed the arrangement or a part itself (not just the written-out bars). */
function arrangementEdited(before: Song, after: Song): boolean {
  if (JSON.stringify(before.arrangement) !== JSON.stringify(after.arrangement)) return true
  const partsBefore = new Map(before.tracks.map((t) => [t.id, JSON.stringify(t.parts ?? [])]))
  return after.tracks.some((t) => partsBefore.has(t.id) && partsBefore.get(t.id) !== JSON.stringify(t.parts ?? []))
}

interface MarkedRange {
  /** The arrangement section, unless the edit started a new one. */
  id?: string
  name: string
  start: number
  end: number
}

/** The sections as the edit left the section markers. */
function markedRanges(song: Song, before: Song): MarkedRange[] {
  const total = barCount(song)
  const markers = [...song.sections].filter((s) => s.bar < total).sort((a, b) => a.bar - b.bar)
  const ranges: MarkedRange[] = markers.map((m, i) => ({ id: m.id, name: m.name, start: m.bar, end: markers[i + 1]?.bar ?? total }))
  if (ranges.length === 0 || ranges[0].start > 0) {
    // The first section can't be removed: bars before the first marker stay in it.
    const first = before.arrangement?.[0]
    const kept = first && !markers.some((m) => m.id === first.id) ? first : undefined
    ranges.unshift({ id: kept?.id, name: kept?.name ?? nextSectionName(song), start: 0, end: ranges[0]?.start ?? total })
  }
  // A marker copied with its id (e.g. by duplicating) starts a new section.
  const seen = new Set<string>()
  for (const range of ranges) {
    if (range.id && seen.has(range.id)) range.id = undefined
    if (range.id) seen.add(range.id)
  }
  // Two markers on one bar leave an empty range; the later one names the section.
  return ranges.filter((range, i) => range.end > range.start || (total === 0 && i === 0))
}

/**
 * Brings the arrangement in line after an edit of the written-out song, and
 * writes the song out again from it:
 * - a changed bar goes into the part playing there, so every repeat of the part changes;
 * - notes in a silent section become a new part, named after the section;
 * - a section that got longer or shorter (bars inserted or deleted, a section
 *   started or removed inside it) gets its bars as its part, and a copy of the
 *   part if that part also plays elsewhere;
 * - a new section marker starts a new section.
 * An edit of the arrangement itself is simply written out.
 */
export function syncArrangement(before: Song, after: Song): Song {
  if (!after.arrangement || before === after) return after
  if (!before.arrangement || arrangementEdited(before, after)) return writeOut(after)
  const draft = structuredClone(after)
  const tracksBefore = new Map(before.tracks.map((t) => [t.id, t]))
  const startsBefore = sectionStarts(before.arrangement)
  const sectionsBefore = new Map(before.arrangement.map((s, i) => [s.id, { ...s, start: startsBefore[i] }]))
  const ranges = markedRanges(draft, before)

  // How many sections play each part, to know which parts are shared.
  const uses = new Map<string, number>()
  for (const range of ranges) {
    for (const id of Object.values(sectionsBefore.get(range.id ?? '')?.parts ?? {})) uses.set(id, (uses.get(id) ?? 0) + 1)
  }

  const arrangement = ranges.map((range): ArrangementSection => {
    const old = range.id ? sectionsBefore.get(range.id) : undefined
    const length = range.end - range.start
    const section: ArrangementSection = { id: old?.id ?? newId(), name: range.name, length, parts: {} }
    for (const track of draft.tracks) {
      const bars = track.bars.slice(range.start, range.end)
      const trackBefore = tracksBefore.get(track.id)
      const part = track.parts?.find((p) => p.id === old?.parts[track.id])
      if (old && trackBefore && old.length === length) {
        // Same bars as before the edit: the changed ones go into the part.
        const previous = trackBefore.bars.slice(old.start, old.start + length)
        if (part) {
          bars.forEach((bar, i) => {
            if (!sameBar(bar, previous[i])) part.bars[i % part.bars.length] = structuredClone(bar)
          })
          section.parts[track.id] = part.id
        } else if (hasNotes(bars)) {
          section.parts[track.id] = addPart(track, range.name, bars).id
        }
      } else if (part && (uses.get(part.id) ?? 0) > 1) {
        section.parts[track.id] = addPart(track, part.name, bars).id
      } else if (part) {
        part.bars = structuredClone(bars)
        section.parts[track.id] = part.id
      } else if (hasNotes(bars)) {
        section.parts[track.id] = addPart(track, range.name, bars).id
      }
    }
    return section
  })

  // Parts that no section plays any more are kept, to be picked again in the arrangement.
  return writeOut({ ...draft, arrangement })
}

/** Where a part starts playing in a track, for labels over the score. */
export interface PartStart {
  track: number
  bar: number
  name: string
  /** How many sections play this part. */
  uses: number
  /** The section is named like the part. */
  sameName: boolean
}

export function partStarts(song: Song): PartStart[] {
  const arrangement = song.arrangement
  if (!arrangement) return []
  const starts = sectionStarts(arrangement)
  return song.tracks.flatMap((track, t) => {
    const uses = new Map<string, number>()
    for (const section of arrangement) {
      const id = section.parts[track.id]
      if (id) uses.set(id, (uses.get(id) ?? 0) + 1)
    }
    return arrangement.flatMap((section, i) => {
      const part = track.parts?.find((p) => p.id === section.parts[track.id])
      return part ? [{ track: t, bar: starts[i], name: part.name, uses: uses.get(part.id) ?? 1, sameName: part.name === section.name }] : []
    })
  })
}

/** The sections that play each part of a track, by part id. */
export function partUses(song: Song, track: Track): Map<string, ArrangementSection[]> {
  const uses = new Map<string, ArrangementSection[]>()
  for (const section of song.arrangement ?? []) {
    const id = section.parts[track.id]
    if (id) uses.set(id, [...(uses.get(id) ?? []), section])
  }
  return uses
}

/** Parts that no section plays, per track index. */
export function unusedParts(song: Song): { track: number; part: Part }[] {
  return song.tracks.flatMap((track, t) => {
    const uses = partUses(song, track)
    return (track.parts ?? []).filter((p) => !uses.has(p.id)).map((part) => ({ track: t, part }))
  })
}

// ---------------------------------------------------------------- arrangement edits

/** Longest a section can be made in the arrangement. */
export const MAX_SECTION_BARS = 256

/**
 * Changes the arrangement of a copy of the song and writes it out again. The
 * change returns the id of the section to put the cursor on (at its first bar),
 * nothing to leave the cursor where it is, or false when there is nothing to change.
 */
function arrangementEdit(song: Song, cursor: Cursor, change: (draft: Song, sections: ArrangementSection[]) => string | false | void): EditResult | null {
  if (!song.arrangement) return null
  const draft = structuredClone(song)
  const target = change(draft, draft.arrangement!)
  if (target === false) return null
  const written = writeOut(draft)
  const index = target ? draft.arrangement!.findIndex((s) => s.id === target) : -1
  const next = index < 0 ? cursor : { ...cursor, bar: sectionStarts(draft.arrangement!)[index], beat: 0 }
  return { song: written, cursor: clampCursor(written, next) }
}

/** What a track plays in a section: one of its parts, or nothing (null). */
export function setCellPart(song: Song, cursor: Cursor, sectionId: string, trackId: string, partId: string | null): EditResult | null {
  return arrangementEdit(song, cursor, (draft, sections) => {
    const section = sections.find((s) => s.id === sectionId)
    const track = draft.tracks.find((t) => t.id === trackId)
    if (!section || !track || (section.parts[trackId] ?? null) === partId) return false
    if (partId === null) delete section.parts[trackId]
    else if (track.parts?.some((p) => p.id === partId)) section.parts[trackId] = partId
    else return false
  })
}

/** The section plays its own copy of its part ("Theme A 2"), to change it there only. */
export function copyCellPart(song: Song, cursor: Cursor, sectionId: string, trackId: string): EditResult | null {
  return arrangementEdit(song, cursor, (draft, sections) => {
    const section = sections.find((s) => s.id === sectionId)
    const track = draft.tracks.find((t) => t.id === trackId)
    const part = track?.parts?.find((p) => p.id === section?.parts[trackId])
    if (!section || !track || !part) return false
    section.parts[trackId] = addPart(track, part.name, part.bars).id
  })
}

export function renamePart(song: Song, cursor: Cursor, trackId: string, partId: string, name: string): EditResult | null {
  return arrangementEdit(song, cursor, (draft) => {
    const part = draft.tracks.find((t) => t.id === trackId)?.parts?.find((p) => p.id === partId)
    if (!part || part.name === name) return false
    part.name = name
  })
}

export function renameSection(song: Song, cursor: Cursor, sectionId: string, name: string): EditResult | null {
  return arrangementEdit(song, cursor, (_, sections) => {
    const section = sections.find((s) => s.id === sectionId)
    if (!section || section.name === name) return false
    section.name = name
  })
}

/** A section's length in bars. Its parts stay as they are: a shorter part repeats, a longer one is cut off. */
export function resizeSection(song: Song, cursor: Cursor, sectionId: string, length: number): EditResult | null {
  if (!Number.isInteger(length) || length < 1 || length > MAX_SECTION_BARS) return null
  return arrangementEdit(song, cursor, (_, sections) => {
    const section = sections.find((s) => s.id === sectionId)
    if (!section || section.length === length) return false
    section.length = length
    return section.id
  })
}

/** An empty section at the end of the song. */
export function addSection(song: Song, cursor: Cursor, length = 4): EditResult | null {
  return arrangementEdit(song, cursor, (draft, sections) => {
    const section: ArrangementSection = { id: newId(), name: nextSectionName(draft), length, parts: {} }
    sections.push(section)
    return section.id
  })
}

/** A copy of a section right after it, playing the same parts: a repeat. */
export function duplicateSection(song: Song, cursor: Cursor, sectionId: string): EditResult | null {
  return arrangementEdit(song, cursor, (_, sections) => {
    const index = sections.findIndex((s) => s.id === sectionId)
    if (index < 0) return false
    const copy = { ...structuredClone(sections[index]), id: newId() }
    sections.splice(index + 1, 0, copy)
    return copy.id
  })
}

/** Removes a section from the song; its parts stay, to be picked again. The last section can't be removed. */
export function removeSection(song: Song, cursor: Cursor, sectionId: string): EditResult | null {
  return arrangementEdit(song, cursor, (_, sections) => {
    const index = sections.findIndex((s) => s.id === sectionId)
    if (index < 0 || sections.length <= 1) return false
    sections.splice(index, 1)
    return sections[Math.min(index, sections.length - 1)].id
  })
}

/** Moves a section one place earlier (-1) or later (1). */
export function moveSection(song: Song, cursor: Cursor, sectionId: string, delta: -1 | 1): EditResult | null {
  return arrangementEdit(song, cursor, (_, sections) => {
    const index = sections.findIndex((s) => s.id === sectionId)
    const to = index + delta
    if (index < 0 || to < 0 || to >= sections.length) return false
    ;[sections[index], sections[to]] = [sections[to], sections[index]]
    return sectionId
  })
}

export function deleteUnusedParts(song: Song, cursor: Cursor): EditResult | null {
  return arrangementEdit(song, cursor, (draft) => {
    if (unusedParts(draft).length === 0) return false
    for (const track of draft.tracks) {
      const uses = partUses(draft, track)
      track.parts = (track.parts ?? []).filter((p) => uses.has(p.id))
    }
  })
}
