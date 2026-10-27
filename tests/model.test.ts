import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/renderer/src/audio/midiExport'
import { updateTrack } from '../src/renderer/src/model/edit'
import { createDemoSong, GM_FAMILIES, gmSoundName, notePitch, soundName } from '../src/renderer/src/model/song'
import { FACTORY_PRESETS } from '../src/renderer/src/model/synth'
import { beatAt, buildTimeline } from '../src/renderer/src/model/timing'

describe('buildTimeline', () => {
  const song = createDemoSong()
  const timeline = buildTimeline(song)

  it('computes the song length from tempo and note values', () => {
    // 4 bars of 4/4 at 120 BPM = 16 quarters × 0.5 s
    expect(timeline.duration).toBeCloseTo(8)
  })

  it('places notes at absolute times', () => {
    const guitar = timeline.notes.filter((n) => n.trackIndex === 0)
    expect(guitar[0]).toMatchObject({ pitch: 57, start: 0, duration: 0.25 })
    expect(guitar[1].start).toBeCloseTo(0.25)
    // bar 2 starts at 2 s with E4
    expect(guitar.find((n) => n.start === 2)?.pitch).toBe(64)
  })

  it('expands chords into one event per note', () => {
    const chordNotes = timeline.notes.filter((n) => n.trackIndex === 0 && n.start === 7)
    expect(chordNotes.map((n) => n.pitch).sort()).toEqual([40, 47, 52, 55])
  })

  it('finds the beat at a given time', () => {
    expect(beatAt(timeline, 0, 0.3)).toMatchObject({ barIndex: 0, beatIndex: 1 })
    expect(beatAt(timeline, 1, 7.5)).toMatchObject({ barIndex: 3, beatIndex: 2 })
    expect(beatAt(timeline, 0, 99)).toBeUndefined()
  })
})

describe('notePitch', () => {
  it('numbers strings from the highest (string 1 = high E)', () => {
    const guitar = createDemoSong().tracks[0]
    expect(notePitch(guitar, { string: 1, fret: 0, velocity: 100 })).toBe(64)
    expect(notePitch(guitar, { string: 6, fret: 3, velocity: 100 })).toBe(43)
  })
})

describe('General MIDI sounds', () => {
  it('names all 128, in their families of eight', () => {
    const names = GM_FAMILIES.flatMap((f) => f.sounds)
    expect(GM_FAMILIES.every((f) => f.sounds.length === 8)).toBe(true)
    expect(new Set(names).size).toBe(128)
    expect([0, 25, 33, 80, 127].map(gmSoundName)).toEqual(['Grand piano', 'Steel-string guitar', 'Finger bass', 'Square lead', 'Gunshot'])
    expect(soundName({ kind: 'soundfont', program: 4 })).toBe('Electric piano 1')
    expect(soundName({ kind: 'synth', patch: FACTORY_PRESETS[4] })).toBe(`8-bit: ${FACTORY_PRESETS[4].name}`)
  })

  it('can play a guitar track with a piano sound', () => {
    const song = updateTrack(createDemoSong(), { track: 0, bar: 0, beat: 0, string: 1 }, 0, { instrument: { kind: 'soundfont', program: 4 } }).song
    expect(new Midi(songToMidi(song)).tracks[0].instrument.number).toBe(4)
  })
})
