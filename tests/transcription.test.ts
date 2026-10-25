import { describe, expect, it } from 'vitest'
import { detectFirstOnset } from '../src/renderer/src/audio/analysis'
import { barTicks, beatTicks } from '../src/renderer/src/model/edit'
import { BASS_STANDARD, GUITAR_STANDARD, type Bar, type Song } from '../src/renderer/src/model/song'
import { buildTimeline } from '../src/renderer/src/model/timing'
import { noteName, toSingleNotes, type DetectedNote } from '../src/renderer/src/transcription/notes'
import { assignFrets, transcribeToBars, type QuantizeOptions } from '../src/renderer/src/transcription/toTab'

const note = (pitch: number, start: number, duration: number, amplitude = 0.8): DetectedNote => ({ pitch, start, duration, amplitude })

describe('noteName', () => {
  it('names MIDI notes', () => {
    expect(noteName(64)).toBe('E4')
    expect(noteName(66)).toBe('F#4')
    expect(noteName(40)).toBe('E2')
  })
})

describe('toSingleNotes', () => {
  it('keeps the fundamental when an overtone starts at the same time', () => {
    expect(toSingleNotes([note(64, 0, 0.5, 0.9), note(52, 0.01, 0.5, 0.5)]).map((n) => n.pitch)).toEqual([52])
  })

  it('keeps the louder note for non-harmonic simultaneous notes', () => {
    expect(toSingleNotes([note(60, 0, 0.5, 0.4), note(62, 0.01, 0.5, 0.9)]).map((n) => n.pitch)).toEqual([62])
  })

  it('cuts a ringing note off when the next one starts', () => {
    const result = toSingleNotes([note(60, 0, 1), note(62, 0.5, 0.5)])
    expect(result.map((n) => [n.pitch, n.duration])).toEqual([
      [60, 0.5],
      [62, 0.5]
    ])
  })
})

describe('detectFirstOnset', () => {
  it('finds where the sound starts after silence and quiet noise', () => {
    const rate = 8000
    const samples = new Float32Array(rate)
    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() - 0.5) * 0.002
    for (let i = 0.42 * rate; i < samples.length; i++) samples[i] = 0.5 * Math.sin(i / 3)
    expect(detectFirstOnset(samples, rate)).toBeCloseTo(0.42, 2)
  })

  it('returns 0 for silence', () => {
    expect(detectFirstOnset(new Float32Array(1000), 8000)).toBe(0)
  })
})

describe('assignFrets', () => {
  it('stays in one position instead of jumping around', () => {
    // A3 B3 D4 E4 G4: playable around the open position
    expect(assignFrets([57, 59, 62, 64, 67], GUITAR_STANDARD)).toEqual([
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

describe('transcribeToBars', () => {
  const base: QuantizeOptions = { tempo: 120, firstDownbeat: 0.5, stepsPerQuarter: 4, timeSignature: [4, 4], tuning: GUITAR_STANDARD, preferredFret: 3 }

  /** Notes of the bars as [pitch, start in seconds] at the given tempo. */
  const notesOf = (bars: Bar[], tuning: number[], tempo = 120, timeSignature: [number, number] = [4, 4]): number[][] => {
    const song: Song = { title: '', tempo, timeSignature, sections: [], takes: [], tracks: [{ id: 't', name: 't', tuning, instrument: { kind: 'soundfont', program: 25 }, volume: 1, pan: 0, bars }] }
    return buildTimeline(song).notes.map((n) => [n.pitch, n.start])
  }

  const expectFull = (bars: Bar[], timeSignature: [number, number]): void => {
    const song = { timeSignature } as Song
    for (const bar of bars) expect(bar.beats.reduce((sum, b) => sum + beatTicks(b), 0)).toBe(barTicks(song))
  }

  it('quantizes slightly early/late notes onto the grid and fills the bar', () => {
    const result = transcribeToBars([note(64, 0.52, 0.45), note(67, 0.98, 0.24), note(69, 1.76, 0.5)], base)
    expect(result.bars).toHaveLength(1)
    expect(result.noteCount).toBe(3)
    expect(notesOf(result.bars, GUITAR_STANDARD)).toEqual([
      [64, 0],
      [67, 0.5],
      [69, 1.25]
    ])
    expectFull(result.bars, [4, 4])
  })

  it('leaves out notes before beat 1 (e.g. during the count-in) and counts them', () => {
    const result = transcribeToBars([note(64, 0.1, 0.2), note(65, 0.5, 0.2)], base)
    expect(result.beforeStart).toBe(1)
    expect(notesOf(result.bars, GUITAR_STANDARD)).toEqual([[65, 0]])
  })

  it('counts notes the instrument cannot play', () => {
    const result = transcribeToBars([note(30, 0.5, 0.2), note(64, 1, 0.2)], { ...base, tuning: BASS_STANDARD })
    expect(result.dropped).toBe(1)
    expect(result.noteCount).toBe(1)
  })

  it('fills bars of 3/4 and 6/8', () => {
    for (const timeSignature of [
      [3, 4],
      [6, 8]
    ] as [number, number][]) {
      const result = transcribeToBars([note(64, 0.5, 0.2), note(67, 2.2, 0.3)], { ...base, timeSignature })
      expect(result.bars.length).toBe(2) // a bar is 1.5 s at 120 BPM in both
      expectFull(result.bars, timeSignature)
    }
  })

  it('uses the take tempo, so notes land on the right beats', () => {
    // At 90 BPM a quarter is 0.667 s: notes on beats 1, 2 and 4.
    const q = 60 / 90
    const result = transcribeToBars([note(60, 0, q), note(62, q, q), note(64, 3 * q, q)], { ...base, tempo: 90, firstDownbeat: 0 })
    expect(notesOf(result.bars, GUITAR_STANDARD).map(([pitch, start]) => [pitch, start])).toEqual([
      [60, 0],
      [62, 0.5],
      [64, 1.5]
    ])
  })

  it('shortens a note at a bar line instead of spilling into the next bar', () => {
    const result = transcribeToBars([note(64, 1.5, 1.5)], base) // beat 3 of bar 1, 3 beats long
    expect(result.bars).toHaveLength(2)
    expect(notesOf(result.bars, GUITAR_STANDARD)).toEqual([[64, 1]])
    expectFull(result.bars, [4, 4])
  })
})
