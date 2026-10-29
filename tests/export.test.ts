import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/renderer/src/audio/midiExport'
import { encodeWav16 } from '../src/renderer/src/audio/wav'
import { emptyBar } from '../src/renderer/src/model/edit'
import { audibleTracks, createDemoSong, createTrack, type Song } from '../src/renderer/src/model/song'
import { stemFileNames, stemSong, tracksWithNotes } from '../src/renderer/src/model/stems'

describe('encodeWav16', () => {
  it('writes a valid 16-bit PCM header and interleaved samples', () => {
    const left = new Float32Array([0, 1, -1])
    const right = new Float32Array([0.5, -0.5, 2])
    const bytes = encodeWav16([left, right], 48000)
    const view = new DataView(bytes.buffer)
    const text = (offset: number): string => String.fromCharCode(...bytes.slice(offset, offset + 4))

    expect(text(0)).toBe('RIFF')
    expect(text(8)).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(2) // channels
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint16(34, true)).toBe(16) // bits
    expect(view.getUint32(40, true)).toBe(3 * 2 * 2) // data size
    expect(bytes.length).toBe(44 + 12)

    const samples = Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true))
    expect(samples).toEqual([0, 16383, 32767, -16384, -32768, 32767]) // clipped at ±1
  })
})

describe('songToMidi', () => {
  it('exports one MIDI track per song track with tempo and notes', () => {
    const song = createDemoSong()
    const midi = new Midi(songToMidi(song))

    expect(midi.header.tempos[0].bpm).toBeCloseTo(120)
    expect(midi.tracks).toHaveLength(2)
    expect(midi.tracks[0].name).toBe('Acoustic guitar')
    expect(midi.tracks[0].instrument.number).toBe(25)
    expect(midi.tracks[1].instrument.number).toBe(80) // synth track → square lead
    expect(midi.tracks[0].notes[0]).toMatchObject({ midi: 57 })
    expect(midi.tracks[0].notes[0].time).toBeCloseTo(0)
    expect(midi.tracks[0].notes[1].time).toBeCloseTo(0.25)
    expect(midi.duration).toBeCloseTo(8, 1)
  })
})

describe('stems', () => {
  /** The demo song (guitar and bass, 4 bars of 2 s) with an empty drum track. */
  const withDrums = (): Song => {
    const song = createDemoSong()
    return { ...song, tracks: [...song.tracks, createTrack('drums', song.tracks[0].bars.map(() => emptyBar(song)))] }
  }

  it('are rendered from the song with only their track heard, as it sounds in the mix', () => {
    const song = withDrums()
    song.tracks[0] = { ...song.tracks[0], solo: true, volume: 0.5 }
    song.tracks[1] = { ...song.tracks[1], mute: true }
    const bass = stemSong(song, 1)
    expect(audibleTracks(bass)).toEqual([false, true, false])
    expect(bass.tracks[1]).toMatchObject({ volume: song.tracks[1].volume, pan: song.tracks[1].pan, instrument: song.tracks[1].instrument })
    expect(stemSong(song, 0).tracks[0].volume).toBe(0.5)
    // The song itself is left as it is.
    expect(song.tracks[1].mute).toBe(true)
    expect(audibleTracks(song)).toEqual([true, false, false])
  })

  it('know which tracks play in a range', () => {
    const song = withDrums()
    expect(tracksWithNotes(song, { start: 0, end: 8 })).toEqual([true, true, false])
    expect(tracksWithNotes(song, { start: 100, end: 108 })).toEqual([false, false, false])
  })

  it('are named after the song, the range and the track, safe for files and each its own', () => {
    const song = withDrums()
    song.title = 'Boss: Phase 1'
    song.tracks[1] = { ...song.tracks[1], name: 'Acoustic guitar' }
    song.tracks[2] = { ...song.tracks[2], name: ' ' }
    expect(stemFileNames(song, null, [0, 1, 2])).toEqual([
      'Boss Phase 1 - Acoustic guitar.wav',
      'Boss Phase 1 - Acoustic guitar 2.wav',
      'Boss Phase 1 - Track 3.wav'
    ])
    expect(stemFileNames(song, 'Chorus', [2])).toEqual(['Boss Phase 1 - Chorus - Track 3.wav'])
  })
})
