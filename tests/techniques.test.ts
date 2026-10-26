import { Midi } from '@tonejs/midi'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { pitchWheelSteps, WHEEL_CENTER, wheelValue } from '../src/renderer/src/audio/bends'
import { songToMidi } from '../src/renderer/src/audio/midiExport'
import { ChipSynth } from '../src/renderer/src/audio/synth/chipSynthCore'
import { addTrack, createSong, setFret, type Cursor, type Duration } from '../src/renderer/src/model/edit'
import type { Song } from '../src/renderer/src/model/song'
import { DEFAULT_PATCH } from '../src/renderer/src/model/synth'
import { toggleLegato, toggleTie } from '../src/renderer/src/model/techniques'
import { buildTimeline } from '../src/renderer/src/model/timing'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'

const quarter: Duration = { value: 4, dotted: false }
const at = (bar: number, beat: number, string = 3): Cursor => ({ track: 0, bar, beat, string })

/** A guitar song (120 BPM, 4/4: quarters of 0.5 s) with quarter notes on string 3 (G3 = 55) at the given beats of bar 1. */
function song(frets: (number | null)[]): Song {
  let s = createSong({ title: 't', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 2 })
  frets.forEach((fret, beat) => {
    if (fret === null) s = setFret(s, at(0, beat), 0, quarter)!.song // placeholder to keep beats as quarters…
    else s = setFret(s, at(0, beat), fret, quarter)!.song
  })
  // …which is removed again where a rest is wanted.
  frets.forEach((fret, beat) => {
    if (fret === null) s.tracks[0].bars[0].beats[beat].notes = []
  })
  return s
}

const notesOf = (s: Song): { pitch: number; start: number; duration: number; bends?: unknown }[] =>
  buildTimeline(s).notes.map(({ pitch, start, duration, bends }) => ({ pitch, start, duration, ...(bends && { bends }) }))

describe('held notes (ties)', () => {
  it('hold the note before through the next beat, as one longer note', () => {
    let s = song([2, null, 4])
    s = toggleTie(s, at(0, 1), quarter)!.song
    expect(s.tracks[0].bars[0].beats[1].notes).toEqual([{ string: 3, fret: 2, velocity: 96, tie: true }])
    expect(notesOf(s)).toEqual([
      { pitch: 57, start: 0, duration: 1 },
      { pitch: 59, start: 1, duration: 0.5 }
    ])
  })

  it('work across a bar line, with the chosen length on a rest', () => {
    let s = song([null, null, null, 5])
    s = toggleTie(s, at(1, 0), quarter)!.song // bar 2 was a whole rest
    expect(s.tracks[0].bars[1].beats.map((b) => [b.value, b.dotted])).toEqual([
      [4, false],
      [2, true]
    ])
    expect(notesOf(s)).toEqual([{ pitch: 60, start: 1.5, duration: 1 }])
  })

  it('need a note on the same string right before, and can be undone', () => {
    const s = song([2, null, 4])
    expect(toggleTie(s, at(0, 2))).toBeNull() // the beat before is a rest
    expect(toggleTie(s, at(0, 0))).toBeNull() // nothing before the first beat
    const tied = toggleTie(song([2, 3]), at(0, 1))!.song
    expect(tied.tracks[0].bars[0].beats[1].notes[0]).toMatchObject({ fret: 2, tie: true }) // the other fret is replaced
    expect(toggleTie(tied, at(0, 1))!.song.tracks[0].bars[0].beats[1].notes[0].tie).toBeUndefined()
  })

  it('follow the fret of the note they hold', () => {
    let s = song([2, null, null])
    s = toggleTie(s, at(0, 1), quarter)!.song
    s = toggleTie(s, at(0, 2), quarter)!.song
    s = setFret(s, at(0, 0), 7, quarter)!.song
    expect(s.tracks[0].bars[0].beats.slice(0, 3).map((b) => b.notes[0].fret)).toEqual([7, 7, 7])
    expect(notesOf(s)).toEqual([{ pitch: 62, start: 0, duration: 1.5 }])
    s = setFret(s, at(0, 1), 9, quarter)!.song // typing a new fret plays it again
    expect(s.tracks[0].bars[0].beats[1].notes[0].tie).toBeUndefined()
    expect(s.tracks[0].bars[0].beats[2].notes[0].fret).toBe(9)
  })
})

