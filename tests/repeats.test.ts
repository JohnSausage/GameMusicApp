import * as alphaTab from '@coderline/alphatab'
import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/renderer/src/audio/midiExport'
import { beatMap } from '../src/renderer/src/model/beatMap'
import { createSong, deleteBar, duplicateBar, insertBarBefore, setFret, type Cursor } from '../src/renderer/src/model/edit'
import { cleanRepeats, orderText, playOrder, setRepeat } from '../src/renderer/src/model/repeats'
import type { Repeat, Song } from '../src/renderer/src/model/song'
import { changeTimeSignature } from '../src/renderer/src/model/timeSignature'
import { barAtTime, barTime, buildTimeline, metronomeClicks, scoreTickAtTime, songSeconds, tickAtTime } from '../src/renderer/src/model/timing'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'
import { songToAlphaTab } from '../src/renderer/src/score/toAlphaTab'

const at: Cursor = { track: 0, bar: 0, beat: 0, string: 1 }

/** A guitar song at 120 BPM in 4/4 (2 s a bar): bar n has one whole note, fret n, on string 1. */
function song(bars: number, repeats?: Repeat[]): Song {
  let s = createSong({ title: 't', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars })
  for (let bar = 0; bar < bars; bar++) s = setFret(s, { ...at, bar }, bar, { value: 1, dotted: false })!.song
  return repeats ? { ...s, repeats } : s
}

const order = (bars: number, repeats: Repeat[]): string => orderText(playOrder({ repeats }, bars))

