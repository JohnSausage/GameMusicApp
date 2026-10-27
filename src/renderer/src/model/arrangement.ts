// The song form: the song is a row of sections, and in each section every track
// plays one of its parts, or nothing. Parts are reused, so a change to "Theme A"
// changes every place it plays.
//
// The rest of the app (score, playback, export and every edit) works on the song
// written out bar by bar: track.bars and song.sections. writeOut() builds it from
// the arrangement, and syncArrangement() runs after every edit to write changed
// bars back into their parts, so the two never drift apart.
import { emptyBar, nextSectionName, sectionRanges } from './edit'
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

  // Parts that no section plays any more are dropped.
  for (const track of draft.tracks) {
    const used = new Set(arrangement.map((s) => s.parts[track.id]))
    track.parts = (track.parts ?? []).filter((p) => used.has(p.id))
  }
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
