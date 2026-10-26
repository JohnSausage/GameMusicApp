// Drum tracks (REQUIREMENTS.md DRUM-01…05). A drum track reuses the tab model:
// each kit piece is a "string" whose open note is its General MIDI drum number
// and every hit is fret 0, so timing, selection, copy/paste and playback work
// exactly like for guitar tracks.
import { barTicks, beatTicks, edit, restsFor, type Cursor, type EditResult } from './edit'
import { barCount, DRUM_TUNING, type Bar, type Note, type Song, type Track } from './song'

/** Hit strengths (DRUM-03), stored as note velocity. */
export const VELOCITY = { ghost: 50, normal: 96, accent: 120 } as const
export type HitStrength = keyof typeof VELOCITY

export function strengthOf(velocity: number): HitStrength {
  return velocity >= 110 ? 'accent' : velocity <= 64 ? 'ghost' : 'normal'
}

export function isDrumTrack(track: Track): boolean {
  return track.kind === 'drums'
}

/** Row (1-based "string") of a kit piece. */
export function pieceRow(note: number): number {
  return DRUM_TUNING.indexOf(note) + 1
}

/** Number of grid steps in a bar; `stepsPerQuarter` 2 = eighths, 4 = sixteenths, 8 = thirty-seconds. */
export function stepsInBar(song: Song, stepsPerQuarter: number): number {
  return Math.round((barTicks(song) / 960) * stepsPerQuarter)
}

/** Hits per grid step. A beat that doesn't start on a step is snapped to the step before it. */
export function barToSteps(bar: Bar, stepCount: number, ticksPerStep: number): Note[][] {
  const steps: Note[][] = Array.from({ length: stepCount }, () => [])
  let start = 0
  for (const beat of bar.beats) {
    const step = Math.min(stepCount - 1, Math.floor(start / ticksPerStep))
    steps[step].push(...beat.notes.filter((n) => !steps[step].some((m) => m.string === n.string)))
    start += beatTicks(beat)
  }
  return steps
}

/** Writes steps back as beats: each step with hits lasts until the next one, so notation stays readable. */
export function stepsToBar(steps: Note[][], ticksPerStep: number): Bar {
  const beats: Bar['beats'] = []
  let i = 0
  while (i < steps.length) {
    let j = i + 1
    while (j < steps.length && steps[j].length === 0) j++
    const parts = restsFor((j - i) * ticksPerStep)
    if (steps[i].length > 0) parts[0].notes = steps[i].map((n) => ({ ...n }))
    beats.push(...parts)
    i = j
  }
  return { beats }
}

/**
 * Adds, changes or removes a hit on the grid (DRUM-01): clicking an empty cell adds a hit
 * with the given strength, clicking a hit with the same strength removes it.
 */
export function toggleHit(song: Song, cursor: Cursor, track: number, bar: number, step: number, row: number, strength: HitStrength, stepsPerQuarter: number): EditResult | null {
  const stepCount = stepsInBar(song, stepsPerQuarter)
  if (step < 0 || step >= stepCount) return null
  return edit(song, cursor, (draft) => {
    const ticksPerStep = barTicks(draft) / stepCount
    const steps = barToSteps(draft.tracks[track].bars[bar], stepCount, ticksPerStep)
    const existing = steps[step].find((n) => n.string === row)
    steps[step] = steps[step].filter((n) => n.string !== row)
    if (!existing || strengthOf(existing.velocity) !== strength) steps[step].push({ string: row, fret: 0, velocity: VELOCITY[strength] })
    steps[step].sort((a, b) => a.string - b.string)
    draft.tracks[track].bars[bar] = stepsToBar(steps, ticksPerStep)
    const beats = draft.tracks[track].bars[bar].beats
    let start = 0
    const beat = Math.max(0, beats.findIndex((b) => (start += beatTicks(b)) > step * ticksPerStep))
    return { track, bar, beat, string: row }
  })
}

/** Copies a bar of one track into the next `times` bars (DRUM-02), adding bars to the song if needed. */
export function repeatBar(song: Song, cursor: Cursor, track: number, bar: number, times: number): EditResult | null {
  if (times < 1) return null
  return edit(song, cursor, (draft) => {
    const needed = bar + times + 1 - barCount(draft)
    for (const t of draft.tracks) for (let i = 0; i < needed; i++) t.bars.push({ beats: restsFor(barTicks(draft)) })
    for (let i = 1; i <= times; i++) draft.tracks[track].bars[bar + i] = structuredClone(draft.tracks[track].bars[bar])
  })
}

export interface DrumPattern {
  name: string
  /** Per kit piece: a 16-character string for one 4/4 bar in 16ths ("x" hit, "X" accent, "g" ghost, "." nothing). */
  rows: Partial<Record<number, string>>
}

/** Starter patterns for 4/4 (DRUM-05). */
export const DRUM_PATTERNS: DrumPattern[] = [
  { name: 'Rock beat', rows: { 42: 'x.x.x.x.x.x.x.x.', 38: '....X.......X...', 36: 'x.......x.x.....' } },
  { name: 'Half-time', rows: { 42: 'x.x.x.x.x.x.x.x.', 38: '........X.......', 36: 'x.....x...x.....' } },
  { name: 'Four on the floor', rows: { 42: 'x...x...x...x...', 46: '..x...x...x...x.', 38: '....X.......X...', 36: 'x...x...x...x...' } },
  { name: 'Driving 16ths', rows: { 42: 'Xxxxxxxxxxxxxxxx', 38: '....X..g....X...', 36: 'x.x.....x.x.x...' } },
  { name: 'Chip march', rows: { 38: 'x.x.X.x.x.x.X.xx', 36: 'x.......x.......' } },
  { name: 'Fill', rows: { 38: 'x.x.x.x.........', 50: '........xx......', 47: '..........xx....', 45: '............xx..', 36: 'x...............', 49: '..............X.' } }
]

/** Replaces a bar of a drum track with a starter pattern. Only for bars with 16 sixteenth steps (4/4). */
export function applyPattern(song: Song, cursor: Cursor, track: number, bar: number, pattern: DrumPattern): EditResult | null {
  if (stepsInBar(song, 4) !== 16) return null
  const steps: Note[][] = Array.from({ length: 16 }, () => [])
  for (const [note, row] of Object.entries(pattern.rows)) {
    const string = pieceRow(Number(note))
    ;[...(row ?? '')].forEach((c, i) => {
      if (c === '.') return
      steps[i].push({ string, fret: 0, velocity: VELOCITY[c === 'X' ? 'accent' : c === 'g' ? 'ghost' : 'normal'] })
    })
  }
  steps.forEach((s) => s.sort((a, b) => a.string - b.string))
  return edit(song, cursor, (draft) => {
    draft.tracks[track].bars[bar] = stepsToBar(steps, barTicks(draft) / 16)
  })
}
