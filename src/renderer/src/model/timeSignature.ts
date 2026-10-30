// Changing the song's time signature (REQUIREMENTS.md PRJ-03). When bars get
// another length, the music is laid out again, in one of two ways: the bar
// lines move and every note keeps its place in time ('flow'), or every bar keeps
// its notes from its start and gets longer or shorter at its end ('bars').
import { barsFromSpans, barSpans, barTicks, edit, emptyBar, type Cursor, type EditResult, type Span } from './edit'
import { newId, type Bar, type Part, type Song, type Track } from './song'
import { writeOut } from './arrangement'

/** The time signatures offered, by kind: simple (quarters, halves), then in eighths. */
export const TIME_SIGNATURES: [number, number][] = [
  [2, 4],
  [3, 4],
  [4, 4],
  [5, 4],
  [2, 2],
  [3, 8],
  [6, 8],
  [7, 8],
  [9, 8],
  [12, 8]
]

/** How the music is laid out in bars of another length. */
export type Rebar = 'flow' | 'bars'

export interface TimeSignatureChange {
  result: EditResult
  /** 'bars': notes that start after the end of their shorter bar, left out. */
  removed: number
  /** 'bars': notes cut short at the end of their shorter bar. */
  shortened: number
  /** 'flow': sections whose music doesn't fill whole bars any more; their last bar ends with rests. */
  padded: number
  /** 'flow': parts copied for a section they repeat in, as the repeats no longer fit its bars. */
  copied: number
}

const ticksOf = (timeSignature: [number, number]): number => barTicks({ timeSignature } as Song)

/** Whether `ties` hold notes over a bar line: not for drum hits, which don't ring on. */
const holds = (track: Track): boolean => track.kind !== 'drums'

/** Bars of music laid out again in bars of `to` ticks (they were `from` ticks), every note at the same time. */
export function flowBars(bars: Bar[], from: number, to: number, ties: boolean): Bar[] {
  return barsFromSpans(barSpans(bars), to, Math.max(1, Math.ceil((bars.length * from) / to)), ties)
}

/** One bar made `to` ticks long: its notes stay from its start; longer, it ends with rests; shorter, what doesn't fit goes. */
function fitBar(bar: Bar, to: number, ties: boolean, counts: { removed: number; shortened: number }): Bar {
  const spans: Span[] = []
  for (const span of barSpans([bar])) {
    if (span.start >= to) counts.removed += span.notes.length
    else {
      if (span.start + span.length > to) counts.shortened += span.notes.length
      spans.push({ ...span, length: Math.min(span.length, to - span.start) })
    }
  }
  // Rests at the end are filled in again, joined with the new time.
  while (spans.length > 0 && spans[spans.length - 1].notes.length === 0) spans.pop()
  return barsFromSpans(spans, to, 1, ties)[0]
}

const sameBars = (a: Bar[], b: Bar[]): boolean => JSON.stringify(a) === JSON.stringify(b)

/** `bars` repeated (or cut off) to `length` bars, as a part plays in a section. */
const tile = (bars: Bar[], length: number): Bar[] => Array.from({ length }, (_, i) => structuredClone(bars[i % bars.length]))

/**
 * Gives the song another time signature; null if it has it already. Bars of
 * the same length (4/4 and 2/2, 3/4 and 6/8) keep their notes as they are.
 * In an arranged song, parts and sections change with the bars; in 'flow' a
 * section gets as many bars as its music needs now.
 */
export function changeTimeSignature(song: Song, cursor: Cursor, timeSignature: [number, number], rebar: Rebar): TimeSignatureChange | null {
  if (song.timeSignature[0] === timeSignature[0] && song.timeSignature[1] === timeSignature[1]) return null
  const from = barTicks(song)
  const to = ticksOf(timeSignature)
  const counts = { removed: 0, shortened: 0, padded: 0, copied: 0 }
  const uncounted = { removed: 0, shortened: 0 }
  const result = edit(song, cursor, (draft) => {
    draft.timeSignature = [timeSignature[0], timeSignature[1]]
    if (from === to) return
    const arranged = draft.arrangement !== undefined
    if (rebar === 'bars') {
      for (const track of draft.tracks) {
        // In an arranged song the parts hold the music (a part that repeats is in the bars more than once): count them.
        track.bars = track.bars.map((bar) => fitBar(bar, to, holds(track), arranged ? uncounted : counts))
        for (const part of track.parts ?? []) part.bars = part.bars.map((bar) => fitBar(bar, to, holds(track), counts))
      }
      return
    }
    if (!draft.arrangement) {
      // Without an arrangement: each track flows on, and a section starts at the bar where its music now starts.
      for (const track of draft.tracks) track.bars = flowBars(track.bars, from, to, holds(track))
      const count = Math.max(...draft.tracks.map((t) => t.bars.length))
      for (const track of draft.tracks) while (track.bars.length < count) track.bars.push(emptyBar(draft))
      draft.sections = draft.sections.map((s) => ({ ...s, bar: Math.floor((s.bar * from) / to) })).filter((s, i, all) => all.findLastIndex((o) => o.bar === s.bar) === i)
      return
    }
    flowArrangement(song, draft, from, to, counts)
  })
  if (!result) return null
  return { result: { song: writeOut(result.song), cursor: result.cursor }, ...counts }
}

/**
 * 'flow' in an arranged song: every part flows into the new bars, and every
 * section gets the bars its music needs. Where a part repeats (or is cut off) in
 * a section and its new bars don't line up with the section's music any more,
 * the section gets its own copy, so it sounds as before.
 */
function flowArrangement(song: Song, draft: Song, from: number, to: number, counts: { padded: number; copied: number }): void {
  const arrangement = draft.arrangement!
  let start = 0
  const sections = arrangement.map((section) => {
    const at = { start, length: section.length }
    start += section.length
    return at
  })
  for (const [t, track] of draft.tracks.entries()) {
    const flowed = new Map((track.parts ?? []).map((part) => [part.id, flowBars(part.bars, from, to, holds(track))]))
    // Sections that need the same copy of a part share it.
    const copies = new Map<string, Part>()
    arrangement.forEach((section, i) => {
      const part = track.parts?.find((p) => p.id === section.parts[track.id])
      if (!part) return
      const length = Math.ceil((section.length * from) / to)
      // The section's music as it was (the part repeated or cut off), laid out in the new bars.
      const heard = flowBars(song.tracks[t].bars.slice(sections[i].start, sections[i].start + section.length), from, to, holds(track))
      if (sameBars(tile(flowed.get(part.id)!, length), heard)) return
      const key = `${part.id}:${JSON.stringify(heard)}`
      let copy = copies.get(key)
      if (!copy) {
        copy = { id: newId(), name: copyName(track, part.name), bars: heard, ...(part.color !== undefined && { color: part.color }) }
        track.parts!.push(copy)
        flowed.set(copy.id, heard)
        copies.set(key, copy)
        counts.copied++
      }
      section.parts[track.id] = copy.id
    })
    for (const part of track.parts ?? []) part.bars = flowed.get(part.id)!
  }
  for (const section of arrangement) {
    if ((section.length * from) % to !== 0) counts.padded++
    section.length = Math.ceil((section.length * from) / to)
  }
}

/** "Groove 2", "Groove 3"…: a name for a copy of a part that no other part of the track has. */
function copyName(track: Track, name: string): string {
  const taken = new Set((track.parts ?? []).map((p) => p.name))
  let n = 2
  while (taken.has(`${name} ${n}`)) n++
  return `${name} ${n}`
}
