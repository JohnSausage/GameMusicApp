import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { songPosition, startPosition, startSchedule, takeDue, validLoop } from '../src/renderer/src/audio/scheduler'
import { addBars, addTrack, createSong, deleteBar, loopBars, sectionRangeOf, sectionRanges, setFret, setSection, updateTrack, type Cursor } from '../src/renderer/src/model/edit'
import { audibleTracks, createDemoSong, type Song } from '../src/renderer/src/model/song'
import { barSeconds, buildTimeline, exportFrameCount, notesBetween, type NoteEvent } from '../src/renderer/src/model/timing'
import { parseProject, serializeProject } from '../src/renderer/src/project/projectFile'

const cursor: Cursor = { track: 0, bar: 0, beat: 0, string: 1 }

/** A quarter note on every beat of `bars` 4/4 bars at 120 BPM: notes every 0.5 s, bars of 2 s. */
function steadySong(bars = 4): Song {
  let song = createSong({ title: 't', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars })
  for (let bar = 0; bar < bars; bar++) for (let beat = 0; beat < 4; beat++) song = setFret(song, { ...cursor, bar, beat }, beat, { value: 4, dotted: false })!.song
  return song
}

const note = (start: number): NoteEvent => ({ trackIndex: 0, pitch: 60, velocity: 96, start, duration: 0.5 })

describe('mute and solo', () => {
  it('plays tracks that are not muted, or only the soloed ones', () => {
    let song = addTrack(addTrack(createDemoSong(), cursor, 'drums').song, cursor, 'bass').song // guitar, bass, drums, bass
    expect(audibleTracks(song)).toEqual([true, true, true, true])
    song = updateTrack(song, cursor, 1, { mute: true }).song
    expect(audibleTracks(song)).toEqual([true, false, true, true])
    song = updateTrack(song, cursor, 2, { solo: true }).song
    expect(audibleTracks(song)).toEqual([false, false, true, false])
    song = updateTrack(song, cursor, 1, { solo: true }).song // soloed but muted: mute wins
    expect(audibleTracks(song)).toEqual([false, false, true, false])
  })

  it('are saved with the project', () => {
    const song = updateTrack(updateTrack(createDemoSong(), cursor, 0, { mute: true }).song, cursor, 1, { solo: true }).song
    const loaded = parseProject(serializeProject(song)).song
    expect(loaded.tracks.map((t) => [t.mute, t.solo])).toEqual([
      [true, undefined],
      [undefined, true]
    ])
    const json = { app: 'GameMusicApp', formatVersion: 3, song: { ...song, tracks: [{ ...song.tracks[0], mute: 'yes' }, song.tracks[1]] } }
    expect(() => parseProject(zipSync({ 'song.json': strToU8(JSON.stringify(json)) }))).toThrow('mute/solo')
  })
})

describe('sections as bar ranges', () => {
  it('run from their start to the next section or the end', () => {
    let song = createSong({ title: 't', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 2 })
    song = addBars(song, cursor, 4, 'Loop').song // bars 3–6
    song = setSection(song, cursor, 0, 'Intro').song
    expect(sectionRanges(song)).toEqual([
      { name: 'Intro', start: 0, end: 2 },
      { name: 'Loop', start: 2, end: 6 }
    ])
    expect(sectionRangeOf(song, 4)?.name).toBe('Loop')
    expect(sectionRangeOf(setSection(song, cursor, 0, null).song, 1)).toBeNull()
  })

  it('give loop playback a fixed range that falls back to the whole song', () => {
    let song = createSong({ title: 't', tempo: 120, timeSignature: [4, 4], firstTrack: 'guitar', bars: 2 })
    song = addBars(song, cursor, 4, 'Loop').song // bars 3–6
    expect(loopBars(song, { kind: 'song' })).toEqual({ start: 0, end: 6, name: null, kind: 'song' })
    expect(loopBars(song, { kind: 'section', start: 2 })).toEqual({ start: 2, end: 6, name: 'Loop', kind: 'section' })
    expect(loopBars(song, { kind: 'bars', start: 1, end: 3 })).toEqual({ start: 1, end: 3, name: null, kind: 'bars' })
    expect(loopBars(song, { kind: 'section', start: 1 }).kind).toBe('song') // no section starts there
    song = deleteBar(deleteBar(song, { ...cursor, bar: 5 })!.song, { ...cursor, bar: 4 })!.song // 4 bars left
    expect(loopBars(song, { kind: 'bars', start: 3, end: 6 })).toMatchObject({ start: 3, end: 4 })
    expect(loopBars(song, { kind: 'bars', start: 5, end: 6 }).kind).toBe('song')
  })
})

