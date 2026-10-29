import { Midi } from '@tonejs/midi'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/renderer/src/audio/midiExport'
import { encodeWav16 } from '../src/renderer/src/audio/wav'
import { beatMap, beatMapFileName, beatMapJson } from '../src/renderer/src/model/beatMap'
import { emptyBar, type Cursor } from '../src/renderer/src/model/edit'
import { audibleTracks, createDemoSong, createTrack, type Song } from '../src/renderer/src/model/song'
import { setStemName, stemName, stemsOf, stemSong, tracksWithNotes } from '../src/renderer/src/model/stems'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'

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

const CURSOR: Cursor = { track: 0, bar: 0, beat: 0, string: 1 }

describe('stems', () => {
  /** The demo song (guitar and bass, 4 bars of 2 s) with an empty drum track. */
  const withDrums = (): Song => {
    const song = createDemoSong()
    return { ...song, tracks: [...song.tracks, createTrack('drums', song.tracks[0].bars.map(() => emptyBar(song)))] }
  }

  it('are rendered from the song with only their tracks heard, as they sound in the mix', () => {
    const song = withDrums()
    song.tracks[0] = { ...song.tracks[0], solo: true, volume: 0.5 }
    song.tracks[1] = { ...song.tracks[1], mute: true }
    const bass = stemSong(song, [1])
    expect(audibleTracks(bass)).toEqual([false, true, false])
    expect(bass.tracks[1]).toMatchObject({ volume: song.tracks[1].volume, pan: song.tracks[1].pan, instrument: song.tracks[1].instrument })
    expect(stemSong(song, [0]).tracks[0].volume).toBe(0.5)
    expect(audibleTracks(stemSong(song, [1, 2]))).toEqual([false, true, true])
    // The song itself is left as it is.
    expect(song.tracks[1].mute).toBe(true)
    expect(audibleTracks(song)).toEqual([true, false, false])
  })

  it('know which tracks play in a range', () => {
    const song = withDrums()
    expect(tracksWithNotes(song, { start: 0, end: 8 })).toEqual([true, true, false])
    expect(tracksWithNotes(song, { start: 100, end: 108 })).toEqual([false, false, false])
  })

  it('are a file per track, named after the song, the range and the track, safe for files and each its own', () => {
    const song = withDrums()
    song.title = 'Boss: Phase 1'
    song.tracks[1] = { ...song.tracks[1], name: 'Acoustic guitar' }
    song.tracks[2] = { ...song.tracks[2], name: ' ' }
    const files = (rangeName: string | null, indexes: number[]): string[] => stemsOf(song, rangeName, indexes).stems.map((stem) => stem.fileName)
    // Two tracks of the same name share a stem; a track without a name is named by its place.
    expect(files(null, [0, 2])).toEqual(['Boss Phase 1 - Acoustic guitar.wav', 'Boss Phase 1 - Track 3.wav'])
    expect(stemsOf(song, null, [0, 1, 2]).stems.map((stem) => stem.trackIndexes)).toEqual([[0, 1], [2]])
    expect(files('Chorus', [2])).toEqual(['Boss Phase 1 - Chorus - Track 3.wav'])
  })

  it('join the tracks with the same stem name, which is saved with the project', () => {
    let song = withDrums()
    song = setStemName(song, CURSOR, 1, 'Rhythm')!.song
    song = setStemName(song, CURSOR, 2, ' rhythm ')!.song
    const { stems, mixFileName } = stemsOf(song, null, [0, 1, 2], true)
    expect(stems.map((stem) => [stem.name, stem.trackIndexes, stem.fileName])).toEqual([
      ['Acoustic guitar', [0], 'Demo song - Acoustic guitar.wav'],
      ['Rhythm', [1, 2], 'Demo song - Rhythm.wav']
    ])
    expect(mixFileName).toBe('Demo song.wav')
    expect(stemName(song.tracks[2], 2)).toBe('rhythm')
    expect(parseProject(serializeProject(song)).song.tracks.map((t) => t.stem)).toEqual([undefined, 'Rhythm', ' rhythm '])

    // An empty name gives the track its own stem again.
    const own = setStemName(song, CURSOR, 2, '  ')!.song
    expect('stem' in own.tracks[2]).toBe(false)
    expect(setStemName(song, CURSOR, 9, 'x')).toBeNull()

    // A stem name that isn't text is dropped when the file is opened.
    const odd = structuredClone(song)
    ;(odd.tracks[1] as { stem: unknown }).stem = 7
    expect(parseProject(serializeProject(odd)).song.tracks[1].stem).toBeUndefined()
  })
})

