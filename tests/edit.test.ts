import { describe, expect, it } from 'vitest'
import {
  addBars,
  addTrack,
  barTicks,
  beatTicks,
  clearBeat,
  createSong,
  deleteBar,
  deleteNote,
  deleteTrack,
  duplicateBar,
  insertBarBefore,
  moveBeat,
  moveString,
  moveTrack,
  pasteBar,
  restsFor,
  setDuration,
  setFret,
  setSection,
  stepDuration,
  toggleDotted,
  type Cursor
} from '../src/renderer/src/model/edit'
import { barCount, type Bar, type Song } from '../src/renderer/src/model/song'

const QUARTER = { value: 4, dotted: false } as const
const start: Cursor = { track: 0, bar: 0, beat: 0, string: 1 }

function newSong(timeSignature: [number, number] = [4, 4]): Song {
  return createSong({ title: 'Test', tempo: 120, timeSignature, firstTrack: 'guitar' })
}

/** Each bar's length in ticks must always equal the time signature. */
function expectFullBars(song: Song): void {
  for (const track of song.tracks) {
    for (const bar of track.bars) expect(bar.beats.reduce((sum, b) => sum + beatTicks(b), 0)).toBe(barTicks(song))
  }
}

const shape = (bar: Bar): string[] => bar.beats.map((b) => `${b.value}${b.dotted ? '.' : ''}${b.notes.length ? ':' + b.notes.map((n) => `${n.string}/${n.fret}`).join('+') : ''}`)

describe('createSong / restsFor', () => {
  it('fills new bars with rests that match the time signature', () => {
    expect(shape(newSong().tracks[0].bars[0])).toEqual(['1'])
    expect(shape(newSong([3, 4]).tracks[0].bars[0])).toEqual(['2.'])
    expect(shape(newSong([6, 8]).tracks[0].bars[0])).toEqual(['2.'])
    expect(restsFor(960 * 3.5).map((b) => `${b.value}${b.dotted ? '.' : ''}`)).toEqual(['2.', '8'])
    expect(barCount(newSong())).toBe(4)
  })
})

describe('setFret', () => {
  it('splits a rest so the new note gets the chosen length', () => {
    const result = setFret(newSong(), start, 3, QUARTER)!
    expect(shape(result.song.tracks[0].bars[0])).toEqual(['4:1/3', '2.'])
    expectFullBars(result.song)
  })

  it('adds a second note to a beat as a chord, and replaces a note on the same string', () => {
    let song = setFret(newSong(), start, 3, QUARTER)!.song
    song = setFret(song, { ...start, string: 2 }, 5, QUARTER)!.song
    song = setFret(song, start, 7, QUARTER)!.song
    expect(shape(song.tracks[0].bars[0])[0]).toBe('4:1/7+2/5')
  })

  it('rejects frets above 24', () => {
    expect(setFret(newSong(), start, 25, QUARTER)).toBeNull()
  })

  it('does not change the original song', () => {
    const song = newSong()
    setFret(song, start, 3, QUARTER)
    expect(shape(song.tracks[0].bars[0])).toEqual(['1'])
  })
})

describe('deleteNote / clearBeat', () => {
  it('removes notes and leaves a rest', () => {
    const song = setFret(newSong(), start, 3, QUARTER)!.song
    expect(shape(deleteNote(song, start)!.song.tracks[0].bars[0])).toEqual(['4', '2.'])
    expect(deleteNote(song, { ...start, string: 2 })).toBeNull()
    expect(shape(clearBeat(song, start)!.song.tracks[0].bars[0])).toEqual(['4', '2.'])
  })
})

describe('setDuration', () => {
  const withQuarters = (): Song => {
    let song = newSong()
    for (let beat = 0; beat < 4; beat++) song = setFret(song, { ...start, beat }, beat, QUARTER)!.song
    return song
  }

  it('fills the gap with rests when a note gets shorter', () => {
    const song = setDuration(withQuarters(), start, { value: 8, dotted: false })!.song
    expect(shape(song.tracks[0].bars[0])).toEqual(['8:1/0', '8', '4:1/1', '4:1/2', '4:1/3'])
    expectFullBars(song)
  })

  it('takes time from the following beats when a note gets longer', () => {
    const song = setDuration(withQuarters(), start, { value: 2, dotted: false })!.song
    expect(shape(song.tracks[0].bars[0])).toEqual(['2:1/0', '4:1/2', '4:1/3'])
    expectFullBars(song)
  })

  it('shortens (but keeps) a following note that only partly fits', () => {
    const song = setDuration(withQuarters(), start, { value: 4, dotted: true })!.song
    expect(shape(song.tracks[0].bars[0])).toEqual(['4.:1/0', '8:1/1', '4:1/2', '4:1/3'])
    expectFullBars(song)
  })

  it('refuses when the bar has no room left', () => {
    expect(setDuration(withQuarters(), { ...start, beat: 3 }, { value: 2, dotted: false })).toBeNull()
  })

  it('steps shorter/longer and toggles dots', () => {
    const song = withQuarters()
    expect(shape(stepDuration(song, start, 'shorter')!.song.tracks[0].bars[0])[0]).toBe('8:1/0')
    expect(shape(stepDuration(song, start, 'longer')!.song.tracks[0].bars[0])[0]).toBe('2:1/0')
    expect(shape(toggleDotted(song, start)!.song.tracks[0].bars[0])[0]).toBe('4.:1/0')
  })
})

