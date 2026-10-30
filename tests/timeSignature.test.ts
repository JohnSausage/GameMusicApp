import { describe, expect, it } from 'vitest'
import { arrange, writeOut } from '../src/renderer/src/model/arrangement'
import { addTrack, barTicks, beatTicks, createSong, setFret, setSection, type Cursor } from '../src/renderer/src/model/edit'
import { barCount, type Bar, type Song } from '../src/renderer/src/model/song'
import { buildTimeline } from '../src/renderer/src/model/timing'
import { changeTimeSignature } from '../src/renderer/src/model/timeSignature'

const at = (bar: number, string = 1, beat = 0, track = 0): Cursor => ({ track, bar, beat, string })
const QUARTER = { value: 4, dotted: false } as const
const HALF = { value: 2, dotted: false } as const
const WHOLE = { value: 1, dotted: false } as const

const shape = (bar: Bar): string[] => bar.beats.map((b) => `${b.value}${b.dotted ? '.' : ''}${b.notes.length ? ':' + b.notes.map((n) => `${n.fret}${n.tie ? '~' : ''}`).join('+') : ''}`)
const shapes = (song: Song, track = 0): string[][] => song.tracks[track].bars.map(shape)

function expectFullBars(song: Song): void {
  for (const track of song.tracks) {
    for (const bar of track.bars) expect(bar.beats.reduce((sum, b) => sum + beatTicks(b), 0)).toBe(barTicks(song))
    for (const part of track.parts ?? []) for (const bar of part.bars) expect(bar.beats.reduce((sum, b) => sum + beatTicks(b), 0)).toBe(barTicks(song))
  }
}

/** Where notes start and how long they sound, in seconds. */
const timing = (song: Song): string[] => buildTimeline(song).notes.map((n) => `${n.trackIndex}:${n.pitch}@${n.start.toFixed(3)}+${n.duration.toFixed(3)}`)

/** A 4/4 guitar song: bar 1 four quarters (frets 1–4), bar 2 a half (5) and a half (6). */
function song44(): Song {
  let song = createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 2 })
  for (let beat = 0; beat < 4; beat++) song = setFret(song, at(0, 1, beat), beat + 1, QUARTER)!.song
  song = setFret(song, at(1, 1, 0), 5, HALF)!.song
  song = setFret(song, at(1, 1, 1), 6, HALF)!.song
  return song
}

describe('changing the time signature', () => {
  it('keeps the notes as they are when bars stay as long (4/4 → 2/2)', () => {
    const song = song44()
    const result = changeTimeSignature(song, at(0), [2, 2], 'flow')!
    expect(result.result.song.timeSignature).toEqual([2, 2])
    expect(shapes(result.result.song)).toEqual(shapes(song))
    expect(changeTimeSignature(song, at(0), [4, 4], 'flow')).toBeNull()
  })

  it('moves the bar lines, every note at the same time (4/4 → 2/4)', () => {
    const song = song44()
    const result = changeTimeSignature(song, at(0), [2, 4], 'flow')!.result.song
    expect(shapes(result)).toEqual([['4:1', '4:2'], ['4:3', '4:4'], ['2:5'], ['2:6']])
    expect(timing(result)).toEqual(timing(song))
    expectFullBars(result)
  })

  it('holds notes over a moved bar line (4/4 → 3/4)', () => {
    const song = song44()
    const result = changeTimeSignature(song, at(0), [3, 4], 'flow')!
    // 8 beats in bars of 3: the half note on beat 5 is held over the bar line; the last bar ends with a rest.
    expect(shapes(result.result.song)).toEqual([['4:1', '4:2', '4:3'], ['4:4', '2:5'], ['2:6', '4']])
    expect(timing(result.result.song)).toEqual(timing(song))
    expectFullBars(result.result.song)
  })

  it('ties a long note into the next bar', () => {
    let song = createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 1 })
    song = setFret(song, at(0), 7, WHOLE)!.song
    const result = changeTimeSignature(song, at(0), [3, 4], 'flow')!.result.song
    expect(shapes(result)).toEqual([['2.:7'], ['4:7~', '2']])
    expect(timing(result)).toEqual(timing(song))
  })

  it('does not hold drum hits over a bar line', () => {
    let song = addTrack(createSong({ title: 'Test', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 1 }), at(0), 'drums').song
    song = setFret(song, at(0, 9, 0, 1), 0, WHOLE)!.song
    const result = changeTimeSignature(song, at(0), [3, 4], 'flow')!.result.song
    expect(shapes(result, 1)).toEqual([['2.:0'], ['4', '2']])
  })

  it('keeps the bars: shorter ones lose what no longer fits', () => {
    const result = changeTimeSignature(song44(), at(0), [3, 4], 'bars')!
    expect(shapes(result.result.song)).toEqual([['4:1', '4:2', '4:3'], ['2:5', '4:6']])
    expect(result).toMatchObject({ removed: 1, shortened: 1 })
    expectFullBars(result.result.song)
  })

  it('keeps the bars: longer ones end with rests', () => {
    const result = changeTimeSignature(song44(), at(0), [5, 4], 'bars')!
    expect(shapes(result.result.song)).toEqual([['4:1', '4:2', '4:3', '4:4', '4'], ['2:5', '2:6', '4']])
    expect(result).toMatchObject({ removed: 0, shortened: 0 })
  })

  it('moves section markers of a song without an arrangement to where their music starts', () => {
    let song = song44()
    song = setSection(song, at(0), 1, 'B').song
    const result = changeTimeSignature(song, at(0), [2, 4], 'flow')!.result.song
    expect(result.sections.map((s) => s.bar)).toEqual([2])
    expect(barCount(result)).toBe(4)
  })
})

