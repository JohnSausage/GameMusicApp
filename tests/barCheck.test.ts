import { describe, expect, it } from 'vitest'
import { arrange, writeOut } from '../src/renderer/src/model/arrangement'
import { fitBars, lengthName, wrongBars, wrongBy } from '../src/renderer/src/model/barCheck'
import { createSong, setFret, setSection, type Cursor } from '../src/renderer/src/model/edit'
import type { Beat, Song } from '../src/renderer/src/model/song'

const at = (bar: number, track = 0): Cursor => ({ track, bar, beat: 0, string: 1 })
const note = (value: Beat['value'], fret: number, dotted = false): Beat => ({ value, dotted, notes: [{ string: 1, fret, velocity: 100 }] })
const rest = (value: Beat['value']): Beat => ({ value, dotted: false, notes: [] })
const shape = (beats: Beat[]): string[] => beats.map((b) => `${b.dotted ? '.' : ''}${b.value}${b.triplet ? 't' : ''}${b.notes.length ? `:${b.notes.map((n) => n.fret)}` : ''}`)

function song(...bars: Beat[][]): Song {
  const s = createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: bars.length })
  bars.forEach((beats, b) => (s.tracks[0].bars[b].beats = beats))
  return s
}

describe('bar validation (EDIT-07)', () => {
  it('finds bars that are too short or too long', () => {
    expect(wrongBars(createSong({ title: 'Test', tempo: 120, timeSignature: [3, 4], firstTrack: 'guitar', bars: 4 }))).toEqual([])
    const s = song([note(1, 0)], [note(4, 3)], [note(1, 0), note(4, 5)])
    expect(wrongBars(s)).toEqual([
      { track: 0, bar: 1, length: 960, expected: 3840 },
      { track: 0, bar: 2, length: 4800, expected: 3840 }
    ])
    expect(wrongBars(s).map(wrongBy)).toEqual(['is dotted 1/2 too short', 'is 1/4 too long'])
    expect(lengthName(480 + 120)).toBe('1/8 + 1/32')
    expect(lengthName(320)).toBe('1/8 triplet')
  })

  it('fills a short bar with rests and cuts a long one at its end', () => {
    const s = song([note(4, 3)], [note(1, 0), note(4, 5)], [note(2, 7, true), note(2, 8)])
    const fit = fitBars(s, at(2))!
    expect(fit).toMatchObject({ fitted: 3, removed: 1, shortened: 1 })
    expect(fit.result.song.tracks[0].bars.map((bar) => shape(bar.beats))).toEqual([['4:3', '.2'], ['1:0'], ['.2:7', '4:8']])
    expect(wrongBars(fit.result.song)).toEqual([])
    expect(fitBars(fit.result.song, at(0))).toBeNull()
  })

  it('fits only the bar asked for', () => {
    const s = song([note(4, 3)], [note(4, 5)])
    const fit = fitBars(s, at(1), { track: 0, bar: 1 })!
    expect(fit.fitted).toBe(1)
    expect(wrongBars(fit.result.song).map((w) => w.bar)).toEqual([0])
    expect(fit.result.cursor).toEqual(at(1))
  })

  it('keeps the cursor on a beat that is still there', () => {
    const s = song([note(1, 0), rest(4), note(4, 5)])
    expect(fitBars(s, { ...at(0), beat: 2 })!.result.cursor.beat).toBe(0)
  })

  it('fits a part once, wherever it plays', () => {
    let s = createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 2 })
    s = setSection(s, at(0), 1, 'Again').song
    for (const bar of [0, 1]) s = setFret(s, at(bar), 3, { value: 1, dotted: false })!.song
    s = arrange(s)
    expect(s.arrangement!.map((section) => section.parts[s.tracks[0].id])).toEqual(Array(2).fill(s.tracks[0].parts![0].id))
    s.tracks[0].parts![0].bars[0].beats.push(note(4, 5))
    s = writeOut(s)
    expect(wrongBars(s).map((w) => w.bar)).toEqual([0, 1])
    const fit = fitBars(s, at(0))!
    expect(fit).toMatchObject({ fitted: 1, removed: 1, shortened: 0 })
    expect(wrongBars(fit.result.song)).toEqual([])
    expect(shape(fit.result.song.tracks[0].parts![0].bars[0].beats)).toEqual(['1:3'])
  })
})
