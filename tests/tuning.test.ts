import * as alphaTab from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { arrange, syncArrangement } from '../src/renderer/src/model/arrangement'
import { addTrack, createSong, setFret, setSection, type Cursor } from '../src/renderer/src/model/edit'
import { createDemoSong, GUITAR_STANDARD, notePitch, type Note, type Song } from '../src/renderer/src/model/song'
import { fretFor } from '../src/renderer/src/model/stepEntry'
import { isStandardTuning, retuneTrack, soundingTuning, stringLetters, TUNING_PRESETS, tuningLabel, tuningPreset } from '../src/renderer/src/model/tuning'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'
import { songToAlphaTab } from '../src/renderer/src/score/toAlphaTab'

const DROP_D = TUNING_PRESETS[6][1].tuning
const WHOLE = { value: 1, dotted: false } as const
const at = (bar: number, string = 1, beat = 0): Cursor => ({ track: 0, bar, beat, string })

/** A guitar song with `notes` (string, fret) as whole notes, one bar each. */
function guitarSong(...notes: [number, number][]): Song {
  let song = createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: notes.length })
  notes.forEach(([string, fret], bar) => (song = setFret(song, at(bar, string), fret, WHOLE)!.song))
  return song
}

const firstNotes = (song: Song): Note[] => song.tracks[0].bars.map((bar) => bar.beats[0].notes[0])
const pitches = (song: Song): number[] => song.tracks[0].bars.flatMap((bar) => bar.beats.flatMap((beat) => beat.notes.map((n) => notePitch(song.tracks[0], n))))

describe('tunings', () => {
  it('names tunings: a preset, or the strings from the lowest', () => {
    expect(tuningPreset(DROP_D)?.name).toBe('Drop D')
    expect(stringLetters(DROP_D)).toBe('D A D G B E')
    expect(tuningLabel({ tuning: GUITAR_STANDARD })).toBe('Standard')
    expect(tuningLabel({ tuning: DROP_D, capo: 2 })).toBe('Drop D · capo 2')
    expect(tuningLabel({ tuning: [62, 59, 55, 50, 43, 38] })).toBe('Open G')
    expect(tuningLabel({ tuning: [64, 59, 55, 50, 45, 41] })).toBe('F A D G B E')
    expect(isStandardTuning(GUITAR_STANDARD)).toBe(true)
    expect(isStandardTuning(DROP_D)).toBe(false)
    // Every preset has as many strings as it is listed under.
    for (const [strings, presets] of Object.entries(TUNING_PRESETS)) for (const preset of presets) expect(preset.tuning).toHaveLength(Number(strings))
  })

  it('counts frets from the capo', () => {
    const song = guitarSong([1, 0], [6, 3])
    const track = { ...song.tracks[0], capo: 2 }
    expect(soundingTuning(track)[0]).toBe(66) // F#4
    expect(notePitch(track, firstNotes(song)[0])).toBe(66)
    expect(notePitch(track, firstNotes(song)[1])).toBe(45) // G2 + 2 = A2
    // Step input and transcription fret pitches for the capo.
    expect(fretFor(track, 66, new Set(), 3, 1)).toEqual({ string: 1, fret: 0 })
    expect(fretFor(track, 64, new Set(), 3, 1)).toEqual({ string: 2, fret: 3 })
  })
})

