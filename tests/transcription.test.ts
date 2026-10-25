import { describe, expect, it } from 'vitest'
import { GUITAR_STANDARD } from '../src/renderer/src/model/song'
import { buildTimeline } from '../src/renderer/src/model/timing'
import { comparePitchSequences } from '../src/renderer/src/transcription/compare'
import { noteName, parseNoteList, toSingleNotes, type DetectedNote } from '../src/renderer/src/transcription/notes'
import { trackNotes } from '../src/renderer/src/transcription/pitchTracker'
import { assignFrets, notesToSong } from '../src/renderer/src/transcription/toTab'

const SAMPLE_RATE = 44100

/** Plucked-string-like test signal: decaying harmonics, one note after another. */
function synthesize(notes: { pitch: number; start: number; duration: number }[], totalSeconds: number): Float32Array {
  const samples = new Float32Array(Math.ceil(totalSeconds * SAMPLE_RATE))
  for (const note of notes) {
    const frequency = 440 * 2 ** ((note.pitch - 69) / 12)
    const from = Math.round(note.start * SAMPLE_RATE)
    const to = Math.min(samples.length, Math.round((note.start + note.duration) * SAMPLE_RATE))
    for (let i = from; i < to; i++) {
      const t = (i - from) / SAMPLE_RATE
      const envelope = Math.exp(-3 * t) * Math.min(1, t / 0.003)
      let value = 0
      for (let h = 1; h <= 4; h++) value += Math.sin(2 * Math.PI * frequency * h * t) / h
      samples[i] += 0.3 * envelope * value
    }
  }
  return samples
}

describe('note names', () => {
  it('converts between names and MIDI numbers', () => {
    expect(noteName(64)).toBe('E4')
    expect(noteName(66)).toBe('F#4')
    expect(parseNoteList('E4 F#4 Bb3, 40 c5')).toEqual([64, 66, 58, 40, 72])
  })

  it('rejects unknown tokens', () => {
    expect(() => parseNoteList('E4 H2')).toThrow('Unknown note "H2"')
  })
})

describe('comparePitchSequences', () => {
  it('counts correct, wrong, octave, missed and extra notes', () => {
    const result = comparePitchSequences([60, 62, 64, 65, 67], [60, 74, 64, 67, 69])
    expect(result).toMatchObject({ correct: 3, substitutions: 1, octaveErrors: 1, missed: 1, extra: 1 })
    expect(result.accuracy).toBeCloseTo(0.6)
  })

  it('gives 100 % for identical sequences', () => {
    expect(comparePitchSequences([60, 60, 62], [60, 60, 62]).accuracy).toBe(1)
  })
})

describe('toSingleNotes', () => {
  const note = (pitch: number, start: number, duration: number, amplitude = 0.8): DetectedNote => ({ pitch, start, duration, amplitude })

  it('keeps the fundamental when an overtone starts at the same time', () => {
    expect(toSingleNotes([note(64, 0, 0.5, 0.9), note(52, 0.01, 0.5, 0.5)]).map((n) => n.pitch)).toEqual([52])
  })

  it('keeps the louder note for non-harmonic simultaneous notes', () => {
    expect(toSingleNotes([note(60, 0, 0.5, 0.4), note(62, 0.01, 0.5, 0.9)]).map((n) => n.pitch)).toEqual([62])
  })

  it('cuts a ringing note off when the next one starts', () => {
    const result = toSingleNotes([note(60, 0, 1), note(62, 0.5, 0.5)])
    expect(result.map((n) => [n.pitch, n.duration])).toEqual([[60, 0.5], [62, 0.5]])
  })
})

describe('trackNotes (pitch tracker)', () => {
  it('detects a melody of plucked notes', () => {
    const melody = [57, 59, 62, 64, 67, 66, 64, 62].map((pitch, i) => ({ pitch, start: 0.1 + i * 0.25, duration: 0.25 }))
    const detected = trackNotes(synthesize(melody, 2.4), SAMPLE_RATE)
    expect(detected.map((n) => n.pitch)).toEqual(melody.map((n) => n.pitch))
    detected.forEach((n, i) => expect(Math.abs(n.start - melody[i].start)).toBeLessThan(0.03))
  })

  it('separates repeated notes of the same pitch', () => {
    const melody = [0, 0.3, 0.6].map((start) => ({ pitch: 60, start: 0.1 + start, duration: 0.3 }))
    expect(trackNotes(synthesize(melody, 1.2), SAMPLE_RATE).map((n) => n.pitch)).toEqual([60, 60, 60])
  })

  it('ignores silence', () => {
    expect(trackNotes(new Float32Array(SAMPLE_RATE), SAMPLE_RATE)).toEqual([])
  })
})

describe('assignFrets', () => {
  it('stays in one position instead of jumping around', () => {
    // A3 B3 D4 E4 G4: playable around the open position
    const result = assignFrets([57, 59, 62, 64, 67], GUITAR_STANDARD)
    expect(result).toEqual([
      { string: 3, fret: 2 },
      { string: 2, fret: 0 },
      { string: 2, fret: 3 },
      { string: 1, fret: 0 },
      { string: 1, fret: 3 }
    ])
  })

  it('prefers the requested fret region', () => {
    const result = assignFrets([69, 71, 72], GUITAR_STANDARD, { preferredFret: 9 })
    expect(result.every((p) => p !== null && p.fret >= 5)).toBe(true)
  })

  it('returns null for pitches the guitar cannot play', () => {
    expect(assignFrets([30, 64], GUITAR_STANDARD)).toEqual([null, { string: 1, fret: 0 }])
  })
})

describe('notesToSong', () => {
  const base = { tempo: 120, firstDownbeat: 0.5, stepsPerQuarter: 4, beatsPerBar: 4, tuning: GUITAR_STANDARD, title: 'Test' }

  it('quantizes slightly early/late notes onto the grid and fills bars', () => {
    const notes: DetectedNote[] = [
      { pitch: 64, start: 0.52, duration: 0.45, amplitude: 1 }, // beat 1, quarter
      { pitch: 67, start: 0.98, duration: 0.24, amplitude: 1 }, // beat 2, eighth
      { pitch: 69, start: 1.76, duration: 0.5, amplitude: 1 } // halfway through beat 3, quarter
    ]
    const song = notesToSong(notes, base)
    expect(song.tracks).toHaveLength(1)
    const timeline = buildTimeline(song)
    expect(timeline.duration).toBeCloseTo(2) // exactly one 4/4 bar at 120 BPM
    expect(timeline.notes.map((n) => [n.pitch, n.start])).toEqual([
      [64, 0],
      [67, 0.5],
      [69, 1.25]
    ])
  })

  it('ignores notes before the first downbeat', () => {
    const song = notesToSong([{ pitch: 64, start: 0.1, duration: 0.2, amplitude: 1 }], base)
    expect(buildTimeline(song).notes).toHaveLength(0)
  })
})
