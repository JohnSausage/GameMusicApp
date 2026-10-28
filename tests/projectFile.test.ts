import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { decodeWav16, encodeWav16 } from '../src/renderer/src/audio/wav'
import { addBars, addTrack, createSong } from '../src/renderer/src/model/edit'
import { createDemoSong, type Song, type TakeInfo } from '../src/renderer/src/model/song'
import { DEFAULT_LAYOUT, sameLayout, showTrack, shownTracks, type Layout } from '../src/renderer/src/project/layout'
import { FORMAT_VERSION, parseProject, ProjectFileError, serializeProject, suggestedFileName } from '../src/renderer/src/project/projectFile'

const zipJson = (json: unknown): Uint8Array => zipSync({ 'song.json': strToU8(JSON.stringify(json)) })

const take = (id: string): TakeInfo => ({ id, name: `Take ${id}`, sampleRate: 8000, tempo: 100, firstDownbeat: 0.25, createdAt: '2026-10-25T12:00:00.000Z' })

function testAudio(length: number): Float32Array {
  const samples = new Float32Array(length)
  for (let i = 0; i < length; i++) samples[i] = Math.sin(i / 5) * 0.5
  return samples
}

describe('project file', () => {
  it('round-trips a song', () => {
    const song = addBars(createDemoSong(), { track: 0, bar: 0, beat: 0, string: 1 }, 4, 'Chorus').song
    const { song: loaded, audio } = parseProject(serializeProject(song))
    expect(loaded).toEqual(song)
    expect(audio.size).toBe(0)
  })

  it('stores takes with their audio', () => {
    const song: Song = { ...createDemoSong(), takes: [take('a'), take('b')] }
    const audio = new Map([
      ['a', testAudio(800)],
      ['b', testAudio(1600)]
    ])
    const data = serializeProject(song, audio)
    expect(Object.keys(unzipSync(data)).sort()).toEqual(['audio/a.wav', 'audio/b.wav', 'song.json'])

    const loaded = parseProject(data)
    expect(loaded.song.takes).toEqual(song.takes)
    expect(loaded.audio.get('b')!.length).toBe(1600)
    const original = audio.get('a')!
    loaded.audio.get('a')!.forEach((v, i) => expect(Math.abs(v - original[i])).toBeLessThan(1 / 16384)) // 16-bit precision
  })

  it('leaves out takes that have no audio', () => {
    const song: Song = { ...createDemoSong(), takes: [take('a'), take('gone')] }
    const loaded = parseProject(serializeProject(song, new Map([['a', testAudio(100)]])))
    expect(loaded.song.takes.map((t) => t.id)).toEqual(['a'])
  })

  it('keeps the editor layout, and fixes settings it does not know', () => {
    const song = createDemoSong()
    const layout: Layout = { view: 'arrangement', staves: 'tab', zoom: 1.25, pageView: true, drumGridMinimized: true, pianoRollMinimized: false, hiddenTracks: [song.tracks[1].id] }
    expect(parseProject(serializeProject(song, new Map(), layout)).layout).toEqual(layout)
    expect(parseProject(serializeProject(song)).layout).toBeUndefined() // files saved before layouts: the app uses the last one
    const odd = { view: 'mixer', staves: 'sideways', zoom: 9, pageView: 1, drumGridMinimized: 'yes', pianoRollMinimized: true, hiddenTracks: ['a', 7, 'a'] }
    expect(parseProject(zipJson({ app: 'GameMusicApp', formatVersion: FORMAT_VERSION, song, layout: odd })).layout).toEqual({
      view: 'score',
      staves: 'notation+tab',
      zoom: 2,
      pageView: false,
      drumGridMinimized: false,
      pianoRollMinimized: true,
      hiddenTracks: ['a']
    })
  })

  it('opens version 1 files (no sections, no takes)', () => {
    const { sections: _s, takes: _t, ...song } = createSong({ title: 'Old', tempo: 90, timeSignature: [3, 4], firstTrack: 'bass' })
    const loaded = parseProject(zipJson({ app: 'GameMusicApp', formatVersion: 1, song }))
    expect(loaded.song.sections).toEqual([])
    expect(loaded.song.takes).toEqual([])
  })

  it('rejects files that are not projects', () => {
    expect(() => parseProject(new Uint8Array([1, 2, 3]))).toThrow(ProjectFileError)
    expect(() => parseProject(zipSync({ 'other.txt': strToU8('hi') }))).toThrow('song.json is missing')
    expect(() => parseProject(zipJson({ app: 'SomethingElse', formatVersion: 1 }))).toThrow('not a GameMusicApp project')
  })

  it('rejects files from a newer app version', () => {
    expect(() => parseProject(zipJson({ app: 'GameMusicApp', formatVersion: FORMAT_VERSION + 1, song: createDemoSong() }))).toThrow('newer version')
  })

  it('explains what is damaged', () => {
    const song = createDemoSong()
    song.tracks[1].bars.pop()
    expect(() => parseProject(zipJson({ app: 'GameMusicApp', formatVersion: 1, song }))).toThrow('track 2 has the wrong number of bars')

    const badNote = createDemoSong()
    badNote.tracks[0].bars[0].beats[0].notes[0].string = 9
    expect(() => parseProject(zipJson({ app: 'GameMusicApp', formatVersion: 1, song: badNote }))).toThrow('track 1, bar 1 has an invalid note')

    const badTake = { ...createDemoSong(), takes: [{ ...take('x'), id: '../evil' }] }
    expect(() => parseProject(zipJson({ app: 'GameMusicApp', formatVersion: 2, song: badTake }))).toThrow('a take has no valid id or name')

    const badSound = createDemoSong()
    badSound.tracks[0].instrument = { kind: 'soundfont', program: 128 }
    expect(() => parseProject(zipJson({ app: 'GameMusicApp', formatVersion: 3, song: badSound }))).toThrow('track 1 has no valid instrument')
  })

  it('suggests a safe file name from the title', () => {
    expect(suggestedFileName('Boss: Phase 2?')).toBe('Boss Phase 2.gmsong')
    expect(suggestedFileName('  ')).toBe('Untitled.gmsong')
  })
})

