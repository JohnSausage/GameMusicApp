import { describe, expect, it } from 'vitest'
import { CONSOLES, consoleNotes, consoleOf, consoleProblems, consoleSummary, fitToConsole, type ConsoleId } from '../src/renderer/src/model/consoles'
import { updateMaster } from '../src/renderer/src/model/edit'
import { createDemoSong, createTrack, type Instrument, type Song } from '../src/renderer/src/model/song'
import { DEFAULT_PATCH, eightBitKit, type SynthPatch } from '../src/renderer/src/model/synth'
import type { NoteEvent } from '../src/renderer/src/model/timing'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'

const synth = (settings: Partial<SynthPatch> = {}): Instrument => ({ kind: 'synth', patch: { ...DEFAULT_PATCH, ...settings } })
const pulse = synth()

/** A song at 120 BPM in 4/4 (a bar is 2 s) with a track per instrument, played on a console. */
function song(console: ConsoleId | undefined, ...instruments: Instrument[]): Song {
  return {
    ...createDemoSong(),
    tracks: instruments.map((instrument, i) => ({ ...createTrack('keys', [], `Track ${i + 1}`), instrument })),
    master: { crushBits: 16, crushRate: 0, ...(console && { console }) }
  }
}

const note = (trackIndex: number, start: number, duration: number, pitch = 60): NoteEvent => ({ trackIndex, pitch, velocity: 100, start, duration })
const nes = CONSOLES.find((c) => c.id === 'nes')!