describe('hammer-ons, pull-offs and slides', () => {
  it('change the pitch of the sounding note instead of playing the next one', () => {
    let s = song([5, 7, 5])
    s = toggleLegato(s, at(0, 0), 'hammer')!.song // hammer-on 5 → 7
    s = toggleLegato(s, at(0, 1), 'hammer')!.song // pull-off 7 → 5
    expect(notesOf(s)).toEqual([
      {
        pitch: 60,
        start: 0,
        duration: 1.5,
        bends: [
          { time: 0.5, pitch: 62, glide: 0 },
          { time: 1, pitch: 60, glide: 0 }
        ]
      }
    ])
  })

  it('slide in the end of the first note', () => {
    let s = song([2, 9])
    s = toggleLegato(s, at(0, 0), 'slide')!.song
    expect(notesOf(s)).toEqual([{ pitch: 57, start: 0, duration: 1, bends: [{ time: 0.25, pitch: 64, glide: 0.25 }] }])
  })

  it('need a note on another fret right after, and replace each other', () => {
    expect(toggleLegato(song([5, null, 7]), at(0, 0), 'hammer')).toBeNull() // rest in between
    expect(toggleLegato(song([5, 5]), at(0, 0), 'slide')).toBeNull() // same fret
    expect(toggleLegato(song([null, 5]), at(0, 0), 'slide')).toBeNull() // no note at the cursor
    let s = toggleLegato(song([5, 7]), at(0, 0), 'hammer')!.song
    s = toggleLegato(s, at(0, 0), 'slide')!.song
    expect(s.tracks[0].bars[0].beats[0].notes[0]).toMatchObject({ slide: true })
    expect(s.tracks[0].bars[0].beats[0].notes[0].hammer).toBeUndefined()
    s = setFret(s, at(0, 0), 3, quarter)!.song // a new fret keeps the slide
    expect(s.tracks[0].bars[0].beats[0].notes[0]).toMatchObject({ fret: 3, slide: true })
    expect(toggleLegato(s, at(0, 0), 'slide')!.song.tracks[0].bars[0].beats[0].notes[0].slide).toBeUndefined()
  })

  it('stay separate notes in MIDI export, while held notes are joined', () => {
    let s = song([5, 7, null, 2])
    s = toggleLegato(s, at(0, 0), 'hammer')!.song
    s = toggleTie(s, at(0, 2), quarter)!.song
    expect(buildTimeline(s, { legato: false }).notes.map((n) => [n.pitch, n.start, n.duration])).toEqual([
      [60, 0, 0.5],
      [62, 0.5, 1],
      [57, 1.5, 0.5]
    ])
    const midi = new Midi(songToMidi(s))
    expect(midi.tracks[0].notes.map((n) => n.midi)).toEqual([60, 62, 57])
  })

  it('are not used on drum tracks', () => {
    let s = addTrack(song([5, 7]), at(0, 0), 'drums').song
    s = setFret(s, { track: 1, bar: 0, beat: 0, string: 7 }, 0, quarter)!.song
    expect(toggleTie(s, { track: 1, bar: 0, beat: 1, string: 7 }, quarter)).toBeNull()
    expect(toggleLegato(s, { track: 1, bar: 0, beat: 0, string: 7 }, 'hammer')).toBeNull()
  })

  it('are saved with the project', () => {
    let s = toggleLegato(song([5, 7, null]), at(0, 0), 'slide')!.song
    s = toggleTie(s, at(0, 2), quarter)!.song
    expect(parseProject(serializeProject(s)).song).toEqual(s)
    const bad = structuredClone(s)
    ;(bad.tracks[0].bars[0].beats[0].notes[0] as { slide: unknown }).slide = 'yes'
    const json = { app: 'GameMusicApp', formatVersion: 3, song: bad }
    expect(() => parseProject(zipSync({ 'song.json': strToU8(JSON.stringify(json)) }))).toThrow('invalid techniques')
  })
})

describe('playing pitch changes', () => {
  it('moves the pitch wheel of SoundFont notes and resets it at the end', () => {
    expect([wheelValue(0), wheelValue(24), wheelValue(-24), wheelValue(30)]).toEqual([8192, 16383, 0, 16383])
    const hammer = pitchWheelSteps({ trackIndex: 0, pitch: 60, velocity: 96, start: 0, duration: 1, bends: [{ time: 0.5, pitch: 62, glide: 0 }] }, 0.9)
    expect(hammer).toEqual([
      { time: 0.5, value: wheelValue(2) },
      { time: 0.9, value: WHEEL_CENTER }
    ])
    const slide = pitchWheelSteps({ trackIndex: 0, pitch: 60, velocity: 96, start: 0, duration: 1, bends: [{ time: 0.3, pitch: 67, glide: 0.2 }] }, 0.9)
    expect(slide).toHaveLength(21)
    expect(slide[0].value).toBeGreaterThan(WHEEL_CENTER)
    expect(slide[19]).toEqual({ time: 0.5, value: wheelValue(7) })
    expect(pitchWheelSteps({ trackIndex: 0, pitch: 60, velocity: 96, start: 0, duration: 1 }, 1)).toEqual([])
  })

  it('bends a chip synth voice without playing it again', () => {
    const RATE = 48000
    const synth = new ChipSynth(RATE, { ...DEFAULT_PATCH, waveform: 'sine', attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.05 })
    synth.schedule({ frame: 0, type: 'on', pitch: 69, velocity: 127 }) // 440 Hz
    synth.schedule({ frame: 0.5 * RATE, type: 'bend', pitch: 69, velocity: 0, to: 81, glide: 0 }) // hammer-on an octave up
    synth.schedule({ frame: RATE, type: 'off', pitch: 69, velocity: 0 })
    const out = new Float32Array(RATE)
    for (let i = 0; i < out.length; i += 128) synth.render(out.subarray(i, i + 128), i)
    const crossings = (from: number, to: number): number => {
      let n = 0
      for (let i = Math.round(from * RATE) + 1; i < to * RATE; i++) if (out[i - 1] < 0 && out[i] >= 0) n++
      return n / (to - from)
    }
    expect(crossings(0.2, 0.45)).toBeCloseTo(440, -1)
    expect(crossings(0.55, 0.9)).toBeCloseTo(880, -1)
    expect(synth.activeVoices).toBe(1)
    // No new attack: the level keeps decaying smoothly at the bend.
    const peak = (from: number, to: number): number => Math.max(...out.subarray(Math.round(from * RATE), Math.round(to * RATE)).map(Math.abs))
    expect(peak(0.5, 0.52)).toBeLessThanOrEqual(peak(0.46, 0.5) + 1e-6)
  })
})
