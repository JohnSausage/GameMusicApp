export interface DetectedNote {
  /** Seconds from the start of the take. */
  start: number
  duration: number
  /** MIDI note number. */
  pitch: number
  /** 0–1, relative loudness / model confidence. */
  amplitude: number
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export function noteName(pitch: number): string {
  return `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

/** Parses "E4 F#4 Bb3 64" into MIDI numbers. Throws on unknown tokens. */
export function parseNoteList(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((token) => {
      if (/^\d+$/.test(token)) return Number(token)
      const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(token)
      if (!match) throw new Error(`Unknown note "${token}"`)
      const [, letter, accidental, octave] = match
      const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
      return (Number(octave) + 1) * 12 + SEMITONES[letter.toUpperCase()] + shift
    })
}

const CHORD_WINDOW = 0.05

function isOvertoneOf(high: DetectedNote, low: DetectedNote): boolean {
  const interval = high.pitch - low.pitch
  return interval === 12 || interval === 19 || interval === 24
}

/**
 * Single-note mode (REQUIREMENTS.md TRN-03): at most one note at a time.
 * Notes starting together keep the fundamental over overtones, otherwise the
 * louder note; a new note cuts off the previous one.
 */
export function toSingleNotes(notes: DetectedNote[]): DetectedNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  const result: DetectedNote[] = []
  for (const note of sorted) {
    const previous = result[result.length - 1]
    if (!previous || note.start >= previous.start + previous.duration) {
      result.push({ ...note })
      continue
    }
    if (note.start - previous.start < CHORD_WINDOW) {
      const [low, high] = previous.pitch < note.pitch ? [previous, note] : [note, previous]
      const keep = isOvertoneOf(high, low) && low.amplitude >= 0.3 * high.amplitude ? low : previous.amplitude >= note.amplitude ? previous : note
      result[result.length - 1] = { ...keep }
    } else {
      previous.duration = note.start - previous.start
      result.push({ ...note })
    }
  }
  return result
}
