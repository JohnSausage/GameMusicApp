import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/renderer/src/audio/midiExport'
import { encodeWav16 } from '../src/renderer/src/audio/wav'
import { createDemoSong } from '../src/renderer/src/model/song'

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