describe('export timing', () => {
  it('knows bar lengths and cuts exactly at the range end', () => {
    const song = steadySong()
    expect(barSeconds(song)).toBe(2)
    expect(barSeconds({ ...song, tempo: 90, timeSignature: [6, 8] })).toBe(2)
    expect(exportFrameCount({ start: 0, end: 16 }, 48000, 'cut')).toBe(768000)
    expect(exportFrameCount({ start: 2, end: 6 }, 44100, 'cut')).toBe(176400)
    expect(exportFrameCount({ start: 0, end: 16 }, 48000, 'tail')).toBe(768000 + 72000)
  })

  it('takes the notes of a range and moves them to its start', () => {
    const notes = buildTimeline(steadySong()).notes
    const bar2 = notesBetween(notes, 2, 4)
    expect(bar2.map((n) => n.start)).toEqual([0, 0.5, 1, 1.5])
    expect(notesBetween([note(1.9999999999), note(4.0000000001)], 2, 4).map((n) => n.start)).toEqual([0]) // rounding at the edges
  })
})

describe('playback scheduling', () => {
  const timeline = buildTimeline(steadySong(2)) // notes every 0.5 s, 4 s long

  it('hands out notes and clicks as they become due', () => {
    const s = startSchedule(timeline, 0, 10, null, 0.5, 4)
    const first = takeDue(s, 10, 10.6)
    expect(first.notes.map((n) => n.when)).toEqual([10, 10.5])
    expect(first.clicks).toEqual([
      { when: 10, accent: true },
      { when: 10.5, accent: false }
    ])
    expect(takeDue(s, 10.1, 10.6).notes).toEqual([]) // nothing twice
    expect(takeDue(s, 10.5, 12.1).clicks.map((c) => [c.when, c.accent])).toEqual([
      [11, false],
      [11.5, false],
      [12, true]
    ])
  })

  it('starts in the middle without the notes before', () => {
    const s = startSchedule(timeline, 1.25, 0, null, 0.5, 4)
    const due = takeDue(s, 0, 1)
    expect(due.notes.map((n) => n.note.start)).toEqual([1.5, 2])
    expect(due.notes.map((n) => n.when)).toEqual([0.25, 0.75])
    expect(due.clicks.map((c) => c.when)).toEqual([0.25, 0.75])
  })

  it('loops a range seamlessly', () => {
    const loop = { start: 2, end: 4 } // bar 2
    const s = startSchedule(timeline, startPosition(0, loop), 100, loop, 0.5, 4)
    const due = takeDue(s, 100, 106)
    // Three passes of bar 2 at 100, 102 and 104, then the first note of the fourth pass at 106.
    expect(due.notes.map((n) => n.when)).toEqual([100, 100.5, 101, 101.5, 102, 102.5, 103, 103.5, 104, 104.5, 105, 105.5, 106])
    expect(due.notes.every((n) => n.note.start >= 2 && n.note.start < 4)).toBe(true)
    expect(due.clicks.filter((c) => c.accent).map((c) => c.when)).toEqual([100, 102, 104, 106])
  })

  it('starts a loop at its start unless the cursor is inside it', () => {
    const loop = { start: 2, end: 4 }
    expect(startPosition(0.5, loop)).toBe(2)
    expect(startPosition(3, loop)).toBe(3)
    expect(startPosition(4, loop)).toBe(2)
    expect(startPosition(3, null)).toBe(3)
    expect(validLoop({ start: 2, end: 2 })).toBeNull()
  })

  it('wraps the shown position into the loop', () => {
    const loop = { start: 2, end: 4 }
    expect(songPosition(3, 0.5, loop)).toBe(3.5)
    expect(songPosition(3, 1.5, loop)).toBeCloseTo(2.5)
    expect(songPosition(2, 4.25, loop)).toBeCloseTo(2.25)
    expect(songPosition(1, 10, null)).toBe(11)
    expect(songPosition(1, -0.2, null)).toBe(1) // before the start (latency)
  })
})