describe('changing the time signature of an arranged song', () => {
  /** Section A (2 bars, the 4/4 music above) and section B playing the same part. */
  function arranged(): Song {
    let song = song44()
    song = setSection(song, at(0), 0, 'A').song
    song = arrange(song)
    const [a] = song.arrangement!
    const b = { ...a, id: 'b', name: 'B', parts: { ...a.parts } }
    return writeOut({ ...song, arrangement: [a, b] })
  }

  it('flows every part and gives each section the bars its music needs', () => {
    const song = arranged()
    const result = changeTimeSignature(song, at(0), [3, 4], 'flow')!
    const after = result.result.song
    expect(after.arrangement!.map((s) => s.length)).toEqual([3, 3])
    expect(after.tracks[0].parts!).toHaveLength(1)
    expect(shapes(after)).toEqual([...Array(2)].flatMap(() => [['4:1', '4:2', '4:3'], ['4:4', '2:5'], ['2:6', '4']]))
    expect(result).toMatchObject({ padded: 2, copied: 0 })
    expectFullBars(after)
  })

  it('copies a repeated part for a section where its repeats no longer line up', () => {
    let song = song44()
    song = setSection(song, at(0), 0, 'A').song
    song = arrange(song)
    // Section A plays a one-bar part twice.
    const part = song.tracks[0].parts![0]
    song.tracks[0].parts![0] = { ...part, name: 'Riff', bars: [part.bars[0]] }
    song = writeOut(song)
    const result = changeTimeSignature(song, at(0), [3, 4], 'flow')!
    const after = result.result.song
    expect(result.copied).toBe(1)
    expect(after.tracks[0].parts!.map((p) => p.name)).toEqual(['Riff', 'Riff 2'])
    expect(after.arrangement![0].parts[after.tracks[0].id]).toBe(after.tracks[0].parts![1].id)
    // It sounds as before: the riff twice, without a gap.
    expect(timing(after)).toEqual(timing(song))
  })

  it('keeps the bars of parts and sections', () => {
    const song = arranged()
    const result = changeTimeSignature(song, at(0), [3, 4], 'bars')!
    const after = result.result.song
    expect(after.arrangement!.map((s) => s.length)).toEqual([2, 2])
    expect(shape(after.tracks[0].parts![0].bars[0])).toEqual(['4:1', '4:2', '4:3'])
    // Counted once per part, not per repeat.
    expect(result).toMatchObject({ removed: 1, shortened: 1 })
  })
})
