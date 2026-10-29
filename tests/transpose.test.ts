import * as alphaTab from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { arrange, syncArrangement } from '../src/renderer/src/model/arrangement'
import { addTrack, createSong, selectionBetween, setFret, setSection, updateSong, type Cursor } from '../src/renderer/src/model/edit'
import { keyAccidentals, keyName, songKey, transposeKey } from '../src/renderer/src/model/keySignature'
import { keyRow, notePitch, type Song } from '../src/renderer/src/model/song'
import { transpose } from '../src/renderer/src/model/transpose'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'
import { songToAlphaTab } from '../src/renderer/src/score/toAlphaTab'
import { noteName } from '../src/renderer/src/transcription/notes'

const WHOLE = { value: 1, dotted: false } as const
const QUARTER = { value: 4, dotted: false } as const
const at = (bar: number, string = 1, beat = 0, track = 0): Cursor => ({ track, bar, beat, string })

/** A guitar song with `notes` (string, fret) as whole notes, one bar each. */
function guitarSong(...notes: [number, number][]): Song {
  let song = createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: notes.length })
  notes.forEach(([string, fret], bar) => (song = setFret(song, at(bar, string), fret, WHOLE)!.song))
  return song
}

/** "string/fret" of each bar's first note. */
const tab = (song: Song, track = 0): string[] => song.tracks[track].bars.map((bar) => bar.beats[0].notes.map((n) => `${n.string}/${n.fret}`).join('+') || '-')
const pitches = (song: Song, track = 0): number[] => song.tracks[track].bars.flatMap((bar) => bar.beats.flatMap((b) => b.notes.map((n) => notePitch(song.tracks[track], n))))

describe('key signatures', () => {
  it('are named by their tonic and their sharps or flats', () => {
    expect(keyName(songKey(guitarSong([1, 0])))).toBe('C major')
    expect(keyName({ fifths: -3, minor: false })).toBe('E♭ major')
    expect(keyName({ fifths: 3, minor: true })).toBe('F♯ minor')
    expect(keyAccidentals({ fifths: 1, minor: false })).toBe('1 sharp')
    expect(keyAccidentals({ fifths: -2, minor: true })).toBe('2 flats')
    expect(keyAccidentals({ fifths: 0, minor: true })).toBe('no sharps or flats')
  })

  it('move with a transposition, with as few sharps or flats as can be', () => {
    expect(transposeKey({ fifths: 0, minor: false }, 2)).toEqual({ fifths: 2, minor: false }) // C → D
    expect(transposeKey({ fifths: 0, minor: false }, 1)).toEqual({ fifths: -5, minor: false }) // C → D♭, not C♯
    expect(transposeKey({ fifths: 0, minor: true }, -2)).toEqual({ fifths: -2, minor: true }) // A minor → G minor
    // F♯ or G♭: sharps from a key with sharps, flats from one with flats.
    expect(transposeKey({ fifths: 1, minor: false }, -1)).toEqual({ fifths: 6, minor: false })
    expect(transposeKey({ fifths: -1, minor: false }, 1)).toEqual({ fifths: -6, minor: false })
  })

  it('are shown in the score on every staff but the drums', () => {
    let song = addTrack(guitarSong([1, 0]), at(0), 'drums').song
    song = updateSong(song, at(0), { key: { fifths: -2, minor: true }, author: 'Julian' }).song
    const { score } = songToAlphaTab(song, new alphaTab.Settings())
    const bar = (track: number): alphaTab.model.Bar => score.tracks[track].staves[0].bars[0]
    expect(bar(0).keySignature).toBe(-2)
    expect(bar(0).keySignatureType).toBe(alphaTab.model.KeySignatureType.Minor)
    expect(bar(1).keySignature).toBe(0)
    expect(score.music).toBe('Julian')
  })

  it('are saved with the song, with the author; an invalid one is dropped', () => {
    const song = updateSong(guitarSong([1, 0]), at(0), { key: { fifths: 3, minor: false }, author: 'Julian' }).song
    expect(parseProject(serializeProject(song)).song).toMatchObject({ key: { fifths: 3, minor: false }, author: 'Julian' })
    const odd = { ...song, key: { fifths: 9, minor: false }, author: 42 } as unknown as Song
    const loaded = parseProject(serializeProject(odd)).song
    expect(loaded.key).toBeUndefined()
    expect(loaded.author).toBeUndefined()
    expect(updateSong(song, at(0), { author: '  ' }).song.author).toBeUndefined()
  })

  it('name notes with flats in a key with flats', () => {
    expect(noteName(70)).toBe('A#4')
    expect(noteName(70, true)).toBe('Bb4')
  })
})