describe('repeat signs and endings', () => {
  it('play a repeated passage again, as often as the end sign says', () => {
    expect(order(6, [{ bar: 1, start: true }, { bar: 2, times: 2 }])).toBe('1–3, 2–6')
    expect(order(5, [{ bar: 0, start: true }, { bar: 1, times: 3 }])).toBe('1–2, 1–2, 1–5')
    // Without a start sign: from the song's start, or from after the last repeat.
    expect(order(4, [{ bar: 1, times: 2 }, { bar: 3, times: 2 }])).toBe('1–2, 1–4, 3–4')
    expect(order(3, [])).toBe('1–3')
  })

  it('play each ending only on its time through', () => {
    // ‖: 1 2 [1. 3 :‖ [2. 4 ] 5
    expect(order(5, [{ bar: 0, start: true }, { bar: 2, times: 2, ending: [1] }, { bar: 3, ending: [2] }])).toBe('1–3, 1–2, 4–5')
    // Three times: endings 1 and 2 share a bar, the 3rd has its own; an ending can be two bars long.
    const three = [{ bar: 0, start: true }, { bar: 1, ending: [1, 2] }, { bar: 2, times: 3, ending: [1, 2] }, { bar: 3, ending: [3] }]
    expect(order(5, three)).toBe('1–3, 1–3, 1, 4–5')
  })

  it('make the song play its bars in that order, and time the bars by their first time', () => {
    const s = song(4, [{ bar: 1, start: true }, { bar: 2, times: 2 }])
    const { notes, beats, duration } = buildTimeline(s)
    expect(notes.map((n) => [n.pitch - 64, n.start])).toEqual([
      [0, 0],
      [1, 2],
      [2, 4],
      [1, 6],
      [2, 8],
      [3, 10]
    ])
    expect(beats.map((b) => b.barIndex)).toEqual([0, 1, 2, 1, 2, 3])
    expect(duration).toBe(12)
    expect([0, 1, 2, 3, 4].map((bar) => barTime(s, bar))).toEqual([0, 2, 4, 10, 12])
    expect(songSeconds(s)).toBe(12)
    expect([1, 3, 5, 7, 9, 11, 13].map((t) => barAtTime(s, t))).toEqual([0, 1, 2, 1, 2, 3, 4])
    expect(metronomeClicks(s, duration)).toHaveLength(24)
    // Ticks as played (MIDI), and the place in the written bars (the piano roll's playhead).
    expect(tickAtTime(s, 7)).toBe(3.5 * 3840)
    expect(scoreTickAtTime(s, 7)).toBe(1.5 * 3840)
  })

  it('are written out in MIDI and counted as played in the beat map', () => {
    const s = song(4, [{ bar: 1, start: true }, { bar: 2, times: 2 }])
    const midi = new Midi(songToMidi(s))
    expect(midi.tracks[0].notes.map((n) => n.midi - 64)).toEqual([0, 1, 2, 1, 2, 3])
    const map = beatMap({ ...s, sections: [{ bar: 1, name: 'Loop' }] }, { start: 0, end: 4, name: null }, { sampleRate: 48000, ending: 'cut', mix: null, stems: [] })
    expect(map.bars).toBe(6)
    expect(map.seconds).toBe(12)
    expect(map.barTimes.map((b) => b.start)).toEqual([0, 2, 4, 6, 8, 10])
    expect(map.sections).toEqual([{ name: 'Loop', bar: 1, bars: 5, start: 2, end: 12 }])
  })

  it('are set at a bar, joined per bar, and taken away again', () => {
    let s = song(4)
    s = setRepeat(s, at, 1, { start: true })!.song
    s = setRepeat(s, at, 2, { times: 3, ending: [2, 1, 1] })!.song
    expect(s.repeats).toEqual([
      { bar: 1, start: true },
      { bar: 2, times: 3, ending: [1, 2] }
    ])
    expect(setRepeat(s, at, 1, { start: true })).toBeNull() // no change
    s = setRepeat(s, at, 1, {})!.song
    s = setRepeat(s, at, 2, {})!.song
    expect(s.repeats).toBeUndefined()
    expect(cleanRepeats([{ bar: 9, start: true }, { bar: 1, times: 2 }, { bar: 1, start: true }, { bar: 0 }], 4)).toEqual([{ bar: 1, start: true, times: 2 }])
  })

  it('stay with their bars when bars are inserted, duplicated or deleted', () => {
    const s = song(5, [{ bar: 1, start: true }, { bar: 3, times: 2 }])
    // Inserted before the start: the new bar starts the repeat.
    expect(insertBarBefore(s, { ...at, bar: 1 }).song.repeats).toEqual([{ bar: 1, start: true }, { bar: 4, times: 2 }])
    // Inserted before the end: the end stays with its bar.
    expect(insertBarBefore(s, { ...at, bar: 3 }).song.repeats).toEqual([{ bar: 1, start: true }, { bar: 4, times: 2 }])
    expect(duplicateBar(s, { ...at, bar: 3 }).song.repeats).toEqual([{ bar: 1, start: true }, { bar: 3, times: 2 }])
    // Deleting the start bar: the repeat starts at the next one; deleting the end bar: it ends at the one before.
    expect(deleteBar(s, { ...at, bar: 1 })!.song.repeats).toEqual([{ bar: 1, start: true }, { bar: 2, times: 2 }])
    expect(deleteBar(s, { ...at, bar: 3 })!.song.repeats).toEqual([{ bar: 1, start: true }, { bar: 2, times: 2 }])
  })

  it('move with the music when the bar lines move to another time signature', () => {
    // 4/4 → 2/4: bar 2 (the second) becomes bars 3–4.
    const s = song(4, [{ bar: 1, start: true, times: 2 }])
    expect(changeTimeSignature(s, at, [2, 4], 'flow')!.result.song.repeats).toEqual([{ bar: 2, start: true }, { bar: 3, times: 2 }])
  })

  it('are saved with the project and shown in the score', () => {
    const s = song(4, [{ bar: 1, start: true }, { bar: 2, times: 3, ending: [1, 2] }, { bar: 3, ending: [3] }])
    expect(parseProject(serializeProject(s)).song.repeats).toEqual(s.repeats)
    expect(() => parseProject(serializeProject({ ...s, repeats: [{ bar: 1, times: 99 }] }))).toThrow(/repeat/)
    const { score } = songToAlphaTab(s, new alphaTab.Settings())
    const bars = score.masterBars
    expect(bars.map((b) => [b.isRepeatStart, b.repeatCount, b.alternateEndings])).toEqual([
      [false, 0, 0],
      [true, 0, 0],
      [false, 3, 3],
      [false, 0, 4]
    ])
  })
})
