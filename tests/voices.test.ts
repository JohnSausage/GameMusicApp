import * as alphaTab from '@coderline/alphatab'
import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/renderer/src/audio/midiExport'
import { arrange } from '../src/renderer/src/model/arrangement'
import { fitBars, wrongBars } from '../src/renderer/src/model/barCheck'
import { addTrack, clampCursor, clearBar, createSong, pasteBeats, setDuration, setFret, type Cursor, type EditResult } from '../src/renderer/src/model/edit'
import { writeRoll } from '../src/renderer/src/model/keys'
import type { Beat, Song } from '../src/renderer/src/model/song'
import { changeTimeSignature } from '../src/renderer/src/model/timeSignature'
import { buildTimeline } from '../src/renderer/src/model/timing'
import { transpose } from '../src/renderer/src/model/transpose'
import { retuneTrack } from '../src/renderer/src/model/tuning'
import { otherVoice, swapVoices, unswapVoices } from '../src/renderer/src/model/voices'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'
import { voiceProject, type Project } from '../src/renderer/src/project/useProject'
import { songToAlphaTab } from '../src/renderer/src/score/toAlphaTab'

const at: Cursor = { track: 0, bar: 0, beat: 0, string: 1 }
const half = { value: 2, dotted: false } as const
const beat = (value: Beat['value'], ...notes: [string: number, fret: number][]): Beat => ({ value, dotted: false, notes: notes.map(([string, fret]) => ({ string, fret, velocity: 96 })) })

/**
 * A guitar song at 120 BPM in 4/4 (2 s a bar), 2 bars: four quarters on the top
 * string (frets 0, 1, 2, 3), and in bar 1 a second voice of two half notes on string 5 (frets 3, 0).
 */
function song(): Song {
  const s = createSong({ title: 't', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 2 })
  s.tracks[0].bars[0] = { beats: [beat(4, [1, 0]), beat(4, [1, 1]), beat(4, [1, 2]), beat(4, [1, 3])], voice2: [beat(2, [5, 3]), beat(2, [5, 0])] }
  return s
}

/** The project the score editor gets, applying edits to `state`. */
function project(state: { song: Song; cursor: Cursor }): Project {
  const apply = (result: EditResult | null): boolean => {
    if (!result) return false
    Object.assign(state, result)
    return true
  }
  return {
    ...state,
    apply,
    update: (change: (song: Song, cursor: Cursor) => EditResult | null) => apply(change(state.song, state.cursor)),
    setCursor: (cursor: Cursor) => (state.cursor = clampCursor(state.song, cursor))
  } as unknown as Project
}