describe('bars and sections', () => {
  it('adds bars at the end and moves the cursor there', () => {
    const result = addBars(newSong(), start, 1)
    expect(barCount(result.song)).toBe(5)
    expect(result.cursor).toMatchObject({ bar: 4, beat: 0 })
  })

  it('adds a named 4-bar section with one call', () => {
    const result = addBars(newSong(), start, 4, 'Chorus')
    expect(barCount(result.song)).toBe(8)
    expect(result.song.sections).toEqual([{ bar: 4, name: 'Chorus' }])
  })

  it('keeps sections attached to their bars when bars are inserted, duplicated or deleted', () => {
    let song = addBars(newSong(), start, 4, 'Chorus').song // Chorus starts at bar 4
    song = insertBarBefore(song, { ...start, bar: 1 }).song
    expect(song.sections[0].bar).toBe(5)
    song = duplicateBar(song, { ...start, bar: 0 }).song
    expect(song.sections[0].bar).toBe(6)
    song = deleteBar(song, { ...start, bar: 0 })!.song
    expect(song.sections[0].bar).toBe(5)
    expect(barCount(song)).toBe(9)
  })

  it('removes a section whose bars are all gone', () => {
    let song = addBars(newSong(), start, 1, 'Outro').song // Outro = last bar (4)
    song = deleteBar(song, { ...start, bar: 4 })!.song
    expect(song.sections).toEqual([])
  })

  it('never deletes the last bar', () => {
    let song = createSong({ title: 'One', tempo: 100, timeSignature: [4, 4], firstTrack: 'guitar', bars: 1 })
    expect(deleteBar(song, start)).toBeNull()
    song = setSection(song, start, 0, 'Intro').song
    expect(setSection(song, start, 0, 'Verse').song.sections).toEqual([{ bar: 0, name: 'Verse' }])
    expect(setSection(song, start, 0, null).song.sections).toEqual([])
  })

  it('pastes a copied bar and drops notes on strings the target track lacks', () => {
    let song = setFret(newSong(), { ...start, string: 6 }, 3, QUARTER)!.song
    song = setFret(song, start, 1, QUARTER)!.song
    const copied = structuredClone(song.tracks[0].bars[0])
    song = addTrack(song, start, 'bass').song
    const pasted = pasteBar(song, { track: 1, bar: 2, beat: 0, string: 1 }, copied)!.song
    expect(shape(pasted.tracks[1].bars[2])).toEqual(['4:1/1', '2.'])
  })
})

describe('tracks', () => {
  it('adds tracks with the same number of bars and keeps at least one', () => {
    const song = addTrack(newSong(), start, 'bass').song
    expect(song.tracks.map((t) => [t.name, t.tuning.length, t.bars.length])).toEqual([
      ['Guitar', 6, 4],
      ['Bass', 4, 4]
    ])
    expect(deleteTrack(song, start, 1)!.song.tracks).toHaveLength(1)
    expect(deleteTrack(newSong(), start, 0)).toBeNull()
  })
})

describe('cursor movement', () => {
  const song = setFret(newSong(), start, 0, QUARTER)!.song // bar 0: quarter + dotted half

  it('moves across bar lines and stops at the ends', () => {
    expect(moveBeat(song, start, 1)).toMatchObject({ bar: 0, beat: 1 })
    expect(moveBeat(song, { ...start, beat: 1 }, 1)).toMatchObject({ bar: 1, beat: 0 })
    expect(moveBeat(song, { ...start, bar: 1 }, -1)).toMatchObject({ bar: 0, beat: 1 })
    expect(moveBeat(song, start, -1)).toEqual(start)
    expect(moveBeat(song, { ...start, bar: 3 }, 1)).toMatchObject({ bar: 3, beat: 0 })
  })

  it('stays within the strings of the track', () => {
    expect(moveString(song, start, -1).string).toBe(1)
    expect(moveString(song, { ...start, string: 6 }, 1).string).toBe(6)
  })

  it('switches tracks at the same point in time and clamps the string', () => {
    let twoTracks = addTrack(song, start, 'bass').song
    twoTracks = setFret(twoTracks, { track: 1, bar: 0, beat: 0, string: 1 }, 0, { value: 2, dotted: false })!.song // half + half rest
    const cursor = moveTrack(twoTracks, { track: 0, bar: 0, beat: 1, string: 6 }, 1) // guitar beat 1 starts at a quarter
    expect(cursor).toEqual({ track: 1, bar: 0, beat: 0, string: 4 })
  })
})
