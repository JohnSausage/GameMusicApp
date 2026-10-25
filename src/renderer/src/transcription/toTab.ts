import { GM_ACOUSTIC_GUITAR_STEEL, type Bar, type Beat, type NoteValue, type Song } from '../model/song'
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
  tempo: number
  /** Seconds into the take where bar 1, beat 1 starts. */
  firstDownbeat: number
  /** Grid steps per quarter note: 2 = eighths, 4 = sixteenths. */
  stepsPerQuarter: number
  beatsPerBar: number
  tuning: number[]
  title: string
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
 * Turns detected notes into a one-track song: quantize to the grid, choose frets,
 * fill gaps with rests. Spike simplification: notes that cross a bar line or need
 * a tie are shortened (ties come with the real editor in M2).
 */
export function notesToSong(notes: DetectedNote[], o: QuantizeOptions): Song {
  const secondsPerStep = 60 / o.tempo / o.stepsPerQuarter
  const stepsPerBar = o.beatsPerBar * o.stepsPerQuarter

  const placed: { step: number; length: number; pitch: number }[] = []
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    const step = Math.round((note.start - o.firstDownbeat) / secondsPerStep)
    if (step < 0 || placed.some((p) => p.step === step)) continue
    placed.push({ step, length: Math.max(1, Math.round(note.duration / secondsPerStep)), pitch: note.pitch })
  }
  placed.forEach((p, i) => {
    const next = placed[i + 1]
    if (next) p.length = Math.min(p.length, next.step - p.step)
  })

  const frets = assignFrets(placed.map((p) => p.pitch), o.tuning)
  const lastStep = placed.reduce((end, p) => Math.max(end, p.step + p.length), 0)
  const barCount = Math.max(1, Math.ceil(lastStep / stepsPerBar))
  const bars: Bar[] = Array.from({ length: barCount }, () => ({ beats: [] }))

  const pushSpan = (fromStep: number, steps: number, fret: { string: number; fret: number } | null): void => {
    const bar = bars[Math.floor(fromStep / stepsPerBar)]
    splitIntoValues(steps, o.stepsPerQuarter).forEach((part, index) => {
      const beat: Beat = { value: part.value, dotted: part.dotted, notes: [] }
      if (index === 0 && fret) beat.notes.push({ ...fret, velocity: 96 })
      bar.beats.push(beat)
    })
  }

  let cursor = 0
  placed.forEach((p, i) => {
    const fret = frets[i]
    for (const [from, to, isNote] of [[cursor, p.step, false], [p.step, p.step + p.length, true]] as const) {
      let position = from
      while (position < to) {
        const barEnd = (Math.floor(position / stepsPerBar) + 1) * stepsPerBar
        const end = Math.min(to, barEnd)
        pushSpan(position, end - position, isNote && position === p.step ? fret : null)
        position = end
      }
    }
    cursor = p.step + p.length
  })
  if (cursor < barCount * stepsPerBar) {
    let position = cursor
    while (position < barCount * stepsPerBar) {
      const end = (Math.floor(position / stepsPerBar) + 1) * stepsPerBar
      pushSpan(position, end - position, null)
      position = end
    }
  }

  return {
    title: o.title,
    tempo: o.tempo,
    timeSignature: [o.beatsPerBar, 4],
    sections: [],
    tracks: [
      {
        id: 'transcription',
        name: 'Transcription',
        tuning: o.tuning,
        instrument: { kind: 'soundfont', program: GM_ACOUSTIC_GUITAR_STEEL },
        volume: 0.9,
        pan: 0,
        bars
      }
    ]
  }
}
