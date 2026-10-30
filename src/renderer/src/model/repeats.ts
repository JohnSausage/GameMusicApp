// Repeat signs and 1st/2nd endings (REQUIREMENTS.md EDIT-14). The song keeps
// its bars as written; playback, export and the timing functions walk them in
// the order they play (see playedBars), so a repeated bar plays more than once.
import { edit, type Cursor, type EditResult } from './edit'
import { barCount, type Repeat, type Song } from './song'

/** How often a repeat can play its bars, and the endings that can be numbered. */
export const MAX_TIMES = 8

/** The repeat signs at a bar, if it has any. */
export const repeatAt = (song: Pick<Song, 'repeats'>, bar: number): Repeat | undefined => song.repeats?.find((r) => r.bar === bar)

const isEmpty = (r: Repeat): boolean => !r.start && !r.times && !r.ending?.length

/**
 * Repeat signs as a song keeps them: in bar order, one per bar (signs on the
 * same bar join), without empty ones or ones past the last bar, endings sorted.
 */
export function cleanRepeats(repeats: Repeat[], bars: number): Repeat[] {
  const byBar = new Map<number, Repeat>()
  for (const r of repeats) {
    if (r.bar < 0 || r.bar >= bars) continue
    const joined = byBar.get(r.bar) ?? { bar: r.bar }
    if (r.start) joined.start = true
    if (r.times && r.times > 1) joined.times = Math.min(MAX_TIMES, Math.max(joined.times ?? 0, r.times))
    const ending = [...new Set([...(joined.ending ?? []), ...(r.ending ?? [])])].filter((n) => n >= 1 && n <= MAX_TIMES).sort((a, b) => a - b)
    if (ending.length > 0) joined.ending = ending
    else delete joined.ending
    byBar.set(r.bar, joined)
  }
  return [...byBar.values()].filter((r) => !isEmpty(r)).sort((a, b) => a.bar - b.bar)
}

/** Sets the song's repeat signs, or takes them away when there are none left. */
export function storeRepeats(song: Song, repeats: Repeat[]): void {
  const clean = cleanRepeats(repeats, barCount(song))
  if (clean.length > 0) song.repeats = clean
  else delete song.repeats
}

/**
 * The bars in the order they play: a repeat end goes back to its start (the
 * last start sign before it, else the bar after the last repeat, else the
 * song's start) until it has played its times; a bar of an ending plays only on
 * its times through. After the last sign, bar after bar for ever.
 */
export function* playedBars(repeats: Repeat[] | undefined): Generator<number> {
  const marks = new Map((repeats ?? []).map((r) => [r.bar, r]))
  const last = Math.max(-1, ...marks.keys())
  const played = new Map<number, number>()
  let start = 0
  let pass = 1
  let jumped = false
  // Repeats can't go back more often than this, also in a damaged file.
  let jumps = 0
  for (let bar = 0; ; ) {
    if (bar > last) {
      yield bar++
      continue
    }
    const mark = marks.get(bar)
    if (mark?.start && !jumped) {
      start = bar
      pass = 1
    }
    jumped = false
    if (mark?.ending && !mark.ending.includes(pass)) {
      bar++
      continue
    }
    yield bar
    if (mark?.times && jumps < 1000) {
      const times = played.get(bar) ?? 1
      if (times < mark.times) {
        played.set(bar, times + 1)
        pass = times + 1
        bar = start
        jumped = true
        jumps++
        continue
      }
      played.delete(bar)
      start = bar + 1
    }
    bar++
  }
}

/** The bars of a song in the order they play, up to its end. */
export function playOrder(song: Pick<Song, 'repeats'>, bars: number): number[] {
  const order: number[] = []
  for (const bar of playedBars(song.repeats)) {
    if (bar >= bars) break
    order.push(bar)
  }
  return order
}

/** Changes the repeat signs at a bar: `signs` replaces what it had (no signs take them away). */
export function setRepeat(song: Song, cursor: Cursor, bar: number, signs: Omit<Repeat, 'bar'>): EditResult | null {
  const before = repeatAt(song, bar)
  const next = cleanRepeats([{ ...signs, bar }], barCount(song))[0]
  if (JSON.stringify(before ?? null) === JSON.stringify(next ?? null)) return null
  return edit(song, cursor, (draft) => {
    storeRepeats(draft, [...(draft.repeats ?? []).filter((r) => r.bar !== bar), ...(next ? [next] : [])])
  })
}

/**
 * Repeat signs after a bar is inserted at `bar`: signs from there on move with
 * their bars, but a repeat starting at `bar` starts with the new bar, as a section does.
 */
export function insertBarRepeats(song: Song, bar: number): void {
  if (!song.repeats) return
  const moved = song.repeats.flatMap((r): Repeat[] => {
    if (r.bar < bar) return [r]
    if (r.bar > bar || !r.start) return [{ ...r, bar: r.bar + 1 }]
    const { start: _, ...rest } = r
    return [{ bar, start: true }, { ...rest, bar: bar + 1 }]
  })
  storeRepeats(song, moved)
}

/**
 * Repeat signs after the bar `bar` is deleted: a repeat that started there
 * starts at the next bar, one that ended there ends at the bar before.
 */
export function deleteBarRepeats(song: Song, bar: number): void {
  if (!song.repeats) return
  const moved = song.repeats.flatMap((r): Repeat[] => {
    if (r.bar !== bar) return [{ ...r, bar: r.bar > bar ? r.bar - 1 : r.bar }]
    return [...(r.start ? [{ bar, start: true }] : []), ...(r.times && bar > 0 ? [{ bar: bar - 1, times: r.times }] : [])]
  })
  storeRepeats(song, moved)
}

/** The play order as text for people, bars counted from 1: "1–4, 1–3, 5–8". */
export function orderText(order: number[]): string {
  const runs: [number, number][] = []
  for (const bar of order) {
    const run = runs.at(-1)
    if (run && bar === run[1] + 1) run[1] = bar
    else runs.push([bar, bar])
  }
  return runs.map(([from, to]) => (from === to ? `${from + 1}` : `${from + 1}–${to + 1}`)).join(', ')
}
