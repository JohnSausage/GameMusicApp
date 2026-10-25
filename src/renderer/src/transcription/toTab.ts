import type { Bar, Beat, NoteValue } from '../model/song'
import type { DetectedNote } from './notes'

export interface FretPosition {
  string: number
  fret: number
}

export interface FretOptions {
  maxFret: number
  /** Hand position the fingering should stay near (TRN-07). */
  preferredFret: number
}

const DEFAULT_FRET_OPTIONS: FretOptions = { maxFret: 20, preferredFret: 3 }

function candidates(pitch: number, tuning: number[], maxFret: number): FretPosition[] {
  const result: FretPosition[] = []
  tuning.forEach((open, index) => {
    const fret = pitch - open
    if (fret >= 0 && fret <= maxFret) result.push({ string: index + 1, fret })
  })
  return result
}

function positionCost(p: FretPosition, o: FretOptions): number {
  return p.fret === 0 ? 0 : 0.15 * Math.abs(p.fret - o.preferredFret)
}

function moveCost(a: FretPosition, b: FretPosition): number {
  // Open strings don't move the hand.
  const handMove = a.fret === 0 || b.fret === 0 ? 0.5 : Math.abs(a.fret - b.fret)
  return handMove + 0.2 * Math.abs(a.string - b.string)
}

/**
 * Chooses string and fret for a melody (TRN-06): Viterbi search over all
 * playable positions, minimizing hand movement. Unplayable pitches give null.
 */
export function assignFrets(pitches: number[], tuning: number[], options: Partial<FretOptions> = {}): (FretPosition | null)[] {
  const o = { ...DEFAULT_FRET_OPTIONS, ...options }
  const result: (FretPosition | null)[] = pitches.map(() => null)
  const playable = pitches.map((p, index) => ({ index, options: candidates(p, tuning, o.maxFret) })).filter((x) => x.options.length > 0)
  if (playable.length === 0) return result

  let costs = playable[0].options.map((p) => positionCost(p, o))
  const back: number[][] = [playable[0].options.map(() => -1)]
  for (let k = 1; k < playable.length; k++) {
    const previous = playable[k - 1].options
    const nextCosts: number[] = []
    const nextBack: number[] = []
    for (const position of playable[k].options) {
      let best = Infinity
      let bestIndex = 0
      previous.forEach((prev, i) => {
        const c = costs[i] + moveCost(prev, position)
        if (c < best) {
          best = c
          bestIndex = i
        }
      })
      nextCosts.push(best + positionCost(position, o))
      nextBack.push(bestIndex)
    }
    costs = nextCosts
    back.push(nextBack)
  }

  let choice = costs.indexOf(Math.min(...costs))
  for (let k = playable.length - 1; k >= 0; k--) {
    result[playable[k].index] = playable[k].options[choice]
    choice = back[k][choice]
  }
  return result
}

export interface QuantizeOptions {
  /** Tempo the take was played at, in quarter notes per minute. */
  tempo: number
  /** Seconds into the take where bar 1, beat 1 starts. */
  firstDownbeat: number
  /** Grid steps per quarter note: 2 = eighths, 4 = sixteenths. */
  stepsPerQuarter: number
  timeSignature: [number, number]
  tuning: number[]
  /** Hand position the fingering should stay near (TRN-07). */
  preferredFret: number
}

export interface Transcription {
  bars: Bar[]
  /** Notes placed into the bars. */
  noteCount: number
  /** Notes before beat 1 (e.g. noise during the count-in), not placed. */
  beforeStart: number
  /** Notes the guitar can't play in this tuning, or that landed on an occupied grid step. */
  dropped: number
}

/** Splits a length in grid steps into note values, largest first (dotted values allowed). */
function splitIntoValues(steps: number, stepsPerQuarter: number): { value: NoteValue; dotted: boolean; steps: number }[] {
  const values: NoteValue[] = [1, 2, 4, 8, 16, 32]
  const options = values
    .flatMap((value) => {
      const plain = (4 / value) * stepsPerQuarter
      return [
        { value, dotted: true, steps: plain * 1.5 },
        { value, dotted: false, steps: plain }
      ]
    })
    .filter((o) => Number.isInteger(o.steps) && o.steps >= 1)
    .sort((a, b) => b.steps - a.steps)
  const parts: { value: NoteValue; dotted: boolean; steps: number }[] = []
  let remaining = steps
  while (remaining > 0) {
    const option = options.find((o) => o.steps <= remaining)!
    parts.push(option)
    remaining -= option.steps
  }
  return parts
}

/**
 * Turns detected single notes into full bars of tab (TRN-05/06): quantize to
 * the grid, choose strings and frets, fill gaps with rests. Notes that would
 * cross a bar line are shortened to end at it (ties aren't in the model yet).
 */
export function transcribeToBars(notes: DetectedNote[], o: QuantizeOptions): Transcription {
  const [beats, unit] = o.timeSignature
  const secondsPerStep = 60 / o.tempo / o.stepsPerQuarter
  const stepsPerBar = beats * (4 / unit) * o.stepsPerQuarter

  let beforeStart = 0
  let dropped = 0
  const placed: { step: number; length: number; pitch: number }[] = []
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    const step = Math.round((note.start - o.firstDownbeat) / secondsPerStep)
    if (step < 0) beforeStart++
    else if (placed.some((p) => p.step === step)) dropped++
    else placed.push({ step, length: Math.max(1, Math.round(note.duration / secondsPerStep)), pitch: note.pitch })
  }
  placed.forEach((p, i) => {
    const next = placed[i + 1]
    if (next) p.length = Math.min(p.length, next.step - p.step)
  })

  const frets = assignFrets(placed.map((p) => p.pitch), o.tuning, { preferredFret: o.preferredFret })
  dropped += frets.filter((f) => f === null).length
  const lastStep = placed.reduce((end, p) => Math.max(end, p.step + p.length), 0)
  const barCount = Math.max(1, Math.ceil(lastStep / stepsPerBar))
  const bars: Bar[] = Array.from({ length: barCount }, () => ({ beats: [] }))

  /** Adds beats for [from, to), split at bar lines; only the very first beat gets the note. */
  const fill = (from: number, to: number, fret: FretPosition | null): void => {
    let position = from
    while (position < to) {
      const end = Math.min(to, (Math.floor(position / stepsPerBar) + 1) * stepsPerBar)
      const bar = bars[Math.floor(position / stepsPerBar)]
      splitIntoValues(end - position, o.stepsPerQuarter).forEach((part, index) => {
        const beat: Beat = { value: part.value, dotted: part.dotted, notes: [] }
        if (fret && position === from && index === 0) beat.notes.push({ ...fret, velocity: 96 })
        bar.beats.push(beat)
      })
      position = end
      if (fret) fret = null // the part after a bar line is a rest (no ties yet)
    }
  }

  let position = 0
  placed.forEach((p, i) => {
    fill(position, p.step, null)
    fill(p.step, p.step + p.length, frets[i])
    position = p.step + p.length
  })
  fill(position, barCount * stepsPerBar, null)

  return { bars, noteCount: frets.filter((f) => f !== null).length, beforeStart, dropped }
}