describe('a second voice', () => {
  it('is edited like the first, through the song with its voices swapped', () => {
    const state = { song: song(), cursor: { ...at, bar: 1, string: 5, voice: 2 as const } }
    const editor = voiceProject(project(state))
    // The bar without a second voice has rests through it there.
    expect(editor.song.tracks[0].bars[1].beats).toEqual([{ value: 1, dotted: false, notes: [] }])
    expect(editor.cursor).toEqual({ ...at, bar: 1, string: 5 })
    expect(voiceProject(project(state)).song).toBe(editor.song)
    editor.apply(setDuration(editor.song, editor.cursor, half))
    const next = voiceProject(project(state))
    next.apply(setFret(next.song, next.cursor, 7, half))
    const bar = state.song.tracks[0].bars[1]
    expect(bar.voice2).toEqual([beat(2, [5, 7]), beat(2)])
    expect(bar.beats).toEqual([beat(1)])
    expect(state.cursor.voice).toBe(2)
    // The other bar is as it was.
    expect(state.song.tracks[0].bars[0]).toEqual(song().tracks[0].bars[0])
    // A second voice that is all rests again is left out.
    voiceProject(project(state)).apply(clearBar(swapVoices(state.song), { ...at, bar: 1 }))
    expect('voice2' in state.song.tracks[0].bars[1]).toBe(false)
  })

  it('swaps back to the same song, also in parts', () => {
    const arranged = arrange({ ...song(), sections: [{ bar: 0, name: 'A' }] })
    expect(unswapVoices(swapVoices(arranged))).toEqual(arranged)
    expect(swapVoices(arranged).tracks[0].parts![0].bars[0].beats).toEqual(arranged.tracks[0].bars[0].voice2)
  })

  it('has the cursor on its own beats, and the beat sounding at the same time in the other voice', () => {
    const s = song()
    expect(clampCursor(s, { ...at, beat: 9, voice: 2 })).toEqual({ ...at, beat: 1, voice: 2 })
    expect(clampCursor(s, { ...at, bar: 1, beat: 9, voice: 2 })).toEqual({ ...at, bar: 1, voice: 2 })
    expect(otherVoice(s, { ...at, beat: 3 })).toEqual({ ...at, beat: 1, voice: 2 })
    expect(otherVoice(s, { ...at, beat: 1, voice: 2 })).toEqual({ ...at, beat: 2 })
    // Drum tracks have one voice.
    const drums = addTrack(s, at, 'drums').song
    expect(clampCursor(drums, { ...at, track: 1, voice: 2 })).toEqual({ ...at, track: 1 })
    expect(otherVoice(drums, { ...at, track: 1 })).toBeNull()
  })

  it('plays along, holding its own notes', () => {
    const s = song()
    s.tracks[0].bars[1].voice2 = [{ ...beat(2, [5, 0]), notes: [{ string: 5, fret: 0, velocity: 96, tie: true }] }, beat(2)]
    const { notes, beats } = buildTimeline(s)
    // String 5: C (48) for a second, then A (45) held into the next bar.
    expect(notes.filter((n) => n.pitch < 50).map((n) => [n.pitch, n.start, n.duration])).toEqual([
      [48, 0, 1],
      [45, 1, 2]
    ])
    expect(notes.filter((n) => n.pitch >= 64)).toHaveLength(4)
    // The beats are the first voice's.
    expect(beats.filter((b) => b.barIndex === 0)).toHaveLength(4)
    expect(new Midi(songToMidi(s)).tracks[0].notes.map((n) => n.midi).sort((a, b) => a - b)).toEqual([45, 48, 64, 65, 66, 67])
  })

  it('is drawn as alphaTab’s second voice, and mapped when it is edited', () => {
    const s = song()
    const voices = (score: alphaTab.model.Score, bar: number): number[] => score.tracks[0].staves[0].bars[bar].voices.map((v) => (v.isEmpty ? 0 : v.beats.length))
    const one = songToAlphaTab(s, new alphaTab.Settings())
    expect([voices(one.score, 0), voices(one.score, 1)]).toEqual([
      [4, 2],
      [1, 0]
    ])
    expect(one.beats[0][0]).toEqual(one.score.tracks[0].staves[0].bars[0].voices[0].beats)
    const two = songToAlphaTab(swapVoices(s), new alphaTab.Settings(), false, true)
    expect([voices(two.score, 0), voices(two.score, 1)]).toEqual([
      [4, 2],
      [1, 1]
    ])
    expect(two.beats[0][0]).toEqual(two.score.tracks[0].staves[0].bars[0].voices[1].beats)
    expect(two.refs.get(two.score.tracks[0].staves[0].bars[0].voices[0].beats[0])).toBeUndefined()
  })

  it('moves with the notes: transposing, a new tuning, a new time signature', () => {
    const s = song()
    const up = transpose(s, at, { kind: 'song' }, 2, 'keep')!.result.song
    expect(up.tracks[0].bars[0].voice2!.map((b) => b.notes[0].fret)).toEqual([5, 2])
    // Drop D: the A string stays, so the notes stay.
    const dropD = retuneTrack(s, at, 0, [64, 59, 55, 50, 45, 38], 0, 'sound')!.result.song
    expect(dropD.tracks[0].bars[0].voice2).toEqual(s.tracks[0].bars[0].voice2)
    // 2/4: the bar lines move, and each voice flows into the new bars.
    const flowed = changeTimeSignature(s, at, [2, 4], 'flow')!.result.song
    expect(flowed.tracks[0].bars.map((b) => [b.beats.length, b.voice2?.length])).toEqual([
      [2, 1],
      [2, 1],
      [1, undefined],
      [1, undefined]
    ])
    // 3/4 keeping the bars: the last quarter goes, the second half note is cut to a quarter.
    const cut = changeTimeSignature(s, at, [3, 4], 'bars')!
    expect(cut.result.song.tracks[0].bars[0].voice2).toEqual([beat(2, [5, 3]), beat(4, [5, 0])])
    expect([cut.removed, cut.shortened]).toEqual([1, 1])
  })

  it('is checked for its length, and fitted', () => {
    const s = song()
    s.tracks[0].bars[0].voice2 = [beat(2, [5, 3])]
    expect(wrongBars(s)).toEqual([{ track: 0, bar: 0, length: 1920, expected: 3840 }])
    const fitted = fitBars(s, at)!.result.song
    expect(fitted.tracks[0].bars[0].voice2).toEqual([beat(2, [5, 3]), beat(2)])
    expect(fitted.tracks[0].bars[0].beats).toEqual(s.tracks[0].bars[0].beats)
  })

  it('stays when the first voice is pasted over, cleared or written in the piano roll', () => {
    const s = song()
    const voice2 = s.tracks[0].bars[0].voice2
    expect(pasteBeats(s, at, [beat(1, [2, 1])])!.song.tracks[0].bars[0]).toEqual({ beats: [beat(1, [2, 1])], voice2 })
    expect(clearBar(s, at).song.tracks[0].bars[0]).toEqual({ beats: [beat(1)], voice2 })
    const keys = addTrack(s, at, 'keys').song
    keys.tracks[1].bars[0].voice2 = [beat(1, [40, 0])]
    const rolled = writeRoll(keys, at, 1, 0, 1, [{ row: 30, start: 0, length: 960, velocity: 96 }])!.song
    expect(rolled.tracks[1].bars[0].voice2).toEqual([beat(1, [40, 0])])
    expect(rolled.tracks[1].bars[0].beats[0].notes[0].string).toBe(30)
  })

  it('is saved with the project; one without notes is left out, and drum tracks have none', () => {
    const s = song()
    expect(parseProject(serializeProject(s)).song.tracks[0].bars[0]).toEqual(s.tracks[0].bars[0])
    s.tracks[0].bars[1].voice2 = [beat(1)]
    expect('voice2' in parseProject(serializeProject(s)).song.tracks[0].bars[1]).toBe(false)
    s.tracks[0].bars[1].voice2 = [{ value: 3, dotted: false, notes: [] } as unknown as Beat]
    expect(() => parseProject(serializeProject(s))).toThrow(/invalid beat/)
    const drums = addTrack(song(), at, 'drums').song
    drums.tracks[1].bars[0].voice2 = [beat(1, [1, 0])]
    expect(() => parseProject(serializeProject(drums))).toThrow(/drum tracks have one/)
  })
})
