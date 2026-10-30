import { Midi } from '@tonejs/midi'
import * as alphaTab from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/renderer/src/audio/midiExport'
import { arrange, partSong } from '../src/renderer/src/model/arrangement'
import { wrongBars } from '../src/renderer/src/model/barCheck'
import { beatMap } from '../src/renderer/src/model/beatMap'
import { barTicks, createSong, deleteBar, insertBarBefore, pasteBeats, setFret, setSection, type Cursor } from '../src/renderer/src/model/edit'
import { changeAt, meterAt, setMeter } from '../src/renderer/src/model/meter'
import { tempoAt, timeSignatureAt, type Song } from '../src/renderer/src/model/song'
import { changeTimeSignature } from '../src/renderer/src/model/timeSignature'
import { barPosition, barTime, buildTimeline, metronomeClicks, songSeconds, tickAtTime } from '../src/renderer/src/model/timing'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'
import { songToAlphaTab } from '../src/renderer/src/score/toAlphaTab'

const at = (bar: number, beat = 0): Cursor => ({ track: 0, bar, beat, string: 1 })
const QUARTER = { value: 4, dotted: false } as const

/** A quarter note on every beat of `bars` 4/4 bars at 120 BPM (fret = beat). */
function steady(bars = 4): Song {
  let song = createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars })
  for (let bar = 0; bar < bars; bar++) for (let beat = 0; beat < 4; beat++) song = setFret(song, at(bar, beat), beat, QUARTER)!.song
  return song
}

const starts = (song: Song, bar: number): number[] => buildTimeline(song).beats.filter((b) => b.barIndex === bar).map((b) => b.start)