describe('decodeWav16', () => {
  it('reads back what encodeWav16 wrote', () => {
    const left = new Float32Array([0, 0.5, -0.5, 1])
    const right = new Float32Array([0.25, -1, 0, 0.75])
    const { channels, sampleRate } = decodeWav16(encodeWav16([left, right], 44100))
    expect(sampleRate).toBe(44100)
    expect(Array.from(channels[0])).toEqual([0, 16383 / 32767, -0.5, 1].map(Math.fround))
    expect(Array.from(channels[1])).toEqual([8191 / 32767, -1, 0, 24575 / 32767].map(Math.fround))
  })

  it('rejects other files', () => {
    expect(() => decodeWav16(new Uint8Array(20))).toThrow('Not a WAV file')
  })
})

describe('tracks shown in the score', () => {
  const song = createDemoSong()
  const [a, b] = song.tracks.map((t) => t.id)
  const apply = (layout: Layout, change: Partial<Layout>): Layout => ({ ...layout, ...change })

  it('shows every track until some are left out', () => {
    expect(shownTracks(song, DEFAULT_LAYOUT)).toEqual(song.tracks.map((_, i) => i))
    const hidden = apply(DEFAULT_LAYOUT, showTrack(song, DEFAULT_LAYOUT, a, false))
    expect(hidden.hiddenTracks).toEqual([a])
    expect(shownTracks(song, hidden)).toEqual(song.tracks.slice(1).map((_, i) => i + 1))
    expect(sameLayout(hidden, DEFAULT_LAYOUT)).toBe(false)
    expect(apply(hidden, showTrack(song, hidden, a, true)).hiddenTracks).toEqual([])
  })

  it('never leaves out the last track shown', () => {
    let layout = DEFAULT_LAYOUT
    for (const track of song.tracks) layout = apply(layout, showTrack(song, layout, track.id, false))
    expect(layout.hiddenTracks).toHaveLength(song.tracks.length - 1)
    expect(shownTracks(song, layout)).toEqual([song.tracks.length - 1])
    // A file where every track is hidden shows them all.
    expect(shownTracks(song, { ...DEFAULT_LAYOUT, hiddenTracks: song.tracks.map((t) => t.id) })).toHaveLength(song.tracks.length)
  })

  it('forgets tracks that were deleted', () => {
    const three = addTrack(song, { track: 0, bar: 0, beat: 0, string: 1 }, 'drums').song
    const layout = { ...DEFAULT_LAYOUT, hiddenTracks: ['gone', a] }
    expect(apply(layout, showTrack(three, layout, b, false)).hiddenTracks).toEqual([a, b])
  })
})