describe('beat map', () => {
  /** The demo song (4 bars of 2 s at 120 BPM) as an intro of 1 bar and a loop of 3. */
  const withSections = (): Song => ({
    ...createDemoSong(),
    sections: [
      { bar: 0, name: 'Intro' },
      { bar: 1, name: 'Loop' }
    ]
  })

  it('has the tempo, the beat and where the sections are, in seconds and bars', () => {
    const song = withSections()
    const map = beatMap(song, { start: 0, end: 4, name: null }, { sampleRate: 48000, ending: 'cut', mix: 'Demo song.wav', stems: [] })
    expect(map).toMatchObject({
      format: 'GameMusicApp beat map',
      version: 1,
      title: 'Demo song',
      range: null,
      firstBar: 1,
      tempo: 120,
      timeSignature: [4, 4],
      beatsPerBar: 4,
      secondsPerBeat: 0.5,
      secondsPerBar: 2,
      bars: 4,
      seconds: 8,
      loops: true,
      tailSeconds: 0,
      sampleRate: 48000,
      samples: 384000,
      mix: 'Demo song.wav',
      stems: []
    })
    expect(map.sections).toEqual([
      { name: 'Intro', bar: 0, bars: 1, start: 0, end: 2 },
      { name: 'Loop', bar: 1, bars: 3, start: 2, end: 8 }
    ])
  })

  it('counts from the first exported bar, and knows the ring-out and the stems', () => {
    const song = withSections()
    const { stems } = stemsOf(song, 'bars 1-2', [0, 1])
    const map = beatMap(song, { start: 0, end: 2, name: 'bars 1-2' }, { sampleRate: 44100, ending: 'tail', mix: null, stems })
    expect(map).toMatchObject({ range: 'bars 1-2', bars: 2, seconds: 4, loops: false, tailSeconds: 1.5, samples: Math.round(5.5 * 44100) })
    expect(map.stems).toEqual([
      { file: 'Demo song - bars 1-2 - Acoustic guitar.wav', name: 'Acoustic guitar', tracks: ['Acoustic guitar'] },
      { file: 'Demo song - bars 1-2 - Bass.wav', name: 'Bass', tracks: ['Bass'] }
    ])
    // A range starting inside a section: it starts at bar 0 of the files.
    const later = beatMap(song, { start: 2, end: 4, name: 'bars 3-4' }, { sampleRate: 48000, ending: 'cut', mix: null, stems: [] })
    expect(later.firstBar).toBe(3)
    expect(later.sections).toEqual([{ name: 'Loop', bar: 0, bars: 2, start: 0, end: 4 }])
    expect(beatMapFileName(song, 'bars 3-4')).toBe('Demo song - bars 3-4.json')
  })

  it('counts beats in the time signature: eighths in 6/8', () => {
    const song: Song = { ...withSections(), tempo: 90, timeSignature: [6, 8] }
    const map = beatMap(song, { start: 0, end: 1, name: null }, { sampleRate: 48000, ending: 'cut', mix: null, stems: [] })
    // A 6/8 bar is three quarters: 2 s at 90 quarters a minute, six beats of 1/3 s.
    expect(map).toMatchObject({ beatsPerBar: 6, secondsPerBar: 2, secondsPerBeat: 0.333333 })
    expect(JSON.parse(beatMapJson(map))).toEqual(map)
  })

  it('has the fields the Unity script reads', () => {
    const script = readFileSync(new URL('../unity/GameMusicPlayer.cs', import.meta.url), 'utf8')
    /** The public fields of a class in the script, up to its first nested class. */
    const fields = (name: string): string[] => {
      const body = script.slice(script.indexOf(`public class ${name}`)).split(/\n\s*\[Serializable\]/)[0]
      return [...body.matchAll(/public [\w[\]]+ (\w+);/g)].map((m) => m[1]).sort()
    }
    const song = withSections()
    const map = beatMap(song, { start: 0, end: 4, name: null }, { sampleRate: 48000, ending: 'cut', mix: null, stems: stemsOf(song, null, [0]).stems })
    expect(fields('BeatMapData')).toEqual(Object.keys(map).sort())
    expect(fields('SectionData')).toEqual(Object.keys(map.sections[0]).sort())
    expect(fields('StemData')).toEqual(Object.keys(map.stems[0]).sort())
  })
})