describe('tempo and time-signature changes (PRJ-04)', () => {
  it('a tempo change: later bars play at the new tempo', () => {
    const song = setMeter(steady(), at(0), 2, { tempo: 60, timeSignature: [4, 4] })!.result.song
    expect(song.changes).toEqual([{ bar: 2, tempo: 60 }])
    expect([1, 2, 3].map((bar) => tempoAt(song, bar))).toEqual([120, 60, 60])
    expect(starts(song, 1)).toEqual([2, 2.5, 3, 3.5])
    expect(starts(song, 2)).toEqual([4, 5, 6, 7])
    expect(buildTimeline(song).duration).toBe(12)
    expect([barTime(song, 3), songSeconds(song)]).toEqual([8, 12])
    expect(barPosition(song, 6)).toBe(2.5)
    expect(tickAtTime(song, 6)).toBe(2 * 3840 + 1920)
    // The clicks follow: one per quarter, a second apart from bar 3 on.
    expect(metronomeClicks(song, 12).filter((c) => c.time >= 4).map((c) => [c.time, c.accent])).toEqual([
      [4, true], [5, false], [6, false], [7, false], [8, true], [9, false], [10, false], [11, false]
    ])
  })

  it('a time-signature change: the bars from there get the new length, keeping their notes from their start', () => {
    const edit = setMeter(steady(), at(0), 1, { tempo: 120, timeSignature: [3, 4] })!
    const song = edit.result.song
    expect(song.changes).toEqual([{ bar: 1, timeSignature: [3, 4] }])
    expect(edit).toMatchObject({ fitted: 3, removed: 3, shortened: 0 })
    expect([0, 1, 3].map((bar) => barTicks(song, bar))).toEqual([3840, 2880, 2880])
    expect(wrongBars(song)).toEqual([])
    expect(song.tracks[0].bars[1].beats.map((b) => b.notes[0]?.fret)).toEqual([0, 1, 2])
    expect(starts(song, 2)).toEqual([3.5, 4, 4.5])
    expect(metronomeClicks(song, 5).filter((c) => c.accent).map((c) => c.time)).toEqual([0, 2, 3.5])
    // Back to 4/4: the bars end with rests again.
    const back = setMeter(song, at(0), 1, meterAt(song, 0))!
    expect(back.result.song.changes).toBeUndefined()
    expect(back.result.song.tracks[0].bars[1].beats.map((b) => b.notes[0]?.fret ?? '-')).toEqual([0, 1, 2, '-'])
  })

  it('only what differs from the bar before is a change; the same again changes nothing', () => {
    const song = steady()
    expect(setMeter(song, at(0), 2, meterAt(song, 1))).toBeNull()
    const both = setMeter(song, at(0), 2, { tempo: 90, timeSignature: [6, 8] })!.result.song
    expect(changeAt(both, 2)).toEqual({ bar: 2, tempo: 90, timeSignature: [6, 8] })
    expect(setMeter(both, at(0), 2, { tempo: 90, timeSignature: [6, 8] })).toBeNull()
    expect(setMeter(song, at(0), 0, { tempo: 90, timeSignature: [4, 4] })).toBeNull() // bar 1 is the song's own
  })

  it('a time signature holds until the next one', () => {
    let song = setMeter(steady(), at(0), 3, { tempo: 120, timeSignature: [2, 4] })!.result.song
    const edit = setMeter(song, at(0), 1, { tempo: 120, timeSignature: [3, 4] })!
    song = edit.result.song
    expect(edit.fitted).toBe(2)
    expect([0, 1, 2, 3].map((bar) => timeSignatureAt(song, bar).join('/'))).toEqual(['4/4', '3/4', '3/4', '2/4'])
    expect(wrongBars(song)).toEqual([])
  })

  it('changes move with inserted and deleted bars', () => {
    const song = setMeter(steady(), at(0), 2, { tempo: 60, timeSignature: [3, 4] })!.result.song
    // A bar inserted before the change's bar is in its time signature, as it starts there.
    const inserted = insertBarBefore(song, at(2)).song
    expect(inserted.changes).toEqual([{ bar: 2, tempo: 60, timeSignature: [3, 4] }])
    expect(inserted.tracks[0].bars[2].beats.map((b) => [b.value, b.dotted, b.notes.length])).toEqual([[2, true, 0]])
    expect(insertBarBefore(song, at(1)).song.changes?.[0].bar).toBe(3)
    expect(deleteBar(song, at(0))!.song.changes?.[0].bar).toBe(1)
    // Deleting the change's bar: the next bar starts with it.
    expect(deleteBar(song, at(2))!.song.changes).toEqual([{ bar: 2, tempo: 60, timeSignature: [3, 4] }])
    const twice = setMeter(song, at(0), 3, { tempo: 90, timeSignature: [3, 4] })!.result.song
    expect(deleteBar(twice, at(2))!.song.changes).toEqual([{ bar: 2, tempo: 90 }])
  })

  it('pastes across a change of time signature', () => {
    const song = setMeter(steady(2), at(0), 1, { tempo: 120, timeSignature: [3, 4] })!.result.song
    const beats = song.tracks[0].bars[0].beats.slice(0, 2)
    const pasted = pasteBeats(song, at(0, 3), beats)!.song
    expect(pasted.tracks[0].bars.map((bar) => bar.beats.map((b) => b.notes[0]?.fret))).toEqual([
      [0, 1, 2, 0],
      [1, 1, 2]
    ])
    expect(wrongBars(pasted)).toEqual([])
  })

  it('a new time signature for the song changes only the bars before the first change', () => {
    const song = setMeter(steady(), at(0), 2, { tempo: 120, timeSignature: [2, 4] })!.result.song
    const changed = changeTimeSignature(song, at(0), [3, 4], 'flow')!
    expect([0, 1, 2, 3].map((bar) => timeSignatureAt(changed.result.song, bar).join('/'))).toEqual(['3/4', '3/4', '2/4', '2/4'])
    expect(changed.removed).toBe(2)
    expect(wrongBars(changed.result.song)).toEqual([])
  })

  it('a part edited on its own is in the time signature where it plays', () => {
    let song = steady()
    song = setSection(song, at(0), 2, 'Waltz').song
    song = setFret(song, at(2), 7, QUARTER)!.song
    song = arrange(song)
    song = setMeter(song, at(0), 2, { tempo: 100, timeSignature: [3, 4] })!.result.song
    const waltz = song.tracks[0].parts!.find((p) => p.name === 'Waltz')!
    const alone = partSong(song, { trackId: song.tracks[0].id, partId: waltz.id })!
    expect(alone).toMatchObject({ tempo: 100, timeSignature: [3, 4], changes: undefined })
    expect(wrongBars(alone)).toEqual([])
    expect(alone.tracks[0].bars[0].beats.map((b) => b.notes[0]?.fret)).toEqual([7, 1, 2])
    expect(wrongBars(song)).toEqual([])
  })

  it('is saved in the project file, which is checked when it is opened', () => {
    const song = setMeter(steady(), at(0), 2, { tempo: 60, timeSignature: [3, 4] })!.result.song
    expect(parseProject(serializeProject(song)).song.changes).toEqual([{ bar: 2, tempo: 60, timeSignature: [3, 4] }])
    const messy = { ...song, changes: [{ bar: 3, tempo: 80 }, { bar: 2 }, { bar: 9, tempo: 70 }, { bar: 3, tempo: 90 }] }
    expect(parseProject(serializeProject(messy)).song.changes).toEqual([{ bar: 3, tempo: 90 }])
    expect(() => parseProject(serializeProject({ ...song, changes: [{ bar: 0, tempo: 80 }] }))).toThrow('no valid bar')
    expect(() => parseProject(serializeProject({ ...song, changes: [{ bar: 2, tempo: 1000 }] }))).toThrow('invalid tempo change')
  })

  it('shows the changes in the score and exports them to MIDI and the beat map', () => {
    const song = setMeter(steady(), at(0), 2, { tempo: 60, timeSignature: [3, 4] })!.result.song
    const { score } = songToAlphaTab(song, new alphaTab.Settings())
    expect(score.masterBars.map((m) => `${m.timeSignatureNumerator}/${m.timeSignatureDenominator}`)).toEqual(['4/4', '4/4', '3/4', '3/4'])
    expect(score.masterBars.map((m) => m.tempoAutomations.map((a) => a.value))).toEqual([[120], [], [60], []])

    const midi = new Midi(songToMidi(song))
    const ppq = midi.header.ppq
    expect(midi.header.tempos.map((t) => [t.ticks / ppq, t.bpm])).toEqual([[0, 120], [8, 60]])
    expect(midi.header.timeSignatures.map((t) => [t.ticks / ppq, t.timeSignature])).toEqual([[0, [4, 4]], [8, [3, 4]]])
    // The first note of bar 3 starts after two bars of 4/4, and lasts a quarter.
    const note = midi.tracks[0].notes.find((n) => n.ticks === 8 * ppq)!
    expect([note.durationTicks / ppq, note.time]).toEqual([1, 4])

    const map = beatMap(song, { start: 1, end: 4, name: 'bars 2-4' }, { sampleRate: 48000, ending: 'cut', mix: null, stems: [] })
    expect(map).toMatchObject({ tempo: 120, timeSignature: [4, 4], bars: 3, seconds: 2 + 3 + 3 })
    expect(map.barTimes).toEqual([
      { start: 0, beats: 4, secondsPerBeat: 0.5 },
      { start: 2, beats: 3, secondsPerBeat: 1 },
      { start: 5, beats: 3, secondsPerBeat: 1 }
    ])
  })
})