describe('retuning a track', () => {
  it('keeps the frets: the tab stays and the music follows the tuning', () => {
    const song = guitarSong([6, 3], [1, 0])
    const { result, moved, changed } = retuneTrack(song, at(0), 0, DROP_D, 0, 'frets')!
    expect(result.song.tracks[0].tuning).toEqual(DROP_D)
    expect(firstNotes(result.song).map((n) => n.fret)).toEqual([3, 0])
    expect(pitches(result.song)).toEqual([41, 64])
    expect([moved, changed]).toEqual([0, 0])
  })

  it('keeps the sound: frets move on the same string', () => {
    const song = guitarSong([6, 3], [1, 0], [6, 0])
    const { result, moved, changed } = retuneTrack(song, at(0), 0, DROP_D, 0, 'sound')!
    expect(firstNotes(result.song).map((n) => [n.string, n.fret])).toEqual([[6, 5], [1, 0], [6, 2]])
    expect(pitches(result.song)).toEqual(pitches(song))
    expect([moved, changed]).toEqual([0, 0])
  })

  it('moves a note its string no longer reaches to a free string of the beat', () => {
    // Open high E and, in the same beat, B (string 2, fret 0): with a capo on 2, string 1 starts at F#.
    let song = guitarSong([1, 0])
    song = setFret(song, at(0, 2), 0, WHOLE)!.song
    song = setFret(song, at(0, 3), 2, WHOLE)!.song // A3
    const { result, moved, changed } = retuneTrack(song, at(0), 0, GUITAR_STANDARD, 2, 'sound')!
    const notes = result.song.tracks[0].bars[0].beats[0].notes
    expect(result.song.tracks[0].capo).toBe(2)
    // A3 stays on string 3 (fret 0 with the capo); E4 goes to string 2 (fret 3); B3 has no free string that reaches it.
    expect(notes.map((n) => [n.string, n.fret])).toEqual([[2, 3], [3, 0], [4, 7]])
    expect(notes.map((n) => notePitch(result.song.tracks[0], n))).toEqual([64, 57, 59])
    expect([moved, changed]).toEqual([2, 0])
  })

  it('leaves notes no string can reach as they were, and says so', () => {
    const song = guitarSong([6, 0]) // low E: below every string with a capo
    const { result, moved, changed } = retuneTrack(song, at(0), 0, GUITAR_STANDARD, 3, 'sound')!
    expect(firstNotes(result.song)[0]).toMatchObject({ string: 6, fret: 0 })
    expect([moved, changed]).toEqual([0, 1])
    // Taking the capo off again removes it from the track.
    expect(retuneTrack(result.song, at(0), 0, GUITAR_STANDARD, 0, 'frets')!.result.song.tracks[0].capo).toBeUndefined()
  })

  it('retunes the parts of an arranged song, also parts not placed', () => {
    let song = guitarSong([6, 3], [6, 5])
    song = setSection(song, at(0), 0, 'A').song
    song = setSection(song, at(0), 1, 'B').song
    song = arrange(song)
    // A part that is only in the palette.
    song.tracks[0].parts!.push({ id: 'spare', name: 'Spare', bars: [structuredClone(song.tracks[0].bars[0])] })
    const retuned = retuneTrack(song, at(0), 0, DROP_D, 0, 'sound')!
    const after = syncArrangement(song, retuned.result.song)
    expect(firstNotes(after).map((n) => n.fret)).toEqual([5, 7])
    expect(after.tracks[0].parts!.map((p) => p.bars[0].beats[0].notes[0].fret)).toEqual([5, 7, 5])
  })

  it('only retunes guitar and bass tracks, with the same number of strings', () => {
    const song = addTrack(guitarSong([1, 0]), at(0), 'drums').song
    expect(retuneTrack(song, at(0), 1, DROP_D, 0, 'sound')).toBeNull()
    expect(retuneTrack(song, at(0), 0, [40, 45, 50, 55], 0, 'sound')).toBeNull()
  })
})

describe('tuning and capo in the score and the file', () => {
  it('lists a tuning other than standard and notes the capo', () => {
    const song = createDemoSong()
    song.tracks[0].tuning = DROP_D
    song.tracks[0].capo = 2
    const { score } = songToAlphaTab(song, new alphaTab.Settings())
    const staff = score.tracks[0].staves[0]
    expect(staff.capo).toBe(2)
    expect(staff.stringTuning.name).toBe('Drop D')
    expect(staff.stringTuning.tunings).toEqual(DROP_D)
    // The bass is in standard tuning: not listed.
    expect(score.stylesheet.perTrackDisplayTuning?.get(1)).toBe(false)
    expect(score.stylesheet.perTrackDisplayTuning?.has(0)).toBe(false)
  })

  it('saves the capo with the track, and rejects an invalid one', () => {
    const song = createDemoSong()
    song.tracks[0].tuning = DROP_D
    song.tracks[0].capo = 4
    const loaded = parseProject(serializeProject(song)).song
    expect(loaded.tracks[0]).toMatchObject({ tuning: DROP_D, capo: 4 })
    song.tracks[0].capo = 40
    expect(() => parseProject(serializeProject(song))).toThrow('invalid capo')
  })
})
