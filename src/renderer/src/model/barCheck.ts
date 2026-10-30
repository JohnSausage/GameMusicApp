// Bar validation (REQUIREMENTS.md EDIT-07). Editing keeps every bar exactly
// full, but a project file written elsewhere (or by hand) can have bars that are
// too short or too long. They are marked in the score and can be fitted: a short
// bar is filled up with rests, a long one loses what goes past its end.
import { sectionStarts, writeOut } from './arrangement'
import { barTicks, beatTicks, edit, restsFor, type Cursor, type EditResult } from './edit'
import type { Bar, Song } from './song'
import { fitBar, holds } from './timeSignature'

/** How long a bar's beats are together, in ticks. */
export const barLength = (bar: Bar): number => bar.beats.reduce((sum, beat) => sum + beatTicks(beat), 0)

export interface WrongBar {
  track: number
  bar: number
  /** Ticks the bar has, and the ticks its time signature asks for. */
  length: number
  expected: number
}

/** The bars of every track that are too short or too long. */
export function wrongBars(song: Song): WrongBar[] {
  const expected = barTicks(song)
  return song.tracks.flatMap((track, t) =>
    track.bars.flatMap((bar, b) => {
      const length = barLength(bar)
      return length === expected ? [] : [{ track: t, bar: b, length, expected }]
    })
  )
}

/** A length in note values, e.g. "1/8" or "1/4 + 1/16". */
export function lengthName(ticks: number): string {
  return restsFor(ticks)
    .map((beat) => `${beat.dotted ? 'dotted ' : ''}1/${beat.value}${beat.triplet ? ' triplet' : ''}`)
    .join(' + ')
}

/** "is 1/8 too short", "is 1/4 too long". */
export const wrongBy = ({ length, expected }: Pick<WrongBar, 'length' | 'expected'>): string =>
  `is ${lengthName(Math.abs(expected - length))} too ${length < expected ? 'short' : 'long'}`

export interface FittedBars {
  result: EditResult
  /** Bars fitted (in an arranged song: bars of parts). */
  fitted: number
  /** Notes that started after the end of their bar, left out. */
  removed: number
  /** Notes cut short at the end of their bar. */
  shortened: number
}

/**
 * Fits the wrong bars, or only `only`: a short bar ends with rests, a long one
 * loses what goes past its end. In an arranged song the parts are fitted, so a
 * part fits wherever it plays. Null if no bar needs it.
 */
export function fitBars(song: Song, cursor: Cursor, only?: { track: number; bar: number }): FittedBars | null {
  const wrong = wrongBars(song).filter((w) => !only || (w.track === only.track && w.bar === only.bar))
  if (wrong.length === 0) return null
  const counts = { removed: 0, shortened: 0 }
  let fitted = 0
  const result = edit(song, cursor, (draft) => {
    const arrangement = draft.arrangement
    if (!arrangement) {
      for (const w of wrong) {
        const track = draft.tracks[w.track]
        track.bars[w.bar] = fitBar(track.bars[w.bar], w.expected, holds(track), counts)
      }
      fitted = wrong.length
    } else {
      // The part bars that play at the wrong bars, each once.
      const starts = sectionStarts(arrangement)
      const done = new Set<string>()
      for (const w of wrong) {
        const s = starts.findLastIndex((start) => start <= w.bar)
        const track = draft.tracks[w.track]
        const part = track.parts?.find((p) => p.id === arrangement[s]?.parts[track.id])
        if (!part) continue
        const index = (w.bar - starts[s]) % part.bars.length
        const key = `${part.id}:${index}`
        if (done.has(key)) continue
        done.add(key)
        part.bars[index] = fitBar(part.bars[index], w.expected, holds(track), counts)
        fitted++
      }
      Object.assign(draft, writeOut(draft))
    }
  })
  return result && { result, fitted, ...counts }
}