describe('transpose', () => {
  it('keeps the strings: the frets move', () => {
    const song = guitarSong([1, 0], [3, 2], [6, 5])
    const result = transpose(song, at(0), { kind: 'track', track: 0 }, 2, 'keep')!
    expect(tab(result.result.song)).toEqual(['1/2', '3/4', '6/7'])
    expect(pitches(result.result.song)).toEqual(pitches(song).map((p) => p + 2))
    expect(result).toMatchObject({ notes: 3, moved: 0, folded: 0, unplaced: 0 })
  })

  it('moves a note its string cannot reach to a string that can', () => {
    const result = transpose(guitarSong([2, 23]), at(0), { kind: 'track', track: 0 }, 3, 'keep')!
    expect(tab(result.result.song)).toEqual(['1/21'])
    expect(result.moved).toBe(1)
  })

  it('moves a note out of the range of the instrument by an octave less', () => {
    // Low E down a whole step is below the guitar: it goes up an octave instead (D3 on the low string).
    const result = transpose(guitarSong([6, 0]), at(0), { kind: 'track', track: 0 }, -2, 'keep')!
    expect(tab(result.result.song)).toEqual(['6/10'])
    expect(result.folded).toBe(1)
  })

  it('chooses strings and frets near the hand with the best fingering', () => {
    // E5 at fret 12 down a fourth: the B string at fret 12 rather than the high E string at fret 7.
    const song = guitarSong([1, 12])
    expect(tab(transpose(song, at(0), { kind: 'track', track: 0 }, -5, 'keep')!.result.song)).toEqual(['1/7'])
    expect(tab(transpose(song, at(0), { kind: 'track', track: 0 }, -5, 'best')!.result.song)).toEqual(['2/12'])
    // Chords keep a string per note.
    let chord = guitarSong([1, 3])
    for (const [string, fret] of [[2, 3], [3, 0]]) chord = setFret(chord, at(0, string), fret, WHOLE)!.song
    const moved = transpose(chord, at(0), { kind: 'track', track: 0 }, 5, 'best')!.result.song
    expect(new Set(moved.tracks[0].bars[0].beats[0].notes.map((n) => n.string)).size).toBe(3)
    expect(pitches(moved)).toEqual(pitches(chord).map((p) => p + 5))
  })

  it('keeps a held note on the string of the note it is held from', () => {
    let song = createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 1 })
    song = setFret(song, at(0, 2, 0), 23, QUARTER)!.song
    song = setFret(song, at(0, 2, 1), 23, QUARTER)!.song
    song.tracks[0].bars[0].beats[1].notes[0].tie = true
    const moved = transpose(song, at(0), { kind: 'track', track: 0 }, 3, 'keep')!.result.song
    const [first, held] = moved.tracks[0].bars[0].beats.map((b) => b.notes[0])
    expect(held.string).toBe(first.string)
    expect(held.fret).toBe(first.fret)
  })

  it('moves only the selected beats', () => {
    const song = guitarSong([1, 0], [1, 1], [1, 2])
    const selection = selectionBetween(0, { bar: 1, beat: 0 }, { bar: 2, beat: 0 })
    const result = transpose(song, at(0), { kind: 'selection', selection }, -1, 'keep')!
    expect(tab(result.result.song)).toEqual(['1/0', '1/0', '1/1'])
  })

  it('moves keys to other keys and leaves drums as they are; the whole song moves its key', () => {
    let song = addTrack(guitarSong([1, 0]), at(0), 'keys').song
    song = addTrack(song, at(0), 'drums').song
    song = setFret(song, at(0, keyRow(60), 0, 1), 0, WHOLE)!.song
    song = setFret(song, at(0, 7, 0, 2), 0, WHOLE)!.song
    const result = transpose(song, at(0), { kind: 'song' }, 2, 'keep')!
    expect(tab(result.result.song, 1)).toEqual([`${keyRow(62)}/0`])
    expect(tab(result.result.song, 2)).toEqual(['7/0'])
    expect(result.result.song.key).toEqual({ fifths: 2, minor: false })
    expect(transpose(song, at(0), { kind: 'track', track: 0 }, 2, 'keep')!.result.song.key).toBeUndefined()
    // The highest key up a semitone goes down an octave instead.
    const high = setFret(song, at(0, keyRow(108), 0, 1), 0, WHOLE)!.song
    expect(transpose(high, at(0), { kind: 'track', track: 1 }, 1, 'keep')!.folded).toBe(1)
  })

  it('does nothing for 0 semitones or without notes', () => {
    const song = guitarSong([1, 0])
    expect(transpose(song, at(0), { kind: 'track', track: 0 }, 0, 'keep')).toBeNull()
    expect(transpose(createSong({ title: 'Empty', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar' }), at(0), { kind: 'song' }, 2, 'keep')).toBeNull()
    expect(transpose(addTrack(song, at(0), 'drums').song, at(0), { kind: 'track', track: 1 }, 2, 'keep')).toBeNull()
  })

  it('transposes every part of a track in an arranged song, also the ones no section plays', () => {
    let song = guitarSong([1, 3], [1, 5])
    song = setSection(song, at(0), 1, 'B').song
    song = arrange(song)
    const parts = song.tracks[0].parts!
    expect(parts).toHaveLength(2)
    // Section B plays nothing now; its part is still there.
    song = { ...song, arrangement: song.arrangement!.map((s, i) => (i === 1 ? { ...s, parts: {} } : s)) }
    const result = transpose(song, at(0), { kind: 'track', track: 0 }, 2, 'keep')!
    const synced = syncArrangement(song, result.result.song)
    expect(synced.tracks[0].parts!.map((p) => p.bars[0].beats[0].notes[0].fret)).toEqual([5, 7])
    expect(result.notes).toBe(2)
  })
})