describe('authentic mode', () => {
  it('plays as many notes of a kind at once as the console has channels; a chord loses its first note', () => {
    const s = song('nes', pulse, pulse, pulse, synth({ waveform: 'triangle' }), synth({ waveform: 'noise' }))
    const notes = [note(0, 0, 1), note(1, 0, 1), note(2, 0, 1), note(3, 0, 1), note(4, 0, 1)]
    const fitted = fitToConsole(s, notes, nes)
    expect(fitted.notes.map((n) => n.trackIndex)).toEqual([1, 2, 3, 4])
    expect(fitted.problems).toEqual([{ kind: 'channels', bar: 0, channel: 'pulse', notes: 3 }])
  })

  it('gives a later note the channel of the note that started first, which ends there', () => {
    const s = song('nes', pulse, pulse, pulse)
    const input = [note(0, 0, 4), note(1, 1, 3), note(2, 2.5, 0.5)]
    const fitted = fitToConsole(s, input, nes)
    expect(fitted.notes.map((n) => [n.trackIndex, n.start, n.duration])).toEqual([
      [0, 0, 2.5],
      [1, 1, 3],
      [2, 2.5, 0.5]
    ])
    expect(fitted.problems).toEqual([{ kind: 'channels', bar: 1, channel: 'pulse', notes: 3 }])
    // The notes passed in are left as they were.
    expect(input[0].duration).toBe(4)
  })

  it('lets drums share the channels: an 8-bit kick takes the triangle from the bass, a snare plays on the noise', () => {
    const s = song('nes', synth({ waveform: 'triangle' }), { kind: 'synthkit', pieces: eightBitKit() })
    const fitted = fitToConsole(s, [note(0, 0, 2, 40), note(1, 1, 0.25, 36), note(1, 1.5, 0.25, 38)], nes)
    expect(fitted.notes.map((n) => [n.trackIndex, n.duration])).toEqual([
      [0, 1],
      [1, 0.25],
      [1, 0.25]
    ])
    expect(fitted.problems).toEqual([{ kind: 'channels', bar: 0, channel: 'triangle', notes: 2 }])
  })

  it('plays an arpeggio’s or a mono synth’s chord on one channel', () => {
    const s = song('nes', synth({ arpRate: 30 }), synth({ mono: true }))
    const chord = [note(0, 0, 1, 60), note(0, 0, 1, 64), note(0, 0, 1, 67), note(1, 0, 1, 72), note(1, 0.5, 1, 76)]
    expect(fitToConsole(s, chord, nes)).toEqual({ notes: chord, problems: [] })
  })

  it('names sounds the console doesn’t have, and plays them as they are', () => {
    const s = song('nes', synth({ waveform: 'sawtooth' }), { kind: 'soundfont', program: 0 }, synth({ waveform: 'fm' }))
    const notes = [note(0, 0, 1), note(1, 0, 1)]
    const fitted = fitToConsole(s, notes, nes)
    expect(fitted.notes).toEqual(notes)
    // The FM track has no notes: nothing to say about it.
    expect(fitted.problems).toEqual([
      { kind: 'sound', track: 0, sound: 'a saw wave' },
      { kind: 'sound', track: 1, sound: 'a SoundFont instrument' }
    ])
    // The Game Boy plays a saw on its wave channel, the Mega Drive has six FM channels.
    expect(consoleProblems({ ...s, master: { crushBits: 16, crushRate: 0, console: 'gameboy' } }, [note(0, 0, 1)])).toEqual([])
    const fm = song('megadrive', ...Array.from({ length: 7 }, () => synth({ waveform: 'fm' })))
    expect(consoleProblems(fm, Array.from({ length: 6 }, (_, t) => note(t, 0, 1)))).toEqual([])
    expect(consoleProblems(fm, Array.from({ length: 7 }, (_, t) => note(t, 0, 1)))).toEqual([{ kind: 'channels', bar: 0, channel: 'fm', notes: 7 }])
  })

  it('leaves muted tracks out, and changes nothing without a console', () => {
    const s = song('nes', pulse, pulse, pulse)
    s.tracks[0].mute = true
    expect(consoleProblems(s, [note(0, 0, 1), note(1, 0, 1), note(2, 0, 1)])).toEqual([])
    const free = song(undefined, pulse, pulse, pulse)
    const notes = [note(0, 0, 1), note(1, 0, 1), note(2, 0, 1)]
    expect(consoleOf(free)).toBeNull()
    expect(consoleNotes(free, notes)).toBe(notes)
    expect(consoleProblems(free, notes)).toEqual([])
  })

  it('says what the bar at the cursor needs, or where the first bar that needs more is', () => {
    const s = song('nes', pulse, pulse, pulse, { kind: 'soundfont', program: 0 })
    const problems = consoleProblems(s, [note(0, 2, 1), note(1, 2, 1), note(2, 2, 1), note(0, 6, 1), note(1, 6, 1), note(2, 6, 1), note(3, 0, 1)])
    expect(consoleSummary(s, nes, problems, 1).text).toBe(
      'Bar 2 has 3 pulse notes at once; the NES has 2 pulse channels, so the notes that started first are cut short. 1 more bar too. “Track 4” plays a SoundFont instrument, which the NES doesn’t have; it plays as it is.'
    )
    expect(consoleSummary(s, nes, problems, 0)).toEqual({
      text: '2 bars have more notes at once than the NES has channels for; the notes that started first are cut short. “Track 4” plays a SoundFont instrument, which the NES doesn’t have; it plays as it is.',
      firstBar: 1
    })
  })

  it('is saved with the project; a console this version doesn’t know plays without limits', () => {
    const s = createDemoSong()
    const on = updateMaster(s, { track: 0, bar: 0, beat: 0, string: 1 }, { console: 'gameboy' }).song
    expect(parseProject(serializeProject(on)).song.master?.console).toBe('gameboy')
    const off = updateMaster(on, { track: 0, bar: 0, beat: 0, string: 1 }, { console: undefined }).song
    expect(off.master && 'console' in off.master).toBe(false)
    const unknown = { ...on, master: { ...on.master!, console: 'atari' as ConsoleId } }
    expect(parseProject(serializeProject(unknown)).song.master?.console).toBeUndefined()
  })
})
